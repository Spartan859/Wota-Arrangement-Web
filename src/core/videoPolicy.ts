export const videoBitsPerPixelPerFrame = 0.02;
export const videoEncodingPolicyVersion = 1;

export type VideoMetadata = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
};

export function targetVideoBitrate(
  width: number,
  height: number,
  frameRate: number,
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(frameRate) ||
    width <= 0 ||
    height <= 0 ||
    frameRate <= 0
  )
    throw new Error("视频尺寸或帧率无效。");
  return Math.max(
    100_000,
    Math.round(width * height * frameRate * videoBitsPerPixelPerFrame),
  );
}

export function estimateVideoBytes(metadata: VideoMetadata) {
  return Math.ceil(
    (targetVideoBitrate(metadata.width, metadata.height, metadata.frameRate) *
      metadata.duration) /
      8,
  );
}

export function videoEncodeCacheKey(
  assetId: string,
  sourceVersion: string,
  frameRate: number,
) {
  return `${assetId}:${sourceVersion}:${frameRate}:${videoEncodingPolicyVersion}`;
}

export function videoEncodeArgs(metadata: VideoMetadata) {
  const bitrate = targetVideoBitrate(
    metadata.width,
    metadata.height,
    metadata.frameRate,
  );
  return [
    "-i",
    "input",
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-r",
    String(metadata.frameRate),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-b:v",
    String(bitrate),
    "-maxrate",
    String(Math.round(bitrate * 1.25)),
    "-bufsize",
    String(bitrate * 2),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "output.mp4",
  ];
}

export function isTargetBitrateValid(input: {
  width: number;
  height: number;
  frameRate: number;
  sizeBytes: number;
  duration: number;
}) {
  const target = targetVideoBitrate(input.width, input.height, input.frameRate);
  const actual = (input.sizeBytes * 8) / input.duration;
  return actual <= target * 1.35;
}
