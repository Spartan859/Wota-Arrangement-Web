import { loadConfig } from "../config";

const config = loadConfig();
const baseUrl = config.AUTHENTIK_ADMIN_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("AUTHENTIK_ADMIN_BASE_URL is required.");
if (!config.AUTHENTIK_BOOTSTRAP_TOKEN)
  throw new Error("AUTHENTIK_BOOTSTRAP_TOKEN is required.");
if (!config.AUTHENTIK_ADMIN_TOKEN)
  throw new Error("AUTHENTIK_ADMIN_TOKEN is required.");

type AuthentikUser = {
  pk: number;
  uuid: string;
  username: string;
};

type AuthentikRole = {
  pk: string;
  name: string;
};

type AuthentikToken = {
  pk: string;
  identifier: string;
  user: number;
};

type AuthentikOAuthProvider = {
  pk: number;
  name: string;
  signing_key: string | null;
};

type AuthentikCertificateKeypair = {
  pk: string;
  name: string;
  private_key_available: boolean;
};

type Paginated<T> = {
  results: T[];
  pagination: { count: number; total_pages: number };
};

const rolePermissions = [
  "authentik_core.view_user",
  "authentik_core.add_user",
  "authentik_core.change_user",
  "authentik_core.view_group",
  "authentik_core.change_group",
  "authentik_core.reset_user_password",
  "authentik_stages_email.view_emailstage",
];

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`,
    );
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function waitForAuthentik(token: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await request("/root/config/", token);
      return;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function ensureServiceAccount(token: string) {
  const query = new URLSearchParams({
    username: config.AUTHENTIK_API_ADMIN_SERVICE_ACCOUNT,
    page_size: "10",
  });
  const existing = await request<Paginated<AuthentikUser>>(
    `/core/users/?${query}`,
    token,
  );
  const exact = existing.results.find(
    (user) => user.username === config.AUTHENTIK_API_ADMIN_SERVICE_ACCOUNT,
  );
  if (exact) return exact;
  const created = await request<{
    user_pk: number;
    user_uid: string;
    username: string;
  }>("/core/users/service_account/", token, {
    method: "POST",
    body: JSON.stringify({
      name: config.AUTHENTIK_API_ADMIN_SERVICE_ACCOUNT,
      create_group: false,
      expiring: false,
    }),
  });
  return {
    pk: created.user_pk,
    uuid: created.user_uid,
    username: created.username,
  };
}

async function ensureRole(token: string) {
  const query = new URLSearchParams({
    name: config.AUTHENTIK_API_ADMIN_ROLE,
    page_size: "10",
  });
  const existing = await request<Paginated<AuthentikRole>>(
    `/rbac/roles/?${query}`,
    token,
  );
  const exact = existing.results.find(
    (role) => role.name === config.AUTHENTIK_API_ADMIN_ROLE,
  );
  if (exact) return exact;
  return request<AuthentikRole>("/rbac/roles/", token, {
    method: "POST",
    body: JSON.stringify({ name: config.AUTHENTIK_API_ADMIN_ROLE }),
  });
}

async function ensureToken(token: string, user: AuthentikUser) {
  const query = new URLSearchParams({
    identifier: config.AUTHENTIK_API_ADMIN_TOKEN_IDENTIFIER,
    page_size: "10",
  });
  const existing = await request<Paginated<AuthentikToken>>(
    `/core/tokens/?${query}`,
    token,
  );
  let exact = existing.results.find(
    (item) => item.identifier === config.AUTHENTIK_API_ADMIN_TOKEN_IDENTIFIER,
  );
  if (!exact)
    exact = await request<AuthentikToken>("/core/tokens/", token, {
      method: "POST",
      body: JSON.stringify({
        identifier: config.AUTHENTIK_API_ADMIN_TOKEN_IDENTIFIER,
        intent: "api",
        user: user.pk,
        description: "Wota API admin token",
        expiring: false,
      }),
    });
  await request<void>(
    `/core/tokens/${encodeURIComponent(config.AUTHENTIK_API_ADMIN_TOKEN_IDENTIFIER)}/set_key/`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ key: config.AUTHENTIK_ADMIN_TOKEN }),
    },
  );
}

async function ensureSigningKey(token: string) {
  const providers = await request<Paginated<AuthentikOAuthProvider>>(
    `/providers/oauth2/?${new URLSearchParams({ name: "Wota", page_size: "10" })}`,
    token,
  );
  const provider = providers.results.find((item) => item.name === "Wota");
  if (!provider) throw new Error("Authentik Wota OIDC provider is missing.");

  const certificates = await request<Paginated<AuthentikCertificateKeypair>>(
    `/crypto/certificatekeypairs/?${new URLSearchParams({
      name: "authentik Self-signed Certificate",
      page_size: "10",
    })}`,
    token,
  );
  const certificate = certificates.results.find(
    (item) =>
      item.name === "authentik Self-signed Certificate" &&
      item.private_key_available,
  );
  if (!certificate)
    throw new Error("Authentik default signing certificate is unavailable.");

  if (provider.signing_key !== certificate.pk)
    await request<AuthentikOAuthProvider>(
      `/providers/oauth2/${provider.pk}/`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ signing_key: certificate.pk }),
      },
    );

  const publicOrigin = new URL(config.OIDC_ISSUER_URL);
  const jwksResponse = await fetch(`${baseUrl}/application/o/wota/jwks/`, {
    headers: {
      "x-forwarded-host": publicOrigin.host,
      "x-forwarded-proto": publicOrigin.protocol.replace(":", ""),
      ...(publicOrigin.port ? { "x-forwarded-port": publicOrigin.port } : {}),
    },
  });
  if (!jwksResponse.ok)
    throw new Error(`Authentik JWKS check failed: ${jwksResponse.status}`);
  const jwks = (await jwksResponse.json()) as { keys?: unknown[] };
  if (!jwks.keys?.length)
    throw new Error("Authentik Wota provider has no published signing key.");
}

await waitForAuthentik(config.AUTHENTIK_BOOTSTRAP_TOKEN);
const serviceAccount = await ensureServiceAccount(
  config.AUTHENTIK_BOOTSTRAP_TOKEN,
);
const role = await ensureRole(config.AUTHENTIK_BOOTSTRAP_TOKEN);
await request<unknown[]>(
  `/rbac/permissions/assigned_by_roles/${encodeURIComponent(role.pk)}/assign/`,
  config.AUTHENTIK_BOOTSTRAP_TOKEN,
  {
    method: "POST",
    body: JSON.stringify({ permissions: rolePermissions }),
  },
);
await request<void>(
  `/rbac/roles/${encodeURIComponent(role.pk)}/add_user/`,
  config.AUTHENTIK_BOOTSTRAP_TOKEN,
  {
    method: "POST",
    body: JSON.stringify({ pk: serviceAccount.pk }),
  },
);
await ensureSigningKey(config.AUTHENTIK_BOOTSTRAP_TOKEN);
await ensureToken(config.AUTHENTIK_BOOTSTRAP_TOKEN, serviceAccount);
await request("/core/users/?page_size=1", config.AUTHENTIK_ADMIN_TOKEN);
console.log(
  `Authentik service account ${serviceAccount.username} configured with role ${role.name}.`,
);
