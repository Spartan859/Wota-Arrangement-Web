import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { AppError } from "../lib/errors";
import {
  listAdminUserShares,
  listAdminUsers,
  promoteAdmin,
  setUserQuota,
} from "../services/admin";
import type { KeycloakAdminService } from "../services/keycloak-admin";
import type { SessionContext, SessionService } from "../services/session";
import { deleteShare, deleteShareAudio } from "../services/shares";

type Dependencies = {
  config: AppConfig;
  db: Database;
  sessions: SessionService;
  keycloak: KeycloakAdminService;
};

async function adminSession(request: FastifyRequest, sessions: SessionService) {
  const session = await sessions.load(request);
  if (!session) throw new AppError(401, "unauthorized", "请先登录。");
  if (session.user.role !== "admin")
    throw new AppError(403, "forbidden", "需要管理员权限。");
  return session;
}

function csrf(request: FastifyRequest, session: SessionContext) {
  if (request.headers["x-csrf-token"] !== session.csrfToken)
    throw new AppError(403, "csrf_failed", "请求校验失败，请刷新页面后重试。");
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  { config, db, sessions, keycloak }: Dependencies,
) {
  app.get<{
    Querystring: { page?: string; pageSize?: string; search?: string };
  }>("/api/admin/users", async (request) => {
    await adminSession(request, sessions);
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.query.pageSize) || 20),
    );
    return listAdminUsers(
      db,
      config,
      keycloak,
      page,
      pageSize,
      request.query.search ?? "",
    );
  });

  app.get<{ Params: { id: string } }>(
    "/api/admin/users/:id/shares",
    async (request) => {
      await adminSession(request, sessions);
      return {
        shares: await listAdminUserShares(db, config, request.params.id),
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { quotaMiB?: number } }>(
    "/api/admin/users/:id/quota",
    async (request) => {
      const session = await adminSession(request, sessions);
      csrf(request, session);
      const body = z
        .object({ quotaMiB: z.number().finite().nonnegative() })
        .parse(request.body);
      const user = await setUserQuota(db, {
        actorUserId: session.user.id,
        userId: request.params.id,
        quotaBytes: Math.round(body.quotaMiB * 1024 * 1024),
      });
      return { quotaBytes: user.quotaBytes };
    },
  );

  app.post<{ Body: { email?: string; name?: string } }>(
    "/api/admin/admins",
    async (request, reply) => {
      const session = await adminSession(request, sessions);
      csrf(request, session);
      const body = z
        .object({
          email: z.string().email(),
          name: z.string().max(120).default(""),
        })
        .parse(request.body);
      const user = await promoteAdmin(db, config, keycloak, {
        actorUserId: session.user.id,
        email: body.email,
        name: body.name,
      });
      return reply.code(201).send({ id: user.id, email: user.email });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/shares/:id/audio",
    async (request, reply) => {
      const session = await adminSession(request, sessions);
      csrf(request, session);
      await deleteShareAudio(db, {
        userId: session.user.id,
        shareId: request.params.id,
        actorUserId: session.user.id,
        isAdmin: true,
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/shares/:id",
    async (request, reply) => {
      const session = await adminSession(request, sessions);
      csrf(request, session);
      await deleteShare(db, {
        userId: session.user.id,
        shareId: request.params.id,
        actorUserId: session.user.id,
        isAdmin: true,
      });
      return reply.code(204).send();
    },
  );
}
