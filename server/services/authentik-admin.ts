import type { AppConfig } from "../config";
import { AppError } from "../lib/errors";

type AuthentikGroup = {
  pk: string;
  name: string;
};

type AuthentikUser = {
  pk: number;
  uuid: string;
  username: string;
  name: string;
  email?: string;
  is_active: boolean;
  groups?: string[];
  groups_obj?: AuthentikGroup[];
  attributes?: Record<string, unknown>;
};

type AuthentikEmailStage = {
  pk: string;
  name: string;
};

type Paginated<T> = {
  results: T[];
  pagination: {
    count: number;
    current: number;
    total_pages: number;
  };
};

export type ProvisionedIdentity = {
  subject: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
};

export class AuthentikAdminService {
  private readonly groups = new Map<string, Promise<AuthentikGroup>>();
  private emailStage?: Promise<AuthentikEmailStage>;

  constructor(private readonly config: AppConfig) {}

  private get baseUrl() {
    if (
      !this.config.AUTHENTIK_ADMIN_BASE_URL ||
      !this.config.AUTHENTIK_ADMIN_TOKEN
    )
      throw new AppError(
        503,
        "authentik_admin_unconfigured",
        "Authentik 管理接口未配置。",
      );
    return this.config.AUTHENTIK_ADMIN_BASE_URL.replace(/\/$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}/api/v3${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.AUTHENTIK_ADMIN_TOKEN}`,
        "content-type": "application/json",
        ...this.publicForwardedHeaders(),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        const parsed = JSON.parse(body) as { detail?: string };
        message = parsed.detail ?? body;
      } catch {
        // Authentik can return plain text for proxy-level failures.
      }
      throw new AppError(
        502,
        "authentik_admin_request_failed",
        `Authentik 管理操作失败（${response.status}）：${message.slice(0, 240)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async listUsers(search = "", first = 0, max = 100) {
    return (await this.listUsersPage(search, first, max)).users;
  }

  async listUsersPage(search = "", first = 0, max = 100) {
    const page = Math.max(1, Math.floor(first / Math.max(1, max)) + 1);
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(max),
      include_groups: "true",
      include_roles: "true",
      groups_by_name: "wota-user",
    });
    query.append("type", "internal");
    query.append("type", "external");
    if (search) query.set("search", search);
    const response = await this.request<Paginated<AuthentikUser>>(
      `/core/users/?${query}`,
    );
    return {
      users: response.results,
      total: response.pagination.count,
    };
  }

  async findUserByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    const matches: AuthentikUser[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const query = new URLSearchParams({
        search: normalized,
        page: String(page),
        page_size: "100",
        include_groups: "true",
      });
      query.append("type", "internal");
      query.append("type", "external");
      const response = await this.request<Paginated<AuthentikUser>>(
        `/core/users/?${query}`,
      );
      matches.push(
        ...response.results.filter(
          (user) => user.email?.trim().toLowerCase() === normalized,
        ),
      );
      totalPages = response.pagination.total_pages;
      page += 1;
    } while (page <= totalPages);

    if (matches.length > 1)
      throw new AppError(
        409,
        "authentik_email_ambiguous",
        "Authentik 中存在多个相同邮箱账号，请先清理重复用户。",
      );
    return matches[0];
  }

  private groupByName(name: string) {
    const existing = this.groups.get(name);
    if (existing) return existing;
    const pending = this.request<Paginated<AuthentikGroup>>(
      `/core/groups/?${new URLSearchParams({ name, page_size: "10" })}`,
    )
      .then((response) => {
        const group = response.results.find((item) => item.name === name);
        if (!group)
          throw new AppError(
            503,
            "authentik_group_missing",
            `Authentik 组 ${name} 尚未初始化。`,
          );
        return group;
      })
      .catch((error) => {
        this.groups.delete(name);
        throw error;
      });
    this.groups.set(name, pending);
    return pending;
  }

  private recoveryEmailStage() {
    if (this.emailStage) return this.emailStage;
    const pending = this.request<Paginated<AuthentikEmailStage>>(
      `/stages/email/?${new URLSearchParams({
        name: this.config.AUTHENTIK_RECOVERY_EMAIL_STAGE,
        page_size: "10",
      })}`,
    )
      .then((response) => {
        const stage = response.results.find(
          (item) => item.name === this.config.AUTHENTIK_RECOVERY_EMAIL_STAGE,
        );
        if (!stage)
          throw new AppError(
            503,
            "authentik_email_stage_missing",
            "Authentik 恢复邮件阶段尚未初始化。",
          );
        return stage;
      })
      .catch((error) => {
        this.emailStage = undefined;
        throw error;
      });
    this.emailStage = pending;
    return pending;
  }

  async provisionUser(input: {
    email: string;
    name: string;
    isAdmin: boolean;
  }): Promise<ProvisionedIdentity> {
    const email = input.email.trim();
    const name = input.name.trim() || email;
    const [userGroup, adminGroup] = await Promise.all([
      this.groupByName("wota-user"),
      input.isAdmin ? this.groupByName("wota-admin") : undefined,
    ]);
    let user = await this.findUserByEmail(email);
    if (!user) {
      const username =
        email.length <= 150
          ? email.toLowerCase()
          : `user-${crypto.randomUUID()}`;
      user = await this.request<AuthentikUser>("/core/users/", {
        method: "POST",
        body: JSON.stringify({
          username,
          name,
          email,
          is_active: false,
          groups: [userGroup.pk, ...(adminGroup ? [adminGroup.pk] : [])],
          type: "internal",
          path: "users",
        }),
      });
    } else {
      const currentGroups = new Set(user.groups ?? []);
      currentGroups.add(userGroup.pk);
      if (adminGroup) currentGroups.add(adminGroup.pk);
      user = await this.request<AuthentikUser>(`/core/users/${user.pk}/`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          groups: [...currentGroups],
        }),
      });
    }

    const stage = await this.recoveryEmailStage();
    await this.request<void>(`/core/users/${user.pk}/recovery_email/`, {
      method: "POST",
      body: JSON.stringify({
        email_stage: stage.pk,
        token_duration: "days=7",
      }),
    });
    return {
      subject: user.uuid,
      email: user.email ?? email,
      displayName: user.name || name,
      emailVerified:
        user.attributes?.email_verified_address === (user.email ?? email),
    };
  }

  private publicForwardedHeaders() {
    const publicUrl = new URL(this.config.OIDC_ISSUER_URL);
    return {
      "x-forwarded-host": publicUrl.host,
      "x-forwarded-proto": publicUrl.protocol.replace(":", ""),
      ...(publicUrl.port ? { "x-forwarded-port": publicUrl.port } : {}),
    };
  }
}
