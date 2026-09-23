import { loadConfig } from "../config";

const config = loadConfig();
const baseUrl = config.KEYCLOAK_ADMIN_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) throw new Error("KEYCLOAK_ADMIN_BASE_URL is required.");

type Json = Record<string, unknown>;

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  allow404 = false,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`,
    );
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const tokenResponse = await fetch(
  `${baseUrl}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: config.KEYCLOAK_BOOTSTRAP_USERNAME ?? "",
      password: config.KEYCLOAK_BOOTSTRAP_PASSWORD ?? "",
    }),
  },
);
if (!tokenResponse.ok)
  throw new Error(`Keycloak bootstrap login failed: ${tokenResponse.status}`);
const { access_token: token } = (await tokenResponse.json()) as {
  access_token: string;
};
const realmPath = `/admin/realms/${encodeURIComponent(config.KEYCLOAK_ADMIN_REALM)}`;

const realm = await request<Json>(realmPath, token, {}, true);
if (!realm) {
  await request<void>("/admin/realms", token, {
    method: "POST",
    body: JSON.stringify({
      realm: config.KEYCLOAK_ADMIN_REALM,
      enabled: true,
      registrationAllowed: true,
      verifyEmail: true,
      loginWithEmailAllowed: true,
      duplicateEmailsAllowed: false,
      resetPasswordAllowed: true,
      editUsernameAllowed: false,
      smtpServer: {
        host: config.KEYCLOAK_SMTP_HOST,
        port: String(config.KEYCLOAK_SMTP_PORT),
        from: config.KEYCLOAK_SMTP_FROM,
        fromDisplayName: "Wota",
        auth: "false",
        starttls: "false",
        ssl: "false",
      },
    }),
  });
} else {
  await request<void>(realmPath, token, {
    method: "PUT",
    body: JSON.stringify({
      ...realm,
      enabled: true,
      registrationAllowed: true,
      verifyEmail: true,
      loginWithEmailAllowed: true,
      duplicateEmailsAllowed: false,
      resetPasswordAllowed: true,
      smtpServer: {
        host: config.KEYCLOAK_SMTP_HOST,
        port: String(config.KEYCLOAK_SMTP_PORT),
        from: config.KEYCLOAK_SMTP_FROM,
        fromDisplayName: "Wota",
        auth: "false",
        starttls: "false",
        ssl: "false",
      },
    }),
  });
}

for (const role of ["wota-user", "wota-admin"]) {
  const existing = await request<Json>(
    `${realmPath}/roles/${role}`,
    token,
    {},
    true,
  );
  if (!existing)
    await request<void>(`${realmPath}/roles`, token, {
      method: "POST",
      body: JSON.stringify({ name: role, description: `Wota ${role}` }),
    });
}

async function upsertClient(value: Json) {
  const clients = await request<Array<Json & { id: string }>>(
    `${realmPath}/clients?clientId=${encodeURIComponent(String(value.clientId))}`,
    token,
  );
  if (clients?.[0])
    await request<void>(`${realmPath}/clients/${clients[0].id}`, token, {
      method: "PUT",
      body: JSON.stringify({ ...clients![0], ...value }),
    });
  else
    await request<void>(`${realmPath}/clients`, token, {
      method: "POST",
      body: JSON.stringify(value),
    });
  const saved = await request<Array<Json & { id: string }>>(
    `${realmPath}/clients?clientId=${encodeURIComponent(String(value.clientId))}`,
    token,
  );
  return saved![0];
}

await upsertClient({
  clientId: config.OIDC_CLIENT_ID,
  name: "Wota Web BFF",
  enabled: true,
  protocol: "openid-connect",
  publicClient: false,
  bearerOnly: false,
  standardFlowEnabled: true,
  implicitFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: false,
  secret: config.OIDC_CLIENT_SECRET,
  redirectUris: [config.oidcRedirectUri],
  webOrigins: [config.PUBLIC_ORIGIN],
  attributes: {
    "post.logout.redirect.uris": config.postLogoutRedirectUri,
  },
});

const adminClient = await upsertClient({
  clientId: config.KEYCLOAK_ADMIN_CLIENT_ID,
  name: "Wota API Admin",
  enabled: true,
  protocol: "openid-connect",
  publicClient: false,
  bearerOnly: false,
  standardFlowEnabled: false,
  implicitFlowEnabled: false,
  directAccessGrantsEnabled: false,
  serviceAccountsEnabled: true,
  secret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
});

const realmManagement = (await request<Array<Json & { id: string }>>(
  `${realmPath}/clients?clientId=realm-management`,
  token,
))![0];
const serviceAccount = await request<Json & { id: string }>(
  `${realmPath}/clients/${adminClient!.id}/service-account-user`,
  token,
);
const managementRoles = (await request<
  Array<Json & { id: string; name: string }>
>(`${realmPath}/clients/${realmManagement.id}/roles`, token))!;
const selectedRoles = managementRoles.filter((role) =>
  ["manage-users", "view-users", "view-realm"].includes(role.name),
);
const currentServiceRoles = (await request<Array<Json & { id: string }>>(
  `${realmPath}/users/${serviceAccount!.id}/role-mappings/clients/${realmManagement.id}`,
  token,
))!;
const currentRoleIds = new Set(currentServiceRoles.map((role) => role.id));
const missingRoles = selectedRoles.filter(
  (role) => !currentRoleIds.has(role.id),
);
if (missingRoles.length)
  await request<void>(
    `${realmPath}/users/${serviceAccount!.id}/role-mappings/clients/${realmManagement.id}`,
    token,
    { method: "POST", body: JSON.stringify(missingRoles) },
  );

console.log(`Keycloak realm ${config.KEYCLOAK_ADMIN_REALM} configured.`);
