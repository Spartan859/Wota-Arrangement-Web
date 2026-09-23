import { z } from "zod";
import { blockSchema, type Project } from "./model";
import { choreographySchema } from "./choreography";

export const defaultQuotaBytes = 100 * 1024 * 1024;
export const maxAudioBytes = defaultQuotaBytes;
export const audioDurationWarningSeconds = 0.5;
export const maxSyncOffsetSeconds = 30;

export const shareSnapshotSchema = z.object({
  snapshotVersion: z.literal(1),
  sourceProjectVersion: z.literal(2),
  songName: z.string(),
  bpm: z.string(),
  blocks: z.array(blockSchema),
  choreography: choreographySchema.optional(),
  audio: z
    .object({
      name: z.string(),
      duration: z.number().finite().positive(),
      mimeType: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .nullable(),
});

export type ShareSnapshot = z.infer<typeof shareSnapshotSchema>;

export const shareSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  token: z.string(),
  url: z.string(),
  songName: z.string(),
  revision: z.number().int().positive(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  audio: z
    .object({
      name: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number().int().nonnegative(),
      duration: z.number().finite().positive(),
    })
    .nullable(),
});

export type ShareSummary = z.infer<typeof shareSummarySchema>;

export const publicShareSchema = z.object({
  token: z.string(),
  revision: z.number().int().positive(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  snapshot: shareSnapshotSchema,
  audioAvailable: z.boolean(),
  audioUrl: z.string(),
});

export type PublicShare = z.infer<typeof publicShareSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  isAdmin: z.boolean(),
  quotaBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionSchema = z.object({
  authenticated: z.boolean(),
  csrfToken: z.string().nullable(),
  user: sessionUserSchema.nullable(),
});

export type SessionState = z.infer<typeof sessionSchema>;

export const adminUserSchema = sessionUserSchema.extend({
  shareCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserPageSchema = z.object({
  users: z.array(adminUserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export type AdminUserPage = z.infer<typeof adminUserPageSchema>;

export function createShareSnapshot(
  project: Project,
  audio: ShareSnapshot["audio"] = project.audio
    ? {
        name: project.audio.name,
        duration: project.audio.duration,
        mimeType: "",
        sizeBytes: 0,
      }
    : null,
): ShareSnapshot {
  return shareSnapshotSchema.parse({
    snapshotVersion: 1,
    sourceProjectVersion: project.schemaVersion,
    songName: project.songName,
    bpm: project.bpm,
    blocks: project.blocks,
    choreography: project.choreography,
    audio,
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function quotaMiB(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}
