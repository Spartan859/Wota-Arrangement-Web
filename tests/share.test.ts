import { describe, expect, it } from "vitest";
import {
  createShareSnapshot,
  defaultQuotaBytes,
  quotaMiB,
} from "../src/core/share";
import { project } from "../src/core/model";
import { parseRange } from "../server/services/audio";

describe("online share snapshot", () => {
  it("keeps public arrangement data and strips local/private project state", () => {
    const source = project();
    source.songName = "Synthetic Song";
    source.bpm = "128";
    source.blocks = [
      {
        id: "block-1",
        type: "副歌",
        beats: "8",
        lyrics: [{ id: "lyric-1", jp: "日文", cn: "中文", time: 1.25 }],
        arrangement: "挥棒",
        remarks: "测试",
        start: 1,
        end: 5,
      },
    ];
    source.choreography = {
      dancers: [{ id: "dancer-1", name: "舞者1" }],
      canvas: { width: 800, height: 600 },
      frames: [
        {
          id: "frame-1",
          time: 1,
          poses: [
            {
              dancerId: "dancer-1",
              x: 0.5,
              y: 0.5,
              visible: true,
              left: "极橙",
              right: "蓝",
            },
          ],
        },
      ],
      tracks: [],
    };
    source.lyricSource = {
      raw: "private source text",
      name: "private.lrc",
      lrc: true,
      offset: 2,
    };
    source.audio = { id: "local-audio-id", name: "song.mp3", duration: 180 };
    source.position = 42;
    source.updatedAt = 123456;

    const snapshot = createShareSnapshot(source, {
      name: "song.mp3",
      duration: 180,
      mimeType: "audio/mpeg",
      sizeBytes: 1024,
    });

    expect(snapshot.songName).toBe("Synthetic Song");
    expect(snapshot.blocks[0].arrangement).toBe("挥棒");
    expect(snapshot.choreography?.frames[0].poses[0].left).toBe("极橙");
    expect(snapshot.audio).toEqual({
      name: "song.mp3",
      duration: 180,
      mimeType: "audio/mpeg",
      sizeBytes: 1024,
    });
    expect(snapshot).not.toHaveProperty("lyricSource");
    expect(snapshot).not.toHaveProperty("position");
    expect(snapshot).not.toHaveProperty("updatedAt");
    expect(JSON.stringify(snapshot)).not.toContain("local-audio-id");
    expect(JSON.stringify(snapshot)).not.toContain("private source text");
  });

  it("uses the documented 100 MiB default quota", () => {
    expect(defaultQuotaBytes).toBe(100 * 1024 * 1024);
    expect(quotaMiB(defaultQuotaBytes)).toBe(100);
  });
});

describe("audio range parsing", () => {
  it("supports closed byte ranges and rejects out-of-file ranges", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(() => parseRange("bytes=100-120", 100)).toThrow(
      "音频范围超出文件大小",
    );
  });
});
