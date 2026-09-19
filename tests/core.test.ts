import { describe, expect, it } from "vitest";
import {
  backup,
  block,
  collect,
  History,
  lyric,
  move,
  pack,
  parseProject,
  project,
} from "../src/core/model";
import { parseLyrics, shifted } from "../src/core/lyrics";
import {
  activeBlock,
  activeLyric,
  intervalError,
  orderConflict,
  playable,
  suggestedDuration,
} from "../src/core/timing";
describe("歌词导入", () => {
  it("处理 BOM、空行、中日配对且保留未配对末行", () => {
    const p = parseLyrics("\uFEFF日一\r\n中一\n\n日二", false);
    expect(p.rows.map((l) => [l.jp, l.cn])).toEqual([
      ["日一", "中一"],
      ["日二", ""],
    ]);
    expect(p.needsAcknowledgement).toBe(true);
  });
  it("保留 LRC 时间，展开多时间戳，应用 offset 和同刻双语", () => {
    const p = parseLyrics(
      "[ti:测试]\n[offset:+250]\n[00:01.50][00:03.50]光\n[00:01.50][00:03.50]光芒\n[00:06]前へ\n[00:08]進め",
      true,
    );
    expect(p.rows.map((l) => [l.jp, l.cn, l.time])).toEqual([
      ["光", "光芒", 1.75],
      ["光", "光芒", 3.75],
      ["前へ", "", 6.25],
      ["進め", "", 8.25],
    ]);
  });
  it("无时间 LRC 保留单行；负 offset 不静默截断", () => {
    const p = parseLyrics("[offset:-2000]\n[00:01]歌\n无时间", true);
    expect(p.rows.find((l) => l.jp === "歌")!.time).toBe(-1);
    expect(p.rows.find((l) => l.jp === "无时间")!.time).toBeNull();
    expect(() => shifted(p.rows, 0)).toThrow();
    expect(shifted(p.rows, 1).find((l) => l.jp === "歌")!.time).toBe(0);
  });
  it("校验整体偏移边界，不改变无时间行", () => {
    const rows = [lyric("一", "", 2), lyric("二")];
    expect(shifted(rows, 1, 4).map((l) => l.time)).toEqual([3, null]);
    expect(() => shifted(rows, -3, 4)).toThrow();
    expect(() => shifted(rows, 3, 4)).toThrow();
    expect(() => shifted(rows, NaN)).toThrow();
    expect(rows[0].time).toBe(2);
  });
  it("拒绝空歌词", () =>
    expect(() => parseLyrics("[ti:只有标题]", true)).toThrow());
});
describe("编排和历史", () => {
  it("收纳多句，保留下一句、时间和处理状态，允许空打包", () => {
    const p = project();
    p.pool = ["一", "二", "三"].map((jp, i) => ({
      ...lyric(jp, "", i),
      status: "pending",
    }));
    collect(p, [p.pool[0].id, p.pool[1].id]);
    pack(p, "r", "8");
    expect(p.blocks[0].type).toBe("副歌");
    expect(p.blocks[0].lyrics.map((l) => l.time)).toEqual([0, 1]);
    expect(p.pool.map((l) => l.status)).toEqual(["used", "used", "pending"]);
    expect(p.staging).toEqual([]);
    pack(p, "p", "4");
    expect(p.blocks[1].lyrics[0].jp).toBe("");
  });
  it("指定插入位置，重排不改变时间", () => {
    const p = project();
    p.blocks = [block("a"), block("b")];
    p.blocks[0].start = 8;
    p.insertionAfter = "start";
    pack(p, "p", "4");
    expect(p.blocks.map((b) => b.type)).toEqual(["前奏", "A melo", "B melo"]);
    move(p, 1, 2);
    expect(p.blocks[2].start).toBe(8);
  });
  it("快照多次撤销重做、新操作清空 redo，历史封顶 100", () => {
    const h = new History<{ value: number }>();
    let state = { value: 0 };
    for (let i = 1; i <= 105; i++) {
      h.record(state);
      state = { value: i };
    }
    expect(h.past).toHaveLength(100);
    state = h.undo(state);
    expect(state.value).toBe(104);
    state = h.redo(state);
    expect(state.value).toBe(105);
    state = h.undo(state);
    h.record(state);
    expect(h.future).toHaveLength(0);
  });
  it("JSON 完整往返，不导出 Blob 引用，拒绝坏版本和无效暂存区", () => {
    const p = project();
    p.audio = { id: "local-blob", name: "test.wav", duration: 10 };
    p.pool = [{ ...lyric("一", "", 1), status: "pending" }];
    collect(p, [p.pool[0].id]);
    const decoded = parseProject(backup(p));
    expect(decoded.staging).toEqual(p.staging);
    expect(decoded.audio?.id).toBeNull();
    expect(() =>
      parseProject(JSON.stringify({ ...p, schemaVersion: 2 })),
    ).toThrow();
    expect(() =>
      parseProject(JSON.stringify({ ...p, staging: ["missing"] })),
    ).toThrow();
    expect(() => parseProject("{}")).toThrow();
  });
});
describe("歌曲对时", () => {
  it("按八拍计算建议，仅接受正的有限数字", () => {
    expect(suggestedDuration("120", "8")).toBe(32);
    expect(suggestedDuration("120", "1.5")).toBe(6);
    for (const beats of ["自由", "0", "-1", "Infinity", ""])
      expect(suggestedDuration("120", beats)).toBeNull();
  });
  it("允许相邻和留白、拒绝重叠、反向、负数、越界", () => {
    const a = { ...block(), start: 0, end: 5 };
    const b = { ...block(), start: 5, end: 10 };
    expect(intervalError(b, [a, b], 10)).toBeNull();
    expect(intervalError({ ...b, start: 4 }, [a, b], 10)).toContain("重叠");
    expect(intervalError({ ...b, end: 5 }, [a, b], 10)).toContain("晚于");
    expect(intervalError({ ...b, end: 11 }, [a, b], 10)).toContain("范围");
    expect(intervalError({ ...b, start: -1 }, [a, b], 10)).toContain("范围");
    expect(playable({ ...b, end: null }, [a, b], 10)).toBe(false);
    expect(playable(b, [a, b], undefined)).toBe(false);
  });
  it("高亮采用左闭右开，未标记歌词不伪造时间", () => {
    const a = {
      ...block(),
      start: 0,
      end: 5,
      lyrics: [lyric("一", "", 0), lyric("二", "", 2)],
    };
    const b = { ...block(), start: 6, end: 10, lyrics: [lyric("无时间")] };
    expect(activeBlock([a, b], 5)).toBeUndefined();
    expect(activeBlock([a, b], 6)?.id).toBe(b.id);
    expect(activeLyric([a, b], 2, 10)?.jp).toBe("二");
    expect(activeLyric([a, b], 5, 10)).toBeUndefined();
    expect(activeLyric([b], 7, 10)).toBeUndefined();
    expect(orderConflict([b, a])).toBe(true);
  });
});
