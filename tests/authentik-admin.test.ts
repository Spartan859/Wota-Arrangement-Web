import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../server/config";
import { AuthentikAdminService } from "../server/services/authentik-admin";

const config = loadConfig({
  DATABASE_URL: "postgres://wota:test@localhost:5432/wota",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
  OIDC_ISSUER_URL: "http://127.0.0.1:8081/application/o/wota/",
  OIDC_CLIENT_ID: "wota-bff",
  OIDC_CLIENT_SECRET: "test-client-secret",
  AUTHENTIK_ADMIN_BASE_URL: "http://authentik:9000",
  AUTHENTIK_ADMIN_TOKEN: "test-admin-token",
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function page<T>(results: T[], count = results.length) {
  return {
    results,
    pagination: { count, current: 1, total_pages: 1 },
    autocomplete: {},
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    pk: 7,
    uuid: "user-uuid",
    username: "user@example.com",
    name: "Synthetic User",
    email: "user@example.com",
    is_active: false,
    groups: ["group-user"],
    attributes: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Authentik admin service", () => {
  it("creates an inactive user, assigns groups, and sends a recovery email", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        calls.push({ url, init });
        if (url.pathname === "/api/v3/core/groups/") {
          const name = url.searchParams.get("name");
          return jsonResponse(
            page([
              {
                pk: name === "wota-admin" ? "group-admin" : "group-user",
                name,
              },
            ]),
          );
        }
        if (url.pathname === "/api/v3/core/users/" && !init?.method) {
          expect(url.searchParams.getAll("type")).toEqual([
            "internal",
            "external",
          ]);
          return jsonResponse(page([]));
        }
        if (url.pathname === "/api/v3/core/users/" && init?.method === "POST") {
          return jsonResponse(
            user({
              groups: ["group-user", "group-admin"],
              attributes: { email_verified_address: "user@example.com" },
            }),
            201,
          );
        }
        if (url.pathname === "/api/v3/stages/email/") {
          return jsonResponse(
            page([{ pk: "email-stage", name: "wota-recovery-email" }]),
          );
        }
        if (url.pathname.endsWith("/recovery_email/"))
          return new Response(null, { status: 204 });
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      }),
    );

    const result = await new AuthentikAdminService(config).provisionUser({
      email: "user@example.com",
      name: "Synthetic User",
      isAdmin: true,
    });

    expect(result).toEqual({
      subject: "user-uuid",
      email: "user@example.com",
      displayName: "Synthetic User",
      emailVerified: true,
    });
    const create = calls.find(
      ({ url, init }) =>
        url.pathname === "/api/v3/core/users/" && init?.method === "POST",
    );
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({
      username: "user@example.com",
      is_active: false,
      groups: ["group-user", "group-admin"],
    });
    expect(
      calls.find(({ url }) => url.pathname.endsWith("/recovery_email/"))?.init
        ?.body,
    ).toContain("email-stage");
    expect(
      (
        calls.find(({ url }) => url.pathname.endsWith("/recovery_email/"))?.init
          ?.headers as Record<string, string>
      )["x-forwarded-host"],
    ).toBe("127.0.0.1:8081");
  });

  it("limits the admin directory to Wota app users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        expect(url.pathname).toBe("/api/v3/core/users/");
        expect(url.searchParams.getAll("type")).toEqual([
          "internal",
          "external",
        ]);
        expect(url.searchParams.get("groups_by_name")).toBe("wota-user");
        return jsonResponse(page([user()]));
      }),
    );

    const result = await new AuthentikAdminService(config).listUsersPage(
      "",
      0,
      20,
    );

    expect(result.users.map((item) => item.uuid)).toEqual(["user-uuid"]);
  });

  it("updates an existing user without creating a duplicate", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        calls.push(init ?? {});
        if (url.pathname === "/api/v3/core/groups/") {
          const name = url.searchParams.get("name");
          return jsonResponse(
            page([
              {
                pk: name === "wota-admin" ? "group-admin" : "group-user",
                name,
              },
            ]),
          );
        }
        if (url.pathname === "/api/v3/core/users/" && !init?.method) {
          return jsonResponse(page([user()]));
        }
        if (
          url.pathname === "/api/v3/core/users/7/" &&
          init?.method === "PATCH"
        ) {
          return jsonResponse(user({ groups: ["group-user", "group-admin"] }));
        }
        if (url.pathname === "/api/v3/stages/email/") {
          return jsonResponse(
            page([{ pk: "email-stage", name: "wota-recovery-email" }]),
          );
        }
        if (url.pathname.endsWith("/recovery_email/"))
          return new Response(null, { status: 204 });
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      }),
    );

    await new AuthentikAdminService(config).provisionUser({
      email: "USER@example.com",
      name: "Synthetic User",
      isAdmin: true,
    });

    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.body?.toString().includes('"username"'),
      ),
    ).toBe(false);
  });

  it("rejects duplicate Authentik email matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          page([user({ pk: 1, uuid: "one" }), user({ pk: 2, uuid: "two" })]),
        ),
      ),
    );

    await expect(
      new AuthentikAdminService(config).findUserByEmail("user@example.com"),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "authentik_email_ambiguous",
    });
  });

  it("maps Authentik failures to a stable application error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "permission denied" }, 403)),
    );

    await expect(
      new AuthentikAdminService(config).listUsersPage("", 0, 20),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "authentik_admin_request_failed",
    });
  });
});
