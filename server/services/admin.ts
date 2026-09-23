import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { audioAssets, auditLogs, shares, users } from "../db/schema";
import type { AdminUserPage, ShareSummary } from "../../src/core/share";
import { AppError } from "../lib/errors";
import { KeycloakAdminService } from "./keycloak-admin";
import { toSummary } from "./shares";
import { upsertProvisionedUser } from "./users";

export async function listAdminUsers(
  db: Database,
  config: AppConfig,
  keycloak: KeycloakAdminService,
  page: number,
  pageSize: number,
  search = "",
): Promise<AdminUserPage> {
  const keycloakPage = await keycloak.listUsersPage(
    search,
    (page - 1) * pageSize,
    pageSize,
  );
  for (const user of keycloakPage.users) {
    if (!user.email) continue;
    await upsertProvisionedUser(db, config, {
      subject: user.id,
      email: user.email,
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username,
      emailVerified: user.emailVerified === true,
      isAdmin: false,
    });
  }
  const subjects = keycloakPage.users.map((user) => user.id);
  const localUsers = subjects.length
    ? await db.select().from(users).where(inArray(users.subject, subjects))
    : [];
  const localBySubject = new Map(
    localUsers.map((user) => [user.subject, user]),
  );
  const shareCounts = localUsers.length
    ? await db
        .select({ userId: shares.userId, value: count() })
        .from(shares)
        .where(
          and(
            isNull(shares.deletedAt),
            inArray(
              shares.userId,
              localUsers.map((user) => user.id),
            ),
          ),
        )
        .groupBy(shares.userId)
    : [];
  const countByUser = new Map(
    shareCounts.map((row) => [row.userId, Number(row.value)]),
  );
  return {
    users: keycloakPage.users.flatMap((external) => {
      const local = localBySubject.get(external.id);
      if (!local) return [];
      return [
        {
          id: local.id,
          email: local.email,
          name: local.displayName,
          emailVerified: local.emailVerified,
          isAdmin: local.role === "admin",
          quotaBytes: local.quotaBytes,
          usedBytes: local.usedBytes,
          shareCount: countByUser.get(local.id) ?? 0,
          createdAt: local.createdAt.toISOString(),
        },
      ];
    }),
    total: keycloakPage.total,
    page,
    pageSize,
  };
}

export async function listAdminUserShares(
  db: Database,
  config: AppConfig,
  userId: string,
): Promise<ShareSummary[]> {
  const rows = await db
    .select({ share: shares, audio: audioAssets })
    .from(shares)
    .leftJoin(
      audioAssets,
      and(eq(audioAssets.shareId, shares.id), isNull(audioAssets.deletedAt)),
    )
    .where(and(eq(shares.userId, userId), isNull(shares.deletedAt)))
    .orderBy(asc(shares.updatedAt));
  return rows.map((row) =>
    toSummary(row.share, config.PUBLIC_ORIGIN, row.audio),
  );
}

export async function setUserQuota(
  db: Database,
  input: { actorUserId: string; userId: string; quotaBytes: number },
) {
  if (!Number.isSafeInteger(input.quotaBytes) || input.quotaBytes < 0)
    throw new AppError(422, "invalid_quota", "配额必须是非负整数。");
  const updated = await db
    .update(users)
    .set({ quotaBytes: input.quotaBytes, updatedAt: new Date() })
    .where(eq(users.id, input.userId))
    .returning();
  if (!updated[0]) throw new AppError(404, "user_not_found", "用户不存在。");
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: "set_quota",
    targetType: "user",
    targetId: input.userId,
    details: { quotaBytes: input.quotaBytes },
  });
  return updated[0];
}

export async function promoteAdmin(
  db: Database,
  config: AppConfig,
  keycloak: KeycloakAdminService,
  input: { actorUserId: string; email: string; name: string },
) {
  const provisioned = await keycloak.provisionUser({
    email: input.email,
    name: input.name || input.email,
    isAdmin: true,
  });
  const user = await upsertProvisionedUser(db, config, {
    ...provisioned,
    isAdmin: true,
  });
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: "add_admin",
    targetType: "user",
    targetId: user.id,
    details: { email: input.email },
  });
  return user;
}
