import { eq } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import { users } from "../db/schema";
import type { OidcIdentity } from "./oidc";

export async function ensureUser(
  db: Database,
  config: AppConfig,
  identity: OidcIdentity,
) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.subject, identity.subject))
    .limit(1);
  if (existing[0]) {
    const next = await db
      .update(users)
      .set({
        email: identity.email,
        displayName: identity.name,
        emailVerified: identity.emailVerified,
        role: identity.isAdmin ? "admin" : "user",
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id))
      .returning();
    return next[0];
  }
  const inserted = await db
    .insert(users)
    .values({
      subject: identity.subject,
      email: identity.email,
      displayName: identity.name,
      emailVerified: identity.emailVerified,
      role: identity.isAdmin ? "admin" : "user",
      quotaBytes: config.DEFAULT_QUOTA_BYTES,
    })
    .returning();
  return inserted[0];
}

export async function upsertProvisionedUser(
  db: Database,
  config: AppConfig,
  value: {
    subject: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
    isAdmin: boolean;
  },
) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.subject, value.subject))
    .limit(1);
  if (existing[0]) {
    const updated = await db
      .update(users)
      .set({
        email: value.email,
        displayName: value.displayName,
        emailVerified: value.emailVerified,
        role: value.isAdmin ? "admin" : existing[0].role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id))
      .returning();
    return updated[0];
  }
  const inserted = await db
    .insert(users)
    .values({
      subject: value.subject,
      email: value.email,
      displayName: value.displayName,
      emailVerified: value.emailVerified,
      role: value.isAdmin ? "admin" : "user",
      quotaBytes: config.DEFAULT_QUOTA_BYTES,
    })
    .returning();
  return inserted[0];
}
