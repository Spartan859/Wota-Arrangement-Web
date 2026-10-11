import { describe, expect, it } from "vitest";
import {
  estimateVideoBytes,
  isTargetBitrateValid,
  targetVideoBitrate,
  videoEncodeArgs,
} from "../src/core/videoPolicy";

describe("视频发布编码", () => {
  it("按每像素每帧 0.02 bit 计算目标码率", () => {
    expect(targetVideoBitrate(1920, 1080, 30)).toBe(1_244_160);
    expect(
      estimateVideoBytes({
        name: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1,
        duration: 60,
        width: 1920,
        height: 1080,
        frameRate: 30,
      }),
    ).toBe(9_331_200);
    expect(() => targetVideoBitrate(0, 1080, 30)).toThrow("无效");
  });

  it("生成无音轨 H.264 MP4 参数并允许少量容器开销", () => {
    const metadata = {
      name: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1,
      duration: 10,
      width: 1280,
      height: 720,
      frameRate: 30,
    };
    const args = videoEncodeArgs(metadata);
    expect(args).toContain("-an");
    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
    expect(args.at(-1)).toBe("output.mp4");
    expect(
      isTargetBitrateValid({
        width: 1280,
        height: 720,
        frameRate: 30,
        duration: 10,
        sizeBytes: Math.ceil((targetVideoBitrate(1280, 720, 30) * 10) / 8),
      }),
    ).toBe(true);
  });
});
