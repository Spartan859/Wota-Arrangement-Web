import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { sessions, users } from "../db/schema";
import {
  decryptJson,
  encryptJson,
  hashToken,
  randomToken,
} from "../lib/crypto";
import type { OidcTokens } from "./oidc";
import type { OidcService } from "./oidc";

export const sessionCookieName = "wota_session";
export const oidcAttemptCookieName = "wota_oidc_attempt";
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export type SessionContext = {
  id: string;
  csrfToken: string;
  tokens: OidcTokens;
  user: typeof users.$inferSelect;
};

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly oidc: OidcService,
  ) {}

  async create(reply: FastifyReply, userId: string, tokens: OidcTokens) {
    const rawToken = randomToken(32);
    const id = hashToken(rawToken);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    await this.db.insert(sessions).values({
      id,
      userId,
      csrfToken,
      tokenCiphertext: encryptJson(tokens, this.config.SESSION_SECRET),
      expiresAt,
    });
    reply.setCookie(sessionCookieName, rawToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.secureCookies,
      signed: true,
      expires: expiresAt,
    });
    return csrfToken;
  }

  async load(request: FastifyRequest): Promise<SessionContext | null> {
    const raw = request.cookies[sessionCookieName];
    if (!raw) return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return null;
    const id = hashToken(unsigned.value);
    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row || row.user.disabled) return null;
    let tokens = decryptJson<OidcTokens>(
      row.session.tokenCiphertext,
      this.config.SESSION_SECRET,
    );
    if (tokens.accessExpiresAt <= Date.now() + 30_000 && tokens.refreshToken) {
      const refreshed = await this.oidc
        .refresh(tokens.refreshToken)
        .catch(() => null);
      if (!refreshed) {
        await this.destroy(request, undefined);
        return null;
      }
      tokens = refreshed;
      await this.db
        .update(sessions)
        .set({
          tokenCiphertext: encryptJson(tokens, this.config.SESSION_SECRET),
        })
        .where(eq(sessions.id, id));
    }
    return {
      id,
      csrfToken: row.session.csrfToken,
      tokens,
      user: row.user,
    };
  }

  async destroy(request: FastifyRequest, reply?: FastifyReply) {
    const raw = request.cookies[sessionCookieName];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value)
        await this.db
          .delete(sessions)
          .where(eq(sessions.id, hashToken(unsigned.value)));
    }
    reply?.clearCookie(sessionCookieName, { path: "/" });
  }

  setOidcAttempt(reply: FastifyReply, value: unknown) {
    reply.setCookie(
      oidcAttemptCookieName,
      encryptJson(value, this.config.SESSION_SECRET),
      {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: this.config.secureCookies,
        signed: true,
        maxAge: 10 * 60,
      },
    );
  }

  readOidcAttempt<T>(request: FastifyRequest) {
    const raw = request.cookies[oidcAttemptCookieName];
    if (!raw) return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return null;
    try {
      return decryptJson<T>(unsigned.value, this.config.SESSION_SECRET);
    } catch {
      return null;
    }
  }

  clearOidcAttempt(reply: FastifyReply) {
    reply.clearCookie(oidcAttemptCookieName, { path: "/" });
  }
}
