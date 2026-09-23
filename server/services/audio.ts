import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileTypeFromFile } from "file-type";
import { parseFile } from "music-metadata";
import { AppError } from "../lib/errors";

const mimeAliases: Record<string, string> = {
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/x-flac": "audio/flac",
  "audio/mp4a-latm": "audio/aac",
};

const allowedMimeTypes = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

export type AudioInspection = {
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationMs: number;
  sha256: string;
};

export function normalizeAudioMime(mimeType: string) {
  return mimeAliases[mimeType] ?? mimeType;
}

export async function inspectAudio(path: string): Promise<AudioInspection> {
  const [fileStat, detected, metadata, sha256] = await Promise.all([
    stat(path),
    fileTypeFromFile(path),
    parseFile(path, { duration: true }),
    hashFile(path),
  ]);
  const mimeType = normalizeAudioMime(detected?.mime ?? "");
  const duration = metadata.format.duration;
  if (!allowedMimeTypes.has(mimeType) || !detected)
    throw new AppError(
      415,
      "unsupported_audio",
      "仅支持 MP3、WAV、M4A/AAC、OGG 或 FLAC 音频。",
    );
  if (!duration || !Number.isFinite(duration) || duration <= 0)
    throw new AppError(422, "invalid_audio_duration", "无法读取音频时长。");
  return {
    mimeType,
    extension: safeExtension(detected.ext, mimeType),
    sizeBytes: fileStat.size,
    durationMs: Math.round(duration * 1000),
    sha256,
  };
}

export async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function ensureStorageRoot(root: string) {
  await mkdir(root, { recursive: true, mode: 0o750 });
}

export function audioStoragePath(
  root: string,
  userId: string,
  shareId: string,
  assetId: string,
  extension: string,
) {
  return join(resolve(root), userId, shareId, `${assetId}.${extension}`);
}

export async function prepareAudioDestination(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
}

export async function removeAudioFile(path: string | null | undefined) {
  if (!path) return;
  try {
    await rm(path, { force: true });
  } catch (error) {
    console.error(`Failed to remove audio file ${path}`, error);
  }
}

export function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) throw new AppError(416, "invalid_range", "不支持的 Range 请求。");
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    throw new AppError(416, "invalid_range", "音频范围超出文件大小。");
  return { start, end: Math.min(end, size - 1) };
}

function safeExtension(extension: string, mimeType: string) {
  const normalized = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized) return normalized;
  return (
    {
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/ogg": "ogg",
      "audio/flac": "flac",
    }[mimeType] ?? "audio"
  );
}

export function safeOriginalName(value: string) {
  const base = value.split(/[\\/]/).at(-1)?.trim() || "song";
  return base.slice(0, 180).replace(/[\u0000-\u001f\u007f]/g, "");
}

export function extensionOf(path: string) {
  return extname(path).slice(1);
}
