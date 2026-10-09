import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { videoEncodeArgs, type VideoMetadata } from "./videoPolicy";

const videoTrackType = 0x01;
export {
  estimateVideoBytes,
  isTargetBitrateValid,
  targetVideoBitrate,
  videoBitsPerPixelPerFrame,
  videoEncodeArgs,
  videoEncodeCacheKey,
  videoEncodingPolicyVersion,
} from "./videoPolicy";
export type { VideoMetadata } from "./videoPolicy";

export async function inspectVideoFile(file: File): Promise<VideoMetadata> {
  const { parseBlob } = await import("music-metadata");
  const parsed = await parseBlob(file, { duration: true });
  const track = parsed.format.trackInfo?.find(
    (item) => item.type === videoTrackType,
  );
  const video = track?.video as
    (NonNullable<typeof track>["video"] & { frameRate?: number }) | undefined;
  let width = video?.pixelWidth ?? video?.displayWidth ?? 0;
  let height = video?.pixelHeight ?? video?.displayHeight ?? 0;
  let duration =
    (track as { duration?: number } | undefined)?.duration ??
    parsed.format.duration ??
    0;
  let frameRate = video?.frameRate ?? 0;

  if (!width || !height || !duration || !Number.isFinite(duration)) {
    const probed = await probeVideoElement(file);
    width ||= probed.width;
    height ||= probed.height;
    duration ||= probed.duration;
    frameRate ||= probed.frameRate;
  }
  if (!frameRate || !Number.isFinite(frameRate))
    frameRate = (await probeVideoElement(file, 1200)).frameRate || 30;
  if (!width || !height || !duration || !Number.isFinite(duration))
    throw new Error("无法读取视频分辨率或时长。");
  return {
    name: file.name || "video",
    mimeType: file.type || "video/mp4",
    sizeBytes: file.size,
    duration,
    width: Math.round(width),
    height: Math.round(height),
    frameRate: Math.round(frameRate * 1000) / 1000,
  };
}

async function probeVideoElement(file: File, detectFrameRateMs = 0) {
  if (typeof document === "undefined")
    return { width: 0, height: 0, duration: 0, frameRate: 30 };
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;
  try {
    const metadata = await new Promise<{
      width: number;
      height: number;
      duration: number;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("读取视频超时。")),
        15000,
      );
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
        });
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("浏览器无法读取该视频。"));
      };
    });
    const frameRate = detectFrameRateMs
      ? await detectVideoFrameRate(video, detectFrameRateMs)
      : 0;
    return { ...metadata, frameRate };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function detectVideoFrameRate(
  video: HTMLVideoElement,
  timeoutMs: number,
) {
  if (!("requestVideoFrameCallback" in video)) return 0;
  const samples: number[] = [];
  let previous: number | null = null;
  let callbackId = 0;
  const finish = new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, timeoutMs);
    const callback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (previous !== null) {
        const delta = metadata.mediaTime - previous;
        if (delta > 1 / 240 && delta < 1 / 5) samples.push(delta);
      }
      previous = metadata.mediaTime;
      if (samples.length >= 8) {
        window.clearTimeout(timeout);
        resolve();
      } else callbackId = video.requestVideoFrameCallback(callback);
    };
    callbackId = video.requestVideoFrameCallback(callback);
  });
  try {
    await video.play();
  } catch {
    return 0;
  }
  await finish;
  video.pause();
  if (callbackId) video.cancelVideoFrameCallback(callbackId);
  if (!samples.length) return 0;
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const detected = 1 / median;
  return detected >= 1 && detected <= 240 ? detected : 0;
}

export async function compressVideo(
  file: Blob,
  metadata: VideoMetadata,
  onProgress?: (ratio: number) => void,
) {
  const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const ffmpeg = new FFmpeg();
  if (onProgress) ffmpeg.on("progress", ({ progress }) => onProgress(progress));
  await ffmpeg.load({
    coreURL: await toBlobURL(coreURL, "text/javascript"),
    wasmURL: await toBlobURL(wasmURL, "application/wasm"),
  });
  await ffmpeg.writeFile("input", await fetchFile(file));
  const result = await ffmpeg.exec(videoEncodeArgs(metadata));
  if (result !== 0) throw new Error("视频压缩失败，请检查源文件。");
  const output = await ffmpeg.readFile("output.mp4");
  const bytes = output instanceof Uint8Array ? output : new Uint8Array();
  const blob = new Blob([new Uint8Array(bytes).buffer], {
    type: "video/mp4",
  });
  await ffmpeg.deleteFile("input").catch(() => undefined);
  await ffmpeg.deleteFile("output.mp4").catch(() => undefined);
  ffmpeg.terminate();
  return blob;
}

export async function sha256Blob(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
