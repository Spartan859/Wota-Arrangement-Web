import "dotenv/config";
import { z } from "zod";
import { defaultQuotaBytes, maxAudioBytes } from "../src/core/share";

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === "true" || value === "1");

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  OIDC_ISSUER_URL: z.string().url(),
  OIDC_DISCOVERY_URL: z.string().url().optional(),
  OIDC_INTERNAL_BASE_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_POST_LOGOUT_REDIRECT_URI: z.string().url().optional(),
  AUDIO_STORAGE_DIR: z.string().min(1).default("./data/audio"),
  DEFAULT_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(defaultQuotaBytes),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(maxAudioBytes),
  TRUST_PROXY: booleanString,
  KEYCLOAK_ADMIN_BASE_URL: z.string().url().optional(),
  KEYCLOAK_ADMIN_REALM: z.string().default("wota"),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().optional(),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().optional(),
  KEYCLOAK_BOOTSTRAP_USERNAME: z.string().optional(),
  KEYCLOAK_BOOTSTRAP_PASSWORD: z.string().optional(),
  KEYCLOAK_SMTP_HOST: z.string().default("postfix"),
  KEYCLOAK_SMTP_PORT: z.coerce.number().int().positive().default(25),
  KEYCLOAK_SMTP_FROM: z.string().email().default("no-reply@wota.satintin.com"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`服务配置无效：${issue.path.join(".")} ${issue.message}`);
  }
  const parsed = result.data;
  return {
    ...parsed,
    oidcRedirectUri:
      parsed.OIDC_REDIRECT_URI ?? `${parsed.PUBLIC_ORIGIN}/api/auth/callback`,
    oidcDiscoveryUrl: parsed.OIDC_DISCOVERY_URL ?? parsed.OIDC_ISSUER_URL,
    oidcInternalBaseUrl:
      parsed.OIDC_INTERNAL_BASE_URL ?? parsed.OIDC_ISSUER_URL,
    postLogoutRedirectUri:
      parsed.OIDC_POST_LOGOUT_REDIRECT_URI ?? `${parsed.PUBLIC_ORIGIN}/`,
    secureCookies: parsed.PUBLIC_ORIGIN.startsWith("https://"),
  };
}
