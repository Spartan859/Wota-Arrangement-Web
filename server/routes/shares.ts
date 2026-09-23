import type { FastifyInstance, FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { and, eq, isNull } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { shares } from "../db/schema";
import { randomToken } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { SessionContext, SessionService } from "../services/session";
import {
  deleteShare,
  deleteShareAudio,
  listShares,
  publishShare,
} from "../services/shares";

type Dependencies = {
  config: AppConfig;
  db: Database;
  sessions: SessionService;
};

async function authenticated(
  request: FastifyRequest,
  sessions: SessionService,
): Promise<SessionContext> {
  const session = await sessions.load(request);
  if (!session) throw new AppError(401, "unauthorized", "请先登录。");
  return session;
}

function verified(session: SessionContext) {
  if (!session.user.emailVerified)
    throw new AppError(403, "email_unverified", "请先完成邮箱验证。");
}

function csrf(request: FastifyRequest, session: SessionContext) {
  if (request.headers["x-csrf-token"] !== session.csrfToken)
    throw new AppError(403, "csrf_failed", "请求校验失败，请刷新页面后重试。");
}

async function parsePublishUpload(
  request: FastifyRequest,
  config: AppConfig,
  allowEmptyAudio = false,
) {
  await mkdir(join(config.AUDIO_STORAGE_DIR, ".tmp"), {
    recursive: true,
    mode: 0o750,
  });
  const fields: Record<string, string> = {};
  let audio: { tempPath: string; originalName: string } | undefined;
  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = String(part.value);
      continue;
    }
    if (part.fieldname !== "audio") {
      part.file.resume();
      continue;
    }
    if (audio) {
      part.file.resume();
      throw new AppError(422, "duplicate_audio", "一次只能上传一个音频文件。");
    }
    const tempPath = join(
      config.AUDIO_STORAGE_DIR,
      ".tmp",
      `${randomToken(18)}.upload`,
    );
    try {
      await pipeline(
        part.file,
        createWriteStream(tempPath, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    if (part.file.truncated) {
      await rm(tempPath, { force: true });
      throw new AppError(413, "audio_too_large", "音频文件超过单文件上限。");
    }
    audio = { tempPath, originalName: part.filename || "song" };
  }
  if (!allowEmptyAudio && !audio && fields.preserveAudio !== "true")
    return { fields, audio: undefined };
  return { fields, audio };
}

export async function registerShareRoutes(
  app: FastifyInstance,
  { config, db, sessions }: Dependencies,
) {
  app.get("/api/shares", async (request) => {
    const session = await authenticated(request, sessions);
    return { shares: await listShares(db, config, session.user.id) };
  });

  app.post("/api/shares", async (request) => {
    const session = await authenticated(request, sessions);
    verified(session);
    csrf(request, session);
    const upload = await parsePublishUpload(request, config, true);
    try {
      const snapshot = JSON.parse(upload.fields.snapshot || "null") as unknown;
      return await publishShare(db, config, {
        userId: session.user.id,
        projectId: upload.fields.projectId,
        shareId: upload.fields.shareId || undefined,
        snapshot,
        audio: upload.audio,
        preserveAudio: upload.fields.preserveAudio === "true",
      });
    } catch (error) {
      if (upload.audio) await rm(upload.audio.tempPath, { force: true });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/shares/:id/audio",
    async (request) => {
      const session = await authenticated(request, sessions);
      verified(session);
      csrf(request, session);
      const upload = await parsePublishUpload(request, config, false);
      if (!upload.audio)
        throw new AppError(422, "audio_required", "请选择要上传的音频文件。");
      try {
        const rows = await db
          .select()
          .from(shares)
          .where(
            and(
              eq(shares.id, request.params.id),
              eq(shares.userId, session.user.id),
              isNull(shares.deletedAt),
            ),
          )
          .limit(1);
        const share = rows[0];
        if (!share)
          throw new AppError(404, "share_not_found", "在线编排不存在。");
        return await publishShare(db, config, {
          userId: session.user.id,
          projectId: share.projectId,
          shareId: share.id,
          snapshot: share.snapshot,
          audio: upload.audio,
          preserveAudio: true,
        });
      } catch (error) {
        await rm(upload.audio.tempPath, { force: true });
        throw error;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/shares/:id/audio",
    async (request, reply) => {
      const session = await authenticated(request, sessions);
      csrf(request, session);
      await deleteShareAudio(db, {
        userId: session.user.id,
        shareId: request.params.id,
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/shares/:id",
    async (request, reply) => {
      const session = await authenticated(request, sessions);
      csrf(request, session);
      await deleteShare(db, {
        userId: session.user.id,
        shareId: request.params.id,
      });
      return reply.code(204).send();
    },
  );
}
