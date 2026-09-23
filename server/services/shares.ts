import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { rename } from "node:fs/promises";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import {
  audioAssets,
  auditLogs,
  quotaEvents,
  shares,
  users,
} from "../db/schema";
import { randomToken } from "../lib/crypto";
import { AppError } from "../lib/errors";
import {
  shareSnapshotSchema,
  type PublicShare,
  type ShareSnapshot,
  type ShareSummary,
} from "../../src/core/share";
import {
  audioStoragePath,
  inspectAudio,
  prepareAudioDestination,
  removeAudioFile,
  safeOriginalName,
} from "./audio";

export type UploadedAudio = {
  tempPath: string;
  originalName: string;
};

export type PublishShareInput = {
  userId: string;
  projectId: string;
  shareId?: string;
  snapshot: unknown;
  audio?: UploadedAudio;
  preserveAudio: boolean;
};

export type AdminActor = { userId: string; isAdmin: true };

export async function publishShare(
  db: Database,
  config: AppConfig,
  input: PublishShareInput,
) {
  const parsedSnapshot = shareSnapshotSchema.parse(input.snapshot);
  const inspected = input.audio
    ? await inspectAudio(input.audio.tempPath)
    : null;
  if (inspected && inspected.sizeBytes > config.MAX_AUDIO_BYTES)
    throw new AppError(413, "audio_too_large", "音频文件超过单文件上限。");

  let newPath: string | null = null;
  let oldPath: string | null = null;
  try {
    const result = await db.transaction(async (tx) => {
      const lockedUsers = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
        .for("update");
      const user = lockedUsers[0];
      if (!user) throw new AppError(401, "unauthorized", "请先登录。");

      const existingRows = input.shareId
        ? await tx
            .select()
            .from(shares)
            .where(
              and(
                eq(shares.id, input.shareId),
                eq(shares.userId, input.userId),
                isNull(shares.deletedAt),
              ),
            )
            .limit(1)
            .for("update")
        : await tx
            .select()
            .from(shares)
            .where(
              and(
                eq(shares.userId, input.userId),
                eq(shares.projectId, input.projectId),
                isNull(shares.deletedAt),
              ),
            )
            .limit(1)
            .for("update");
      const existing = existingRows[0];
      const shareId = existing?.id ?? crypto.randomUUID();
      const token = existing?.token ?? randomToken(32);

      if (!existing) {
        await tx.insert(shares).values({
          id: shareId,
          userId: user.id,
          projectId: input.projectId,
          token,
          snapshot: parsedSnapshot,
        });
      }

      const audioRows = existing
        ? await tx
            .select()
            .from(audioAssets)
            .where(eq(audioAssets.shareId, shareId))
            .for("update")
        : [];
      const activeAudio = audioRows.find((asset) => !asset.deletedAt);
      const reusableAudio = activeAudio ?? audioRows[0];
      oldPath = activeAudio?.storagePath ?? null;

      let nextAudio = activeAudio;
      let deltaBytes = 0;
      if (inspected && input.audio) {
        if (activeAudio && activeAudio.sha256 === inspected.sha256) {
          nextAudio = activeAudio;
        } else {
          deltaBytes = inspected.sizeBytes - (activeAudio?.sizeBytes ?? 0);
          const nextUsed = user.usedBytes + deltaBytes;
          if (nextUsed > user.quotaBytes)
            throw new AppError(
              413,
              "quota_exceeded",
              "云空间不足，请先删除其他在线编排的音乐或联系管理员扩容。",
            );
          const assetId = reusableAudio?.id ?? crypto.randomUUID();
          newPath = audioStoragePath(
            config.AUDIO_STORAGE_DIR,
            input.userId,
            shareId,
            assetId,
            inspected.extension,
          );
          await prepareAudioDestination(newPath);
          await rename(input.audio.tempPath, newPath);
          const values = {
            originalName: safeOriginalName(input.audio.originalName),
            mimeType: inspected.mimeType,
            sizeBytes: inspected.sizeBytes,
            duration: inspected.durationMs,
            sha256: inspected.sha256,
            storagePath: newPath,
            deletedAt: null,
            updatedAt: new Date(),
          };
          if (reusableAudio) {
            const updated = await tx
              .update(audioAssets)
              .set(values)
              .where(eq(audioAssets.id, reusableAudio.id))
              .returning();
            nextAudio = updated[0];
          } else {
            const inserted = await tx
              .insert(audioAssets)
              .values({ id: assetId, shareId, ...values })
              .returning();
            nextAudio = inserted[0];
          }
          await tx
            .update(users)
            .set({ usedBytes: nextUsed, updatedAt: new Date() })
            .where(eq(users.id, user.id));
          await tx.insert(quotaEvents).values({
            userId: user.id,
            shareId,
            deltaBytes,
            reason: activeAudio ? "replace_audio" : "upload_audio",
          });
        }
      }

      const snapshot = withAudioMetadata(parsedSnapshot, nextAudio);
      const saved = await tx
        .update(shares)
        .set({
          revision: existing ? sql`${shares.revision} + 1` : 1,
          snapshot,
          updatedAt: new Date(),
        })
        .where(eq(shares.id, shareId))
        .returning();
      return { share: saved[0], audio: nextAudio };
    });

    if (oldPath && newPath && oldPath !== newPath)
      await removeAudioFile(oldPath);
    return toSummary(result.share, config.PUBLIC_ORIGIN, result.audio);
  } catch (error) {
    if (newPath) await removeAudioFile(newPath);
    throw error;
  }
}

