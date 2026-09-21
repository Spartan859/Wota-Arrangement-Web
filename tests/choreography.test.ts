import { resizeCanvas } from "../src/core/choreography";
import { describe, it, expect } from "vitest";
import {
  addDancer,
  changePose,
  choreographySchema,
  emptyChoreography,
  sampleFormation,
  setVisibility,
  saveFrame,
  moveFrame,
  deleteDancer,
  colors,
} from "../src/core/choreography";
import { backup, parseProject, project, History } from "../src/core/model";
describe("全员队形", () => {
  it("插值走位与瞬时换色，不提前入场或滑向退场点", () => {
    const c = emptyChoreography(),
      id = addDancer(c, "一", 2);
    expect(sampleFormation(c, 1)[0].visible).toBe(false);
    changePose(c, id, 4, { x: 0.9, left: "红" });
    expect(sampleFormation(c, 3)[0]).toMatchObject({
      x: 0.7,
      left: "极橙",
      visible: true,
    });
    expect(sampleFormation(c, 4)[0].left).toBe("红");
    setVisibility(c, id, 6, false);
    expect(sampleFormation(c, 5)[0].x).toBe(0.9);
    expect(sampleFormation(c, 6)[0].visible).toBe(false);
    setVisibility(c, id, 8, true);
    expect(sampleFormation(c, 7)[0].visible).toBe(false);
    expect(sampleFormation(c, 20)[0].visible).toBe(true);
  });
  it("整帧保存、同刻覆盖、全曲增删、撤销", () => {
    const c = emptyChoreography(),
      a = addDancer(c, "A", 0);
    saveFrame(c, 5);
    const b = addDancer(c, "B", 2);
    expect(c.frames.every((f) => f.poses.length === 2)).toBe(true);
    expect(c.frames.at(-1)!.poses[1].visible).toBe(true);
    changePose(c, a, 2, { right: "粉" });
    expect(c.frames.filter((f) => f.time === 2)).toHaveLength(1);
    const history = new History<typeof c>();
    history.record(c);
    deleteDancer(c, b);
    expect(history.undo(c).dancers).toHaveLength(2);
    expect(c.frames.every((f) => f.poses.length === 1)).toBe(true);
  });
  it("拒绝同刻移动、越界、非法颜色坐标引用与重复ID", () => {
    const c = emptyChoreography(),
      id = addDancer(c, "A", 0);
    saveFrame(c, 2);
    const frame = c.frames[1];
    expect(() => moveFrame(c, frame.id, 0, 10)).toThrow("已有");
    expect(() => moveFrame(c, frame.id, 11, 10)).toThrow("范围");
    expect(() => changePose(c, id, 0, { x: NaN })).toThrow();
    moveFrame(c, frame.id, 3, 10);
    expect(frame.time).toBe(3);
    const bad = structuredClone(c);
    bad.frames[0].poses[0].dancerId = "missing";
    expect(choreographySchema.safeParse(bad).success).toBe(false);
    expect(
      choreographySchema.safeParse({
        ...c,
        dancers: [...c.dancers, ...c.dancers],
      }).success,
    ).toBe(false);
    expect(colors).toHaveLength(24);
  });
  it("v2 兼容与JSON保存，不丢超时关键帧", () => {
    const p = project();
    expect(parseProject(backup(p)).choreography).toBeUndefined();
    p.choreography = emptyChoreography();
    addDancer(p.choreography, "A", 10);
    p.audio = { id: null, name: "short", duration: 3 };
    expect(parseProject(backup(p)).choreography).toEqual(p.choreography);
  });
});

describe("画布尺寸", () => {
  it("旧队形补默认值，自定义尺寸随 JSON 往返且保留归一化位置", () => {
    const c = emptyChoreography();
    addDancer(c, "A", 0);
    const { canvas, ...legacy } = c;
    expect(choreographySchema.parse(legacy).canvas).toEqual({
      width: 800,
      height: 600,
    });
    const p = project();
    p.choreography = { ...c, canvas: { width: 1200, height: 400 } };
    const result = parseProject(backup(p));
    expect(result.choreography?.canvas).toEqual({ width: 1200, height: 400 });
    expect(result.choreography?.frames).toEqual(c.frames);
    for (const canvas of [
      { width: 0, height: 400 },
      { width: 1200, height: 1 },
      { width: Infinity, height: 400 },
      { width: 1200.5, height: 400 },
      { width: 4001, height: 400 },
    ]) {
      expect(choreographySchema.safeParse({ ...c, canvas }).success).toBe(
        false,
      );
    }
  });
});

describe("画布缩放站位选项", () => {
  it("勾选时保留归一化坐标，取消时保留全帧绝对坐标且支持撤销", () => {
    const c = emptyChoreography();
    const id = addDancer(c, "A", 0);
    changePose(c, id, 2, { x: 0.75, y: 0.8, left: "黑", visible: false });
    const before = structuredClone(c);
    resizeCanvas(c, 1600, 1200, true);
    expect(c.frames).toEqual(before.frames);
    const h = new History<typeof c>();
    h.record(c);
    resizeCanvas(c, 800, 600, false);
    expect(c.frames[0].poses[0]).toMatchObject({ x: 0.97, y: 0.96 });
    expect(h.undo(c)).toEqual({
      ...before,
      canvas: { width: 1600, height: 1200 },
    });
    const preserved = structuredClone(before);
    resizeCanvas(preserved, 1600, 1200, false);
    expect(preserved.frames.map((f) => f.poses[0])).toEqual(
      before.frames.map((f) => ({
        ...f.poses[0],
        x: f.poses[0].x / 2,
        y: f.poses[0].y / 2,
      })),
    );
    expect(preserved.frames[1].poses[0]).toMatchObject({
      left: "黑",
      visible: false,
    });
  });
  it("无效尺寸不修改数据，旧画布使用默认长宽", () => {
    const c = emptyChoreography();
    addDancer(c, "A", 0);
    const before = structuredClone(c);
    expect(() => resizeCanvas(c, 0, 300, false)).toThrow();
    expect(c).toEqual(before);
    delete (c as Partial<typeof c>).canvas;
    resizeCanvas(c, 1600, 1200, false);
    expect(c.frames[0].poses[0]).toMatchObject({ x: 0.25, y: 0.25 });
    expect(choreographySchema.safeParse(c).success).toBe(true);
  });
});
