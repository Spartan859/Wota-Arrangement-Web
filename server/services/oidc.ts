import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomToken } from "../lib/crypto";
import type { AppConfig } from "../config";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
};

export type OidcAttempt = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

export type OidcTokens = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accessExpiresAt: number;
  refreshExpiresAt?: number;
};

export type OidcIdentity = {
  subject: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isAdmin: boolean;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

function base64Url(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url");
}

function safeReturnTo(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export class OidcService {
  private discovery?: Discovery;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {}

  async metadata() {
    if (!this.discovery) {
      const response = await fetch(
        `${this.config.oidcDiscoveryUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
      );
      if (!response.ok)
        throw new Error(`OIDC discovery failed: ${response.status}`);
      this.discovery = (await response.json()) as Discovery;
      this.jwks = createRemoteJWKSet(
        new URL(this.internalUrl(this.discovery.jwks_uri)),
      );
    }
    return this.discovery;
  }

  async authorizationRequest(returnTo: string) {
    const metadata = await this.metadata();
    const state = randomToken(24);
    const nonce = randomToken(24);
    const codeVerifier = randomToken(48);
    const challenge = base64Url(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier),
      ),
    );
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("client_id", this.config.OIDC_CLIENT_ID);
    url.searchParams.set("redirect_uri", this.config.oidcRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid profile email");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    const attempt: OidcAttempt = {
      state,
      nonce,
      codeVerifier,
      returnTo: safeReturnTo(returnTo),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    return { url: url.toString(), attempt };
  }

  async completeAuthorization(code: string, attempt: OidcAttempt) {
    const metadata = await this.metadata();
    const response = await fetch(this.internalUrl(metadata.token_endpoint), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.oidcRedirectUri,
        client_id: this.config.OIDC_CLIENT_ID,
        client_secret: this.config.OIDC_CLIENT_SECRET,
        code_verifier: attempt.codeVerifier,
      }),
    });
    if (!response.ok)
      throw new Error(`OIDC token exchange failed: ${response.status}`);
    const token = (await response.json()) as TokenResponse;
    if (!token.id_token)
      throw new Error("OIDC response did not include an ID token.");
    if (!this.jwks) await this.metadata();
    const verified = await jwtVerify(token.id_token, this.jwks!, {
      issuer: this.config.OIDC_ISSUER_URL,
      audience: this.config.OIDC_CLIENT_ID,
    });
    if (verified.payload.nonce !== attempt.nonce)
      throw new Error("OIDC nonce validation failed.");
    const claims = verified.payload as Record<string, unknown> & {
      sub: string;
      email?: string;
      name?: string;
      preferred_username?: string;
      email_verified?: boolean;
      realm_access?: { roles?: string[] };
    };
    return {
      tokens: this.tokensFromResponse(token),
      identity: {
        subject: claims.sub,
        email: String(claims.email ?? claims.preferred_username ?? ""),
        name: String(
          claims.name ?? claims.preferred_username ?? claims.email ?? "",
        ),
        emailVerified: claims.email_verified === true,
        isAdmin: claims.realm_access?.roles?.includes("wota-admin") === true,
      } satisfies OidcIdentity,
    };
  }

  async refresh(refreshToken: string): Promise<OidcTokens | null> {
    const metadata = await this.metadata();
    const response = await fetch(this.internalUrl(metadata.token_endpoint), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.OIDC_CLIENT_ID,
        client_secret: this.config.OIDC_CLIENT_SECRET,
      }),
    });
    if (!response.ok) return null;
    const token = (await response.json()) as TokenResponse;
    return this.tokensFromResponse(token, refreshToken);
  }

  async logoutUrl(idToken?: string) {
    const metadata = await this.metadata();
    if (!metadata.end_session_endpoint)
      return this.config.postLogoutRedirectUri;
    const url = new URL(metadata.end_session_endpoint);
    if (idToken) url.searchParams.set("id_token_hint", idToken);
    url.searchParams.set(
      "post_logout_redirect_uri",
      this.config.postLogoutRedirectUri,
    );
    return url.toString();
  }

  private tokensFromResponse(
    token: TokenResponse,
    fallbackRefreshToken?: string,
  ): OidcTokens {
    const now = Date.now();
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? fallbackRefreshToken,
      idToken: token.id_token,
      accessExpiresAt: now + Math.max(30, token.expires_in ?? 300) * 1000,
      refreshExpiresAt: token.refresh_expires_in
        ? now + token.refresh_expires_in * 1000
        : undefined,
    };
  }

  private internalUrl(value: string) {
    const source = new URL(value);
    const internal = new URL(this.config.oidcInternalBaseUrl);
    source.protocol = internal.protocol;
    source.host = internal.host;
    return source.toString();
  }
}