export async function listShares(
  db: Database,
  config: AppConfig,
  userId: string,
) {
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

export async function getPublicShare(
  db: Database,
  config: AppConfig,
  token: string,
): Promise<PublicShare> {
  const rows = await db
    .select({ share: shares, audio: audioAssets })
    .from(shares)
    .leftJoin(
      audioAssets,
      and(eq(audioAssets.shareId, shares.id), isNull(audioAssets.deletedAt)),
    )
    .where(and(eq(shares.token, token), isNull(shares.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError(404, "share_not_found", "分享不存在或已取消。");
  return {
    token: row.share.token,
    revision: row.share.revision,
    publishedAt: row.share.publishedAt.toISOString(),
    updatedAt: row.share.updatedAt.toISOString(),
    snapshot: withAudioMetadata(row.share.snapshot, row.audio ?? undefined),
    audioAvailable: Boolean(row.audio),
    audioUrl: `/api/public/shares/${row.share.token}/audio`,
  };
}

export async function deleteShareAudio(
  db: Database,
  input: {
    userId: string;
    shareId: string;
    actorUserId?: string;
    isAdmin?: boolean;
  },
) {
  let path: string | null = null;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ share: shares, user: users })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.userId))
      .where(
        and(
          eq(shares.id, input.shareId),
          isNull(shares.deletedAt),
          input.isAdmin ? undefined : eq(shares.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update");
    const row = rows[0];
    if (!row) throw new AppError(404, "share_not_found", "在线编排不存在。");
    const assetRows = await tx
      .select()
      .from(audioAssets)
      .where(
        and(
          eq(audioAssets.shareId, row.share.id),
          isNull(audioAssets.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    const asset = assetRows[0];
    if (!asset) return;
    path = asset.storagePath;
    const usedBytes = Math.max(0, row.user.usedBytes - asset.sizeBytes);
    await tx
      .update(audioAssets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(audioAssets.id, asset.id));
    await tx
      .update(users)
      .set({ usedBytes, updatedAt: new Date() })
      .where(eq(users.id, row.user.id));
    await tx.insert(quotaEvents).values({
      userId: row.user.id,
      shareId: row.share.id,
      actorUserId: input.actorUserId ?? input.userId,
      deltaBytes: -asset.sizeBytes,
      reason: input.isAdmin ? "admin_delete_audio" : "delete_audio",
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId ?? input.userId,
      action: "delete_audio",
      targetType: "share",
      targetId: row.share.id,
      details: { sizeBytes: asset.sizeBytes },
    });
  });
  await removeAudioFile(path);
}

export async function deleteShare(
  db: Database,
  input: {
    userId: string;
    shareId: string;
    actorUserId?: string;
    isAdmin?: boolean;
  },
) {
  let path: string | null = null;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ share: shares, user: users })
      .from(shares)
      .innerJoin(users, eq(users.id, shares.userId))
      .where(
        and(
          eq(shares.id, input.shareId),
          isNull(shares.deletedAt),
          input.isAdmin ? undefined : eq(shares.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update");
    const row = rows[0];
    if (!row) throw new AppError(404, "share_not_found", "在线编排不存在。");
    const assetRows = await tx
      .select()
      .from(audioAssets)
      .where(
        and(
          eq(audioAssets.shareId, row.share.id),
          isNull(audioAssets.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    const asset = assetRows[0];
    path = asset?.storagePath ?? null;
    const removedBytes = asset?.sizeBytes ?? 0;
    await tx
      .update(shares)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(shares.id, row.share.id));
    if (asset)
      await tx
        .update(audioAssets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(audioAssets.id, asset.id));
    if (removedBytes) {
      await tx
        .update(users)
        .set({
          usedBytes: Math.max(0, row.user.usedBytes - removedBytes),
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.user.id));
      await tx.insert(quotaEvents).values({
        userId: row.user.id,
        shareId: row.share.id,
        actorUserId: input.actorUserId ?? input.userId,
        deltaBytes: -removedBytes,
        reason: input.isAdmin ? "admin_delete_share" : "delete_share",
      });
    }
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId ?? input.userId,
      action: "delete_share",
      targetType: "share",
      targetId: row.share.id,
      details: { removedBytes },
    });
  });
  await removeAudioFile(path);
}

export async function getAudioAssetByToken(db: Database, token: string) {
  const rows = await db
    .select({ share: shares, asset: audioAssets })
    .from(shares)
    .innerJoin(audioAssets, eq(audioAssets.shareId, shares.id))
    .where(
      and(
        eq(shares.token, token),
        isNull(shares.deletedAt),
        isNull(audioAssets.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError(404, "audio_not_found", "云端音乐不存在。");
  return row;
}

export function toSummary(
  share: typeof shares.$inferSelect,
  publicOrigin: string,
  audio?: typeof audioAssets.$inferSelect | null,
): ShareSummary {
  return {
    id: share.id,
    projectId: share.projectId,
    token: share.token,
    url: `${publicOrigin.replace(/\/$/, "")}/s/${share.token}`,
    songName: share.snapshot.songName,
    revision: share.revision,
    publishedAt: share.publishedAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
    audio: audio
      ? {
          name: audio.originalName,
          mimeType: audio.mimeType,
          sizeBytes: audio.sizeBytes,
          duration: audio.duration / 1000,
        }
      : null,
  };
}

function withAudioMetadata(
  snapshot: ShareSnapshot,
  audio?: typeof audioAssets.$inferSelect,
): ShareSnapshot {
  return {
    ...snapshot,
    audio: audio
      ? {
          name: audio.originalName,
          duration: audio.duration / 1000,
          mimeType: audio.mimeType,
          sizeBytes: audio.sizeBytes,
        }
      : snapshot.audio,
  };
}
