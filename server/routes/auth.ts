import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import type { OidcAttempt, OidcService } from "../services/oidc";
import type { SessionService } from "../services/session";
import { ensureUser } from "../services/users";

type Dependencies = {
  config: AppConfig;
  db: Database;
  oidc: OidcService;
  sessions: SessionService;
};

export async function registerAuthRoutes(
  app: FastifyInstance,
  { config, db, oidc, sessions }: Dependencies,
) {
  app.get<{ Querystring: { returnTo?: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      const { url, attempt } = await oidc.authorizationRequest(
        request.query.returnTo ?? "/",
      );
      sessions.setOidcAttempt(reply, attempt);
      return reply.redirect(url);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/callback",
    async (request, reply) => {
      if (request.query.error)
        throw new Error(`OIDC authorization failed: ${request.query.error}`);
      const code = request.query.code;
      const attempt = sessions.readOidcAttempt<OidcAttempt>(request);
      if (
        !code ||
        !attempt ||
        attempt.expiresAt < Date.now() ||
        attempt.state !== request.query.state
      )
        return reply
          .code(400)
          .send({ message: "登录请求已失效，请重新登录。" });
      const completed = await oidc.completeAuthorization(code, attempt);
      const user = await ensureUser(db, config, completed.identity);
      await sessions.create(reply, user.id, completed.tokens);
      sessions.clearOidcAttempt(reply);
      return reply.redirect(attempt.returnTo);
    },
  );

  app.get("/api/auth/logout", async (request, reply) => {
    const current = await sessions.load(request);
    const url = await oidc.logoutUrl(current?.tokens.idToken);
    await sessions.destroy(request, reply);
    return reply.redirect(url);
  });

  app.get("/api/session", async (request) => {
    const current = await sessions.load(request);
    if (!current) return { authenticated: false, csrfToken: null, user: null };
    return {
      authenticated: true,
      csrfToken: current.csrfToken,
      user: {
        id: current.user.id,
        email: current.user.email,
        name: current.user.displayName,
        emailVerified: current.user.emailVerified,
        isAdmin: current.user.role === "admin",
        quotaBytes: current.user.quotaBytes,
        usedBytes: current.user.usedBytes,
      },
    };
  });
}
