import type { Project } from "./model";
import type { ShareSummary } from "./share";
import { db } from "./storage";
import {
  compressVideo,
  estimateVideoBytes,
  sha256Blob,
  videoEncodeCacheKey,
  type VideoMetadata,
} from "./videoEncoding";

export type PreparedVideoUpload = {
  assetId: string;
  blob: Blob;
  name: string;
  sizeBytes: number;
};

export async function prepareVideoUploads(
  project: Project,
  existingVideos: ShareSummary["videos"],
  quotaBytes: number,
  usedBytes: number,
  existingAudioSizeBytes: number,
  nextAudioSizeBytes: number,
  onProgress: (percent: number) => void,
) {
  const referenced = new Set([
    ...(project.choreography?.tracks.flatMap((track) =>
      track.videoClips.map((clip) => clip.assetId),
    ) ?? []),
    ...(project.choreography?.freeVideoTrack.videoClips.map(
      (clip) => clip.assetId,
    ) ?? []),
  ]);
  const assets =
    project.choreography?.videoAssets.filter((asset) =>
      referenced.has(asset.id),
    ) ?? [];
  const existing = new Map(existingVideos.map((video) => [video.id, video]));
  const uploads: PreparedVideoUpload[] = [];
  let projectedVideoBytes = 0;

  for (const [index, asset] of assets.entries()) {
    const cloud = existing.get(asset.id);
    const unchanged = cloud?.sourceVersion === asset.sourceVersion;
    let sizeBytes = cloud?.sizeBytes ?? estimateVideoBytes(asset);
    if (!unchanged) {
      const record = asset.localBlobId
        ? await db.videos.get(asset.localBlobId)
        : undefined;
      if (!record)
        throw new Error(`视频“${asset.name}”缺少本地文件，无法发布。`);
      const cacheKey = videoEncodeCacheKey(
        asset.id,
        asset.sourceVersion,
        asset.frameRate,
      );
      let encoded = await db.videoEncodes.get(cacheKey);
      if (!encoded) {
        const blob = await compressVideo(record.blob, asset, (ratio) => {
          const base = assets.length ? index / assets.length : 0;
          const share = assets.length ? 1 / assets.length : 1;
          onProgress(Math.round((base + share * ratio) * 100));
        });
        const metadata: VideoMetadata = {
          ...asset,
          name: `${asset.name.replace(/\.[^.]+$/, "")}.mp4`,
          mimeType: "video/mp4",
          sizeBytes: blob.size,
        };
        encoded = {
          id: cacheKey,
          blob,
          sha256: await sha256Blob(blob),
          mimeType: metadata.mimeType,
          sizeBytes: blob.size,
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          frameRate: metadata.frameRate,
        };
        await db.videoEncodes.put(encoded);
      }
      sizeBytes = encoded.sizeBytes;
      uploads.push({
        assetId: asset.id,
        blob: encoded.blob,
        name: `${asset.name.replace(/\.[^.]+$/, "")}.mp4`,
        sizeBytes,
      });
    }
    projectedVideoBytes += sizeBytes;
    onProgress(Math.round(((index + 1) / Math.max(1, assets.length)) * 100));
  }

  const existingBytes =
    existingVideos.reduce((sum, video) => sum + video.sizeBytes, 0) +
    existingAudioSizeBytes;
  const projectedTotal =
    usedBytes - existingBytes + projectedVideoBytes + nextAudioSizeBytes;
  if (projectedTotal > quotaBytes)
    throw new Error("预计压缩后的视频和音乐超过云空间配额，请删除素材后重试。");
  return uploads;
}
