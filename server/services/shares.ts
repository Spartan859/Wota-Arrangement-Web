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
  videoAssets,
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
import {
  inspectVideo,
  prepareVideoDestination,
  removeVideoFile,
  videoStoragePath,
  type VideoInspection,
} from "./video";

export type UploadedAudio = { tempPath: string; originalName: string };
export type UploadedVideo = UploadedAudio & { assetKey: string };

export type PublishShareInput = {
  userId: string;
  projectId: string;
  shareId?: string;
  snapshot: unknown;
  audio?: UploadedAudio;
  videos?: UploadedVideo[];
  preserveAudio: boolean;
};

export async function publishShare(
  db: Database,
  config: AppConfig,
  input: PublishShareInput,
) {
  const parsedSnapshot = shareSnapshotSchema.parse(input.snapshot);
  const inspectedAudio = input.audio
    ? await inspectAudio(input.audio.tempPath)
    : null;
  if (inspectedAudio && inspectedAudio.sizeBytes > config.MAX_AUDIO_BYTES)
    throw new AppError(413, "audio_too_large", "音频文件超过单文件上限。");

  const inspectedVideos = new Map<
    string,
    { upload: UploadedVideo; inspected: VideoInspection }
  >();
  for (const upload of input.videos ?? []) {
    const inspected = await inspectVideo(upload.tempPath);
    if (inspected.sizeBytes > config.MAX_VIDEO_BYTES)
      throw new AppError(413, "video_too_large", "视频文件超过单文件上限。");
    inspectedVideos.set(upload.assetKey, { upload, inspected });
  }

  const newAudioPath: { value: string | null } = { value: null };
  const oldAudioPaths: string[] = [];
  const newVideoPaths: string[] = [];
  const oldVideoPaths: string[] = [];
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
      let usedBytes = user.usedBytes;

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
      let nextAudio = activeAudio;

      if (inspectedAudio && input.audio) {
        if (activeAudio && activeAudio.sha256 === inspectedAudio.sha256) {
          nextAudio = activeAudio;
        } else {
          if (activeAudio) oldAudioPaths.push(activeAudio.storagePath);
          const deltaBytes =
            inspectedAudio.sizeBytes - (activeAudio?.sizeBytes ?? 0);
          if (usedBytes + deltaBytes > user.quotaBytes)
            throw new AppError(
              413,
              "quota_exceeded",
              "云空间不足，请先删除其他在线编排的媒体或联系管理员扩容。",
            );
          const assetId = reusableAudio?.id ?? crypto.randomUUID();
          const path = audioStoragePath(
            config.AUDIO_STORAGE_DIR,
            input.userId,
            shareId,
            assetId,
            inspectedAudio.extension,
          );
          await prepareAudioDestination(path);
          await rename(input.audio.tempPath, path);
          newAudioPath.value = path;
          const values = {
            originalName: safeOriginalName(input.audio.originalName),
            mimeType: inspectedAudio.mimeType,
            sizeBytes: inspectedAudio.sizeBytes,
            duration: inspectedAudio.durationMs,
            sha256: inspectedAudio.sha256,
            storagePath: path,
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
          usedBytes += deltaBytes;
          await tx.insert(quotaEvents).values({
            userId: user.id,
            shareId,
            deltaBytes,
            reason: activeAudio ? "replace_audio" : "upload_audio",
          });
        }
      }

      const videoRows = existing
        ? await tx
            .select()
            .from(videoAssets)
            .where(eq(videoAssets.shareId, shareId))
            .for("update")
        : [];
      const activeVideos = new Map(
        videoRows
          .filter((asset) => !asset.deletedAt)
          .map((asset) => [asset.assetKey, asset]),
      );
      const reusableVideos = new Map(
        videoRows.map((asset) => [asset.assetKey, asset]),
      );
      const desiredVideos = parsedSnapshot.choreography?.videoAssets ?? [];
      const desiredKeys = new Set(desiredVideos.map((asset) => asset.id));
      const nextVideos = new Map<string, typeof videoAssets.$inferSelect>();

      for (const desired of desiredVideos) {
        const active = activeVideos.get(desired.id);
        const upload = inspectedVideos.get(desired.id);
        if (!upload) {
          if (!active)
            throw new AppError(
              422,
              "video_missing",
              `视频“${desired.name}”缺少本地文件或云端资源，无法发布。`,
            );
          nextVideos.set(desired.id, active);
          continue;
        }
        if (active && active.sha256 === upload.inspected.sha256) {
          nextVideos.set(desired.id, active);
          continue;
        }
        if (active) oldVideoPaths.push(active.storagePath);
        const reusable = reusableVideos.get(desired.id);
        const deltaBytes =
          upload.inspected.sizeBytes - (active?.sizeBytes ?? 0);
        if (usedBytes + deltaBytes > user.quotaBytes)
          throw new AppError(
            413,
            "quota_exceeded",
            "云空间不足，请先删除其他在线编排的媒体或联系管理员扩容。",
          );
        const assetId = reusable?.id ?? crypto.randomUUID();
        const path = videoStoragePath(
          config.AUDIO_STORAGE_DIR,
          input.userId,
          shareId,
          `${assetId}-${crypto.randomUUID()}`,
        );
        await prepareVideoDestination(path);
        await rename(upload.upload.tempPath, path);
        newVideoPaths.push(path);
        const values = {
          assetKey: desired.id,
          originalName: safeOriginalName(upload.upload.originalName),
          mimeType: upload.inspected.mimeType,
          sizeBytes: upload.inspected.sizeBytes,
          duration: upload.inspected.durationMs,
          width: upload.inspected.width,
          height: upload.inspected.height,
          frameRate: upload.inspected.frameRate,
          sha256: upload.inspected.sha256,
          storagePath: path,
          deletedAt: null,
          updatedAt: new Date(),
        };
        const saved = reusable
          ? (
              await tx
                .update(videoAssets)
                .set(values)
                .where(eq(videoAssets.id, reusable.id))
                .returning()
            )[0]
          : (
              await tx
                .insert(videoAssets)
                .values({ id: assetId, shareId, ...values })
                .returning()
            )[0];
        nextVideos.set(desired.id, saved);
        usedBytes += deltaBytes;
        await tx.insert(quotaEvents).values({
          userId: user.id,
          shareId,
          deltaBytes,
          reason: active ? "replace_video" : "upload_video",
        });
      }

      for (const [assetKey, asset] of activeVideos) {
        if (desiredKeys.has(assetKey)) continue;
        oldVideoPaths.push(asset.storagePath);
        usedBytes -= asset.sizeBytes;
        await tx
          .update(videoAssets)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(videoAssets.id, asset.id));
        await tx.insert(quotaEvents).values({
          userId: user.id,
          shareId,
          deltaBytes: -asset.sizeBytes,
          reason: "delete_video",
        });
      }

      const snapshot = withMediaMetadata(parsedSnapshot, nextAudio, [
        ...nextVideos.values(),
      ]);
      const saved = await tx
        .update(shares)
        .set({
          revision: existing ? sql`${shares.revision} + 1` : 1,
          snapshot,
          updatedAt: new Date(),
        })
        .where(eq(shares.id, shareId))
        .returning();
      if (usedBytes !== user.usedBytes)
        await tx
          .update(users)
          .set({ usedBytes, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      return {
        share: saved[0],
        audio: nextAudio,
        videos: [...nextVideos.values()],
      };
    });

    for (const path of [...oldAudioPaths, ...oldVideoPaths])
      if (!newVideoPaths.includes(path) && path !== newAudioPath.value)
        await removeAudioFile(path);
    return toSummary(
      result.share,
      config.PUBLIC_ORIGIN,
      result.audio,
      result.videos,
    );
  } catch (error) {
    for (const path of newVideoPaths) await removeVideoFile(path);
    if (newAudioPath.value) await removeAudioFile(newAudioPath.value);
    throw error;
  }
}

