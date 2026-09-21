import { describe, it, expect } from "vitest";
import { project } from "../src/core/model";
import { emptyChoreography, defaultPose } from "../src/core/choreography";
import { batonUsage, usageTime } from "../src/core/batonUsage";
export function usageFixture() {
  const p = project();
  p.choreography = emptyChoreography();
  p.choreography.dancers = [
    { id: "one", name: "同名" },
    { id: "two", name: "同名" },
  ];
  const states = [
    ["极橙", "极橙", true],
    ["极橙", "极橙", true],
    ["极蓝", "极橙", true],
    ["极橙", "黑", true],
    ["极橙", "极橙", true],
    ["极橙", "极橙", false],
    ["极蓝", "极橙", false],
    ["极橙", "极橙", true],
  ] as const;
  p.choreography.frames = states.map(([left, right, visible], i) => ({
    id: `f${i}`,
    time: i,
    poses: [
      { ...defaultPose("one"), left, right, visible },
      { ...defaultPose("two"), left: "极橙", right: "黑", visible: true },
    ],
  }));
  return p;
}
describe("一次性光棒用量", () => {
  it("逐手累计首次、换色、换回、黑色及再次入场，重复/隐藏不计", () => {
    const p = usageFixture(),
      original = structuredClone(p),
      s = batonUsage(p);
    expect(s.total).toBe(8);
    expect(s.colors).toEqual([
      { color: "极橙", count: 7 },
      { color: "极蓝", count: 1 },
    ]);
    expect(s.dancers.map((d) => d.total)).toEqual([7, 1]);
    expect(s.dancers[0].changes.map((c) => [c.time, c.kind, c.added])).toEqual([
      [0, "入场", 2],
      [2, "换色", 1],
      [3, "换色", 1],
      [4, "换色", 1],
      [5, "退场", 0],
      [7, "入场", 2],
    ]);
    expect(s.dancers[1].changes).toHaveLength(1);
    expect(p).toEqual(original);
  });
  it("按时间排序、旧色归一化不伪造换色，保留毫秒并标记越界", () => {
    const p = usageFixture();
    p.choreography!.frames.reverse();
    p.choreography!.frames.find((f) => f.time === 1)!.poses[0].left = "橙";
    p.audio = { id: null, name: "short.wav", duration: 4 };
    expect(batonUsage(p)).toMatchObject({ total: 8, outOfRange: 3 });
    expect(usageTime(59.9999)).toBe("01:00.000");
    expect(usageTime(1.001)).toBe("00:01.001");
  });
  it("空队形、未入场和双手黑色总数为零，非法颜色拒绝统计", () => {
    expect(batonUsage(project()).total).toBe(0);
    const p = usageFixture();
    for (const f of p.choreography!.frames)
      for (const pose of f.poses) {
        pose.left = "黑";
        pose.right = "黑";
      }
    expect(batonUsage(p).total).toBe(0);
    expect(batonUsage(p).colors).toEqual([]);
    p.choreography!.frames[0].poses[0].left = "invalid";
    expect(() => batonUsage(p)).toThrow();
    p.choreography!.frames[0].poses[0].left = "constructor";
    expect(() => batonUsage(p)).toThrow();
  });
});
