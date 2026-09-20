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
      left: "蓝",
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
    expect(colors).toHaveLength(23);
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
