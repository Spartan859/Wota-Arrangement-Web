import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../server/config";
import { identityFromClaims, OidcService } from "../server/services/oidc";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OIDC identity mapping", () => {
  it("maps Authentik profile, group, and verification claims", () => {
    expect(
      identityFromClaims({
        sub: "user-uuid",
        email: "user@example.com",
        name: "Synthetic User",
        groups: ["wota-user", "wota-admin"],
        email_verified: true,
      }),
    ).toEqual({
      subject: "user-uuid",
      email: "user@example.com",
      name: "Synthetic User",
      emailVerified: true,
      isAdmin: true,
    });
  });

  it("keeps normal users without administrator privileges", () => {
    expect(
      identityFromClaims({
        sub: "user-uuid",
        email: "user@example.com",
        preferred_username: "user@example.com",
        groups: ["wota-user", 42],
        email_verified: false,
      }),
    ).toEqual({
      subject: "user-uuid",
      email: "user@example.com",
      name: "user@example.com",
      emailVerified: false,
      isAdmin: false,
    });
  });

  it("handles missing and malformed optional claims", () => {
    expect(
      identityFromClaims({ sub: "user-uuid", groups: "wota-admin" }),
    ).toEqual({
      subject: "user-uuid",
      email: "",
      name: "",
      emailVerified: false,
      isAdmin: false,
    });
  });
});

describe("OIDC provider requests", () => {
  it("uses internal discovery with public forwarded headers", async () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://wota:test@localhost:5432/wota",
      SESSION_SECRET: "test-session-secret-at-least-32-characters",
      OIDC_ISSUER_URL: "https://auth.example.com/application/o/wota/",
      OIDC_DISCOVERY_URL: "http://authentik-server:9000/application/o/wota/",
      OIDC_INTERNAL_BASE_URL: "http://authentik-server:9000",
      OIDC_CLIENT_ID: "wota-bff",
      OIDC_CLIENT_SECRET: "test-client-secret",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            issuer: "https://auth.example.com/application/o/wota/",
            authorization_endpoint:
              "https://auth.example.com/application/o/authorize/",
            token_endpoint: "https://auth.example.com/application/o/token/",
            jwks_uri: "https://auth.example.com/application/o/wota/jwks/",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = await new OidcService(config).authorizationRequest("/");

    expect(request.url).toContain(
      "https://auth.example.com/application/o/authorize/",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://authentik-server:9000/application/o/wota/.well-known/openid-configuration",
      {
        headers: {
          "x-forwarded-host": "auth.example.com",
          "x-forwarded-proto": "https",
        },
      },
    );
  });
});
