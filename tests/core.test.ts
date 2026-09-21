import {
  draggedRange,
  insertionRange,
  insertionStart,
} from "../src/core/timing";

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

describe("时间轴拖动边界", () => {
  it("按照时间而非数组顺序限制边缘和整体移动", () => {
    const left = { ...block(), start: 1, end: 3 };
    const current = { ...block(), start: 5, end: 7 };
    const right = { ...block(), start: 9, end: 11 };
    const blocks = [right, current, left];
    expect(draggedRange(current, blocks, 12, "start", -10)).toEqual({
      start: 3,
      end: 7,
    });
    expect(draggedRange(current, blocks, 12, "end", 10)).toEqual({
      start: 5,
      end: 9,
    });
    expect(draggedRange(current, blocks, 12, "move", 10)).toEqual({
      start: 7,
      end: 9,
    });
    expect(draggedRange(current, blocks, 12, "move", -10)).toEqual({
      start: 3,
      end: 5,
    });
    expect(draggedRange(left, blocks, 12, "start", -10).start).toBe(0);
    expect(draggedRange(right, blocks, 12, "end", 10).end).toBe(12);
  });
});

describe("LRC 项目来源", () => {
  it("兼容无来源旧 v2，原文和偏移随 JSON 往返，拒绝非法偏移", () => {
    const p = project();
    expect(parseProject(backup(p)).lyricSource).toBeUndefined();
    p.lyricSource = {
      raw: "[00:01]合成",
      name: "test.lrc",
      lrc: true,
      offset: -0.5,
    };
    expect(parseProject(backup(p)).lyricSource).toEqual(p.lyricSource);
    expect(() =>
      parseProject(
        JSON.stringify({
          ...p,
          lyricSource: { ...p.lyricSource, offset: "oops" },
        }),
      ),
    ).toThrow();
  });
});

describe("新建段落区间", () => {
  it("空白点击默认从前一段结尾开始", () => {
    const first = { ...block(), start: 0, end: 3 };
    const next = { ...block(), start: 5, end: 9 };
    expect(insertionStart(4.5, [next, first])).toBe(3);
    expect(insertionStart(10, [next, first])).toBe(9);
    expect(insertionStart(0.5, [next])).toBe(0);
  });

  it("生成出点并限制在空隙与歌曲范围内", () => {
    const next = { ...block(), start: 6, end: 9 };
    expect(insertionRange(1, "4", "120", [next], 12)).toEqual({
      start: 1,
      end: 3,
    });
    expect(insertionRange(5, "8", "120", [next], 12)).toEqual({
      start: 5,
      end: 6,
    });
    expect(insertionRange(10, "8", "120", [next], 12)).toEqual({
      start: 10,
      end: 12,
    });
    expect(() => insertionRange(7, "8", "120", [next], 12)).toThrow("空白");
    expect(() => insertionRange(1, "8", "0", [], 12)).toThrow("BPM");
    expect(insertionRange(null, "8", "120", [])).toEqual({
      start: null,
      end: null,
    });
  });
});
