import {
  choreographySchema,
  colors,
  normalizeStickColor,
  type StickColor,
} from "./choreography";
import type { Project } from "./model";

export type BatonChange = {
  time: number;
  kind: "入场" | "换色" | "退场";
  left: StickColor;
  right: StickColor;
  added: number;
};
export type ColorUsage = { color: StickColor; count: number };
export type DancerUsage = {
  id: string;
  name: string;
  total: number;
  colors: ColorUsage[];
  changes: BatonChange[];
};
export const usageRule =
  "一次性累计消耗：每手首次取棒或换色计 1 根；同色不重复计，黑色不计，退场后再入场重新计。";
const counts = () => new Map<StickColor, number>();
const ordered = (map: Map<StickColor, number>): ColorUsage[] =>
  colors.flatMap(([color]) =>
    map.get(color) ? [{ color, count: map.get(color)! }] : [],
  );
export function batonUsage(project: Pick<Project, "choreography" | "audio">) {
  const all = counts();
  const source = project.choreography;
  if (!source)
    return {
      total: 0,
      colors: [] as ColorUsage[],
      dancers: [] as DancerUsage[],
      outOfRange: 0,
    };
  const c = choreographySchema.parse(source);
  const frames = [...c.frames].sort((a, b) => a.time - b.time);
  const dancers: DancerUsage[] = c.dancers.map((d) => {
    const individual = counts();
    const changes: BatonChange[] = [];
    let wasVisible = false,
      left: StickColor = "黑",
      right: StickColor = "黑",
      total = 0;
    for (const frame of frames) {
      const pose = frame.poses.find((p) => p.dancerId === d.id)!;
      if (!pose.visible) {
        if (wasVisible)
          changes.push({
            time: frame.time,
            kind: "退场",
            left: "黑",
            right: "黑",
            added: 0,
          });
        wasVisible = false;
        left = "黑";
        right = "黑";
        continue;
      }
      const nextLeft = normalizeStickColor(pose.left),
        nextRight = normalizeStickColor(pose.right);
      const changed = nextLeft !== left || nextRight !== right;
      let added = 0;
      for (const [previous, next] of [
        [left, nextLeft],
        [right, nextRight],
      ] as const) {
        if (next !== "黑" && (!wasVisible || previous !== next)) {
          individual.set(next, (individual.get(next) ?? 0) + 1);
          all.set(next, (all.get(next) ?? 0) + 1);
          added++;
          total++;
        }
      }
      if (!wasVisible || changed)
        changes.push({
          time: frame.time,
          kind: wasVisible ? "换色" : "入场",
          left: nextLeft,
          right: nextRight,
          added,
        });
      wasVisible = true;
      left = nextLeft;
      right = nextRight;
    }
    return { ...d, total, colors: ordered(individual), changes };
  });
  return {
    total: dancers.reduce((sum, d) => sum + d.total, 0),
    colors: ordered(all),
    dancers,
    outOfRange: project.audio
      ? frames.filter((f) => f.time > project.audio!.duration).length
      : 0,
  };
}
export function usageTime(time: number) {
  const ms = Math.round(time * 1000);
  return `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, "0")}.${(ms % 1000).toString().padStart(3, "0")}`;
}
export const batonLabel = (color: StickColor) =>
  color === "黑" ? "未持棒" : color;