export async function listShares(
  db: Database,
  config: AppConfig,
  userId: string,
) {
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.userId, userId), isNull(shares.deletedAt)))
    .orderBy(asc(shares.updatedAt));
  return Promise.all(
    rows.map(async (share) => {
      const [audio] = await db
        .select()
        .from(audioAssets)
        .where(
          and(eq(audioAssets.shareId, share.id), isNull(audioAssets.deletedAt)),
        )
        .limit(1);
      const videos = await db
        .select()
        .from(videoAssets)
        .where(
          and(eq(videoAssets.shareId, share.id), isNull(videoAssets.deletedAt)),
        );
      return toSummary(share, config.PUBLIC_ORIGIN, audio, videos);
    }),
  );
}

export async function getPublicShare(
  db: Database,
  config: AppConfig,
  token: string,
): Promise<PublicShare> {
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.token, token), isNull(shares.deletedAt)))
    .limit(1);
  const share = rows[0];
  if (!share)
    throw new AppError(404, "share_not_found", "分享不存在或已取消。");
  const [audio] = await db
    .select()
    .from(audioAssets)
    .where(
      and(eq(audioAssets.shareId, share.id), isNull(audioAssets.deletedAt)),
    )
    .limit(1);
  const availableVideos = await db
    .select()
    .from(videoAssets)
    .where(
      and(eq(videoAssets.shareId, share.id), isNull(videoAssets.deletedAt)),
    );
  const availableById = new Map(
    availableVideos.map((asset) => [asset.assetKey, asset]),
  );
  const snapshot = withMediaMetadata(share.snapshot, audio, availableVideos);
  return {
    token: share.token,
    revision: share.revision,
    publishedAt: share.publishedAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
    snapshot,
    audioAvailable: Boolean(audio),
    audioUrl: `/api/public/shares/${share.token}/audio`,
    videos: (snapshot.choreography?.videoAssets ?? []).map((asset) => {
      const stored = availableById.get(asset.id);
      return {
        ...asset,
        url: `/api/public/shares/${share.token}/videos/${encodeURIComponent(asset.id)}`,
        available: Boolean(stored),
      };
    }),
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
    const [asset] = await tx
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
    if (!asset) return;
    path = asset.storagePath;
    await tx
      .update(audioAssets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(audioAssets.id, asset.id));
    await tx
      .update(users)
      .set({
        usedBytes: Math.max(0, row.user.usedBytes - asset.sizeBytes),
        updatedAt: new Date(),
      })
      .where(eq(users.id, row.user.id));
    await tx.insert(quotaEvents).values({
      userId: row.user.id,
      shareId: row.share.id,
      actorUserId: input.actorUserId ?? input.userId,
      deltaBytes: -asset.sizeBytes,
      reason: input.isAdmin ? "admin_delete_audio" : "delete_audio",
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
  const paths: string[] = [];
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
    const [audio] = await tx
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
    const videos = await tx
      .select()
      .from(videoAssets)
      .where(
        and(
          eq(videoAssets.shareId, row.share.id),
          isNull(videoAssets.deletedAt),
        ),
      )
      .for("update");
    const removedBytes =
      (audio?.sizeBytes ?? 0) +
      videos.reduce((sum, asset) => sum + asset.sizeBytes, 0);
    paths.push(
      ...[
        audio?.storagePath,
        ...videos.map((asset) => asset.storagePath),
      ].filter((path): path is string => Boolean(path)),
    );
    await tx
      .update(shares)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(shares.id, row.share.id));
    if (audio)
      await tx
        .update(audioAssets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(audioAssets.id, audio.id));
    for (const video of videos)
      await tx
        .update(videoAssets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(videoAssets.id, video.id));
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
  await Promise.all(paths.map((path) => removeAudioFile(path)));
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

export async function getVideoAssetByToken(
  db: Database,
  token: string,
  assetKey: string,
) {
  const rows = await db
    .select({ share: shares, asset: videoAssets })
    .from(shares)
    .innerJoin(videoAssets, eq(videoAssets.shareId, shares.id))
    .where(
      and(
        eq(shares.token, token),
        eq(videoAssets.assetKey, assetKey),
        isNull(shares.deletedAt),
        isNull(videoAssets.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError(404, "video_not_found", "云端视频不存在。");
  return row;
}

export function toSummary(
  share: typeof shares.$inferSelect,
  publicOrigin: string,
  audio?: typeof audioAssets.$inferSelect | null,
  videos: (typeof videoAssets.$inferSelect)[] = [],
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
    videos: videos
      .filter((asset) => !asset.deletedAt)
      .map((asset) => ({
        id: asset.assetKey,
        sourceVersion:
          share.snapshot.choreography?.videoAssets.find(
            (item) => item.id === asset.assetKey,
          )?.sourceVersion ?? "server",
        name: asset.originalName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        duration: asset.duration / 1000,
        width: asset.width,
        height: asset.height,
        frameRate: asset.frameRate,
      })),
  };
}

function withMediaMetadata(
  snapshot: ShareSnapshot,
  audio?: typeof audioAssets.$inferSelect | null,
  videos: (typeof videoAssets.$inferSelect)[] = [],
): ShareSnapshot {
  const videoById = new Map(videos.map((asset) => [asset.assetKey, asset]));
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
    choreography: snapshot.choreography
      ? {
          ...snapshot.choreography,
          videoAssets: snapshot.choreography.videoAssets.map((asset) => {
            const stored = videoById.get(asset.id);
            return stored
              ? {
                  ...asset,
                  name: stored.originalName,
                  mimeType: stored.mimeType,
                  sizeBytes: stored.sizeBytes,
                  duration: stored.duration / 1000,
                  width: stored.width,
                  height: stored.height,
                  frameRate: stored.frameRate,
                }
              : asset;
          }),
        }
      : snapshot.choreography,
  };
}
