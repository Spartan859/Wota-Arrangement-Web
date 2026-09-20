import { describe, expect, it } from "vitest";
import {
  backup,
  block,
  History,
  insertAt,
  parseProject,
  project,
  removeBlock,
} from "../src/core/model";
import { parseLyrics, shifted } from "../src/core/lyrics";
import {
  activeBlock,
  activeLyric,
  intervalError,
  playable,
  suggestedDuration,
} from "../src/core/timing";

describe("歌词导入", () => {
  it("保留 LRC 同刻条目并展开多时间戳", () => {
    const p = parseLyrics(
      "[00:01.50][00:03.50]光\n[00:01.50][00:03.50]光芒",
      true,
    );
    expect(p.rows.map((l) => [l.jp, l.time])).toEqual([
      ["光", 1.5],
      ["光芒", 1.5],
      ["光", 3.5],
      ["光芒", 3.5],
    ]);
  });
  it("保留 TXT 奇数行与整体偏移边界", () => {
    const p = parseLyrics("日一\n中一\n末行", false);
    expect(p.needsAcknowledgement).toBe(true);
    expect(shifted(p.rows, 1).map((l) => l.time)).toEqual([null, null]);
    expect(() => shifted([{ ...p.rows[0], time: 2 }], -3, 4)).toThrow();
  });
});

describe("时间轴模型", () => {
  it("使用任意整数拍计算 BPM 时长", () => {
    expect(suggestedDuration("120", "16")).toBe(8);
    expect(suggestedDuration("120", "1.5")).toBe(0.75);
    expect(suggestedDuration("120", "0")).toBeNull();
  });
  it("按时间轴位置插入、删除并校验区间", () => {
    const p = project();
    const a = block("副歌", "8");
    a.start = 0;
    a.end = 4;
    insertAt(p, a, 0);
    const b = block("桥段", "12");
    b.start = 4;
    b.end = 8;
    insertAt(p, b, 4);
    expect(p.blocks).toHaveLength(2);
    expect(intervalError(b, p.blocks, 10)).toBeNull();
    expect(intervalError({ ...b, start: 3 }, p.blocks, 10)).toContain("重叠");
    removeBlock(p, a.id);
    expect(p.blocks.map((x) => x.id)).toEqual([b.id]);
  });
  it("JSON 只接受新 schema", () => {
    const p = project();
    p.blocks = [block()];
    const decoded = parseProject(backup(p));
    expect(decoded.schemaVersion).toBe(2);
    expect(decoded).not.toHaveProperty("pool");
    expect(() =>
      parseProject(JSON.stringify({ ...p, schemaVersion: 1, pool: [] })),
    ).toThrow();
  });
  it("高亮采用左闭右开", () => {
    const a = {
      ...block(),
      start: 0,
      end: 5,
      lyrics: [
        { ...block().lyrics[0], jp: "一", time: 0 },
        { ...block().lyrics[0], jp: "二", time: 2 },
      ],
    };
    expect(activeBlock([a], 5)).toBeUndefined();
    expect(activeLyric([a], 2, 10)?.jp).toBe("二");
    expect(playable(a, [a], 10)).toBe(true);
  });
  it("历史支持撤销重做", () => {
    const h = new History<{ value: number }>();
    let s = { value: 0 };
    h.record(s);
    s = { value: 1 };
    expect(h.undo(s).value).toBe(0);
  });
});
