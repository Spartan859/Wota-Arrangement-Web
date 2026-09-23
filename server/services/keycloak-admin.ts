import type { AppConfig } from "../config";
import { AppError } from "../lib/errors";

type KeycloakUser = {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
};

type KeycloakRole = { id: string; name: string };

export type ProvisionedIdentity = {
  subject: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
};

export class KeycloakAdminService {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: AppConfig) {}

  private get baseUrl() {
    if (!this.config.KEYCLOAK_ADMIN_BASE_URL)
      throw new AppError(
        503,
        "keycloak_admin_unconfigured",
        "Keycloak 管理接口未配置。",
      );
    return this.config.KEYCLOAK_ADMIN_BASE_URL.replace(/\/$/, "");
  }

  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000)
      return this.token.value;
    if (
      !this.config.KEYCLOAK_ADMIN_CLIENT_ID ||
      !this.config.KEYCLOAK_ADMIN_CLIENT_SECRET
    )
      throw new AppError(
        503,
        "keycloak_admin_unconfigured",
        "Keycloak 管理客户端未配置。",
      );
    const response = await fetch(
      `${this.baseUrl}/realms/${encodeURIComponent(this.config.KEYCLOAK_ADMIN_REALM)}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.config.KEYCLOAK_ADMIN_CLIENT_ID,
          client_secret: this.config.KEYCLOAK_ADMIN_CLIENT_SECRET,
        }),
      },
    );
    if (!response.ok)
      throw new AppError(
        502,
        "keycloak_admin_auth_failed",
        "无法连接 Keycloak 管理接口。",
      );
    const payload = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 60) * 1000,
    };
    return payload.access_token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(
      `${this.baseUrl}/admin/realms/${encodeURIComponent(this.config.KEYCLOAK_ADMIN_REALM)}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          "content-type": "application/json",
          ...init?.headers,
        },
      },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new AppError(
        502,
        "keycloak_admin_request_failed",
        `Keycloak 管理操作失败（${response.status}）：${message.slice(0, 240)}`,
      );
    }
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async listUsers(search = "", first = 0, max = 100) {
    return (await this.listUsersPage(search, first, max)).users;
  }

  async listUsersPage(search = "", first = 0, max = 100) {
    const query = new URLSearchParams({
      first: String(first),
      max: String(max),
    });
    if (search) query.set("search", search);
    const response = await fetch(
      `${this.baseUrl}/admin/realms/${encodeURIComponent(this.config.KEYCLOAK_ADMIN_REALM)}/users?${query}`,
      {
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          "content-type": "application/json",
        },
      },
    );
    if (!response.ok)
      throw new AppError(
        502,
        "keycloak_admin_request_failed",
        `Keycloak 用户列表读取失败（${response.status}）。`,
      );
    const users = (await response.json()) as KeycloakUser[];
    return {
      users,
      total: Number(response.headers.get("x-total-count") ?? users.length),
    };
  }

  async findUserByEmail(email: string) {
    const query = new URLSearchParams({ email, exact: "true" });
    const users = await this.request<KeycloakUser[]>(`/users?${query}`);
    return users[0];
  }

  async provisionUser(input: {
    email: string;
    name: string;
    isAdmin: boolean;
  }): Promise<ProvisionedIdentity> {
    let user = await this.findUserByEmail(input.email);
    if (!user) {
      await this.request<void>("/users", {
        method: "POST",
        body: JSON.stringify({
          username: input.email,
          email: input.email,
          firstName: input.name,
          lastName: input.name,
          enabled: true,
          emailVerified: false,
        }),
      });
      user = await this.findUserByEmail(input.email);
    }
    if (!user)
      throw new AppError(
        502,
        "keycloak_user_missing",
        "Keycloak 未返回已创建用户。",
      );
    if (!user.firstName || !user.lastName)
      await this.request<void>(`/users/${encodeURIComponent(user.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...user,
          firstName: user.firstName || input.name,
          lastName: user.lastName || input.name,
        }),
      });
    if (input.isAdmin) await this.grantRealmRole(user.id, "wota-admin");
    await this.sendActionsEmail(user.id);
    return {
      subject: user.id,
      email: user.email ?? input.email,
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(" ") || input.name,
      emailVerified: user.emailVerified === true,
    };
  }

  private async grantRealmRole(userId: string, roleName: string) {
    const role = await this.request<KeycloakRole>(
      `/roles/${encodeURIComponent(roleName)}`,
    );
    const current = await this.request<KeycloakRole[]>(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    );
    if (current.some((item) => item.name === roleName)) return;
    await this.request<void>(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      {
        method: "POST",
        body: JSON.stringify([role]),
      },
    );
  }

  private async sendActionsEmail(userId: string) {
    await this.request<void>(
      `/users/${encodeURIComponent(userId)}/execute-actions-email?lifespan=604800`,
      {
        method: "PUT",
        body: JSON.stringify(["VERIFY_EMAIL", "UPDATE_PASSWORD"]),
      },
    );
  }
}
