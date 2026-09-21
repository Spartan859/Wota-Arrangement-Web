import { resizeCanvas } from "../src/core/choreography";
import { describe, it, expect } from "vitest";
import {
  addDancer,
  changePose,
  choreographySchema,
  cleanupRedundantKeyframes,
  emptyChoreography,
  sampleFormation,
  setVisibility,
  saveFrame,
  moveFrame,
  deleteDancer,
  colors,
  getDancerFrames,
  moveDancerFrame,
  removeDancerFrame,
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
    expect(colors).toHaveLength(16);
  });
  it("v2 兼容与JSON保存，不丢超时关键帧", () => {
    const p = project();
    expect(parseProject(backup(p)).choreography).toBeUndefined();
    p.choreography = emptyChoreography();
    addDancer(p.choreography, "A", 10);
    p.audio = { id: null, name: "short", duration: 3 };
    expect(parseProject(backup(p)).choreography).toEqual(p.choreography);
  });
  it("清理不影响渲染结果的冗余位置与颜色关键帧", () => {
    const c = emptyChoreography(),
      id = addDancer(c, "A", 0);
    changePose(c, id, 2, { x: 0.7 });
    changePose(c, id, 4, { x: 0.9 });
    changePose(c, id, 2, { left: "极蓝" });
    changePose(c, id, 4, { left: "极蓝" });
    changePose(c, id, 6, { left: "极红" });
    const samples = [0, 1, 2, 3, 4, 5, 6].map((time) =>
      sampleFormation(c, time),
    );
    const result = cleanupRedundantKeyframes(c);
    expect(result).toEqual({ position: 1, color: 2, total: 3 });
    expect(
      getDancerFrames(c, id, "position").map((frame) => frame.time),
    ).toEqual([0, 4]);
    expect(getDancerFrames(c, id, "color").map((frame) => frame.time)).toEqual([
      2, 6,
    ]);
    expect(
      [0, 1, 2, 3, 4, 5, 6].map((time) => sampleFormation(c, time)),
    ).toEqual(samples);
    expect(cleanupRedundantKeyframes(c).total).toBe(0);
  });

  it("旧集体关键帧展开后可删除每位舞者的重复帧", () => {
    const c = emptyChoreography(),
      id = addDancer(c, "A", 0),
      pose = sampleFormation(c, 0)[0];
    c.tracks = [];
    c.frames = [
      { id: "old-0", time: 0, poses: [{ ...pose }] },
      { id: "old-2", time: 2, poses: [{ ...pose }] },
    ];
    const result = cleanupRedundantKeyframes(c);
    expect(result).toEqual({ position: 1, color: 2, total: 3 });
    expect(getDancerFrames(c, id, "position")).toHaveLength(1);
    expect(getDancerFrames(c, id, "color")).toHaveLength(0);
    expect(sampleFormation(c, 2)[0]).toEqual(pose);
  });

  it("每位舞者的位置与颜色关键帧独立增删、移动和采样", () => {
    const c = emptyChoreography(),
      a = addDancer(c, "A", 0),
      b = addDancer(c, "B", 0);
    changePose(c, a, 2, { x: 0.8 });
    changePose(c, a, 3, { left: "极蓝" });
    changePose(c, b, 4, { x: 0.2, left: "极红" });
    expect(
      getDancerFrames(c, a, "position").map((frame) => frame.time),
    ).toEqual([0, 2]);
    expect(getDancerFrames(c, a, "color").map((frame) => frame.time)).toEqual([
      0, 3,
    ]);
    expect(
      sampleFormation(c, 2.5).find((pose) => pose.dancerId === a),
    ).toMatchObject({
      x: 0.8,
      left: "极橙",
    });
    const position = getDancerFrames(c, a, "position")[1];
    moveDancerFrame(c, a, "position", position.id, 5, 10);
    expect(getDancerFrames(c, a, "position")[1].time).toBe(5);
    expect(getDancerFrames(c, a, "color")[1].time).toBe(3);
    removeDancerFrame(c, a, "color", getDancerFrames(c, a, "color")[1].id);
    expect(getDancerFrames(c, a, "color")).toHaveLength(1);
    expect(getDancerFrames(c, b, "position")).toHaveLength(2);
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
  it("勾选时保留归一化坐标，取消时保留全帧相对中心坐标且支持撤销", () => {
    const c = emptyChoreography();
    const id = addDancer(c, "A", 0);
    changePose(c, id, 2, { x: 0.75, y: 0.8, left: "黑", visible: false });
    const before = structuredClone(c);
    resizeCanvas(c, 1600, 1200, true);
    expect(c.frames).toEqual(before.frames);
    const h = new History<typeof c>();
    h.record(c);
    resizeCanvas(c, 800, 600, false);
    expect(c.frames[0].poses[0]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(c.frames[1].poses[0]).toMatchObject({ x: 0.97, y: 0.96 });
    expect(h.undo(c)).toEqual({
      ...before,
      canvas: { width: 1600, height: 1200 },
    });
    const preserved = structuredClone(before);
    resizeCanvas(preserved, 1600, 1200, false);
    expect(preserved.frames.map((f) => f.poses[0])).toEqual(
      before.frames.map((f) => ({
        ...f.poses[0],
        x: 0.5 + (f.poses[0].x - 0.5) / 2,
        y: 0.5 + (f.poses[0].y - 0.5) / 2,
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
    expect(c.frames[0].poses[0]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(choreographySchema.safeParse(c).success).toBe(true);
  });
});

it("非等比调整长宽后保留中心两侧偏移，恢复尺寸可还原站位", () => {
  const c = emptyChoreography();
  const id = addDancer(c, "左侧", 0);
  changePose(c, id, 0, { x: 0.25, y: 0.7 });
  changePose(c, id, 2, { x: 0.65, y: 0.4 });
  const before = structuredClone(c);
  resizeCanvas(c, 1200, 400, false);
  for (let i = 0; i < c.frames.length; i++) {
    const now = c.frames[i].poses[0],
      previous = before.frames[i].poses[0];
    expect((now.x - 0.5) * 1200).toBeCloseTo((previous.x - 0.5) * 800, 8);
    expect((now.y - 0.5) * 400).toBeCloseTo((previous.y - 0.5) * 600, 8);
  }
  resizeCanvas(c, 800, 600, false);
  for (let i = 0; i < c.frames.length; i++) {
    expect(c.frames[i].poses[0].x).toBeCloseTo(before.frames[i].poses[0].x, 8);
    expect(c.frames[i].poses[0].y).toBeCloseTo(before.frames[i].poses[0].y, 8);
  }
});
