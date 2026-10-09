import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { loadConfig, type AppConfig } from "./config";
import { createDatabase } from "./db/client";
import { errorPayload } from "./lib/errors";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerPublicRoutes } from "./routes/public";
import { registerShareRoutes } from "./routes/shares";
import { KeycloakAdminService } from "./services/keycloak-admin";
import { OidcService } from "./services/oidc";
import { SessionService } from "./services/session";

export async function buildApp(config: AppConfig = loadConfig()) {
  const { db, pool } = createDatabase(config);
  const oidc = new OidcService(config);
  const sessions = new SessionService(db, config, oidc);
  const keycloak = new KeycloakAdminService(config);
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    trustProxy: config.TRUST_PROXY,
    bodyLimit: Math.max(
      config.MAX_AUDIO_BYTES + 2 * 1024 * 1024,
      4 * 1024 * 1024,
    ),
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_AUDIO_BYTES,
      files: 1,
      fields: 10,
      parts: 12,
    },
  });

  app.get("/healthz", async () => "ok\n");
  app.get("/api/health", async () => ({ ok: true, service: "wota-api" }));
  await registerAuthRoutes(app, { config, db, oidc, sessions });
  await registerShareRoutes(app, { config, db, sessions });
  await registerPublicRoutes(app, { config, db });
  await registerAdminRoutes(app, { config, db, sessions, keycloak });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({
        statusCode: 422,
        code: "validation_failed",
        message: error.issues[0]?.message ?? "请求数据无效。",
      });
    }
    const payload = errorPayload(error);
    if (payload.statusCode >= 500) app.log.error(error);
    return reply.code(payload.statusCode).send(payload);
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });
  return app;
}
