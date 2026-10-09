import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileTypeFromFile } from "file-type";
import { createFile } from "mp4box";
import { isTargetBitrateValid } from "../../src/core/videoPolicy";
import { AppError } from "../lib/errors";
import { hashFile } from "./audio";

export type VideoInspection = {
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  sha256: string;
};

export async function inspectVideo(path: string): Promise<VideoInspection> {
  const [fileStat, detected, info, sha256] = await Promise.all([
    stat(path),
    fileTypeFromFile(path),
    inspectMp4(path),
    hashFile(path),
  ]);
  const mimeType = detected?.mime ?? "";
  const track = info.tracks.find((item) => item.video);
  const duration = track ? track.duration / track.timescale : 0;
  const frameRate = track && duration > 0 ? track.nb_samples / duration : 0;
  if (mimeType !== "video/mp4" || !detected)
    throw new AppError(415, "unsupported_video", "仅支持 MP4 视频。");
  if (
    !duration ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !track?.video?.width ||
    !track.video.height ||
    !frameRate
  )
    throw new AppError(422, "invalid_video_metadata", "无法读取视频轨道信息。");
  if (
    !isTargetBitrateValid({
      width: track.video.width,
      height: track.video.height,
      frameRate,
      sizeBytes: fileStat.size,
      duration,
    })
  )
    throw new AppError(
      422,
      "video_not_compressed",
      "视频未按目标码率压缩，请重新发布。",
    );
  return {
    mimeType,
    extension: "mp4",
    sizeBytes: fileStat.size,
    durationMs: Math.round(duration * 1000),
    width: track.video.width,
    height: track.video.height,
    frameRate,
    sha256,
  };
}

async function inspectMp4(path: string) {
  const bytes = await readFile(path);
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer & { fileStart: number };
  data.fileStart = 0;
  const file = createFile();
  return new Promise<Parameters<NonNullable<typeof file.onReady>>[0]>(
    (resolve, reject) => {
      file.onReady = resolve;
      file.onError = reject;
      file.appendBuffer(data);
      file.flush();
    },
  );
}

export function videoStoragePath(
  root: string,
  userId: string,
  shareId: string,
  assetId: string,
) {
  return join(resolve(root), "video", userId, shareId, `${assetId}.mp4`);
}

export async function prepareVideoDestination(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
}

export async function removeVideoFile(path: string | null | undefined) {
  if (!path) return;
  try {
    await rm(path, { force: true });
  } catch (error) {
    console.error(`Failed to remove video file ${path}`, error);
  }
}
