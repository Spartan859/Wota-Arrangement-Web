import { z } from "zod";

export const colors = [
  ["黑", "#111827"],
  ["橙", "#ff8a18"],
  ["极橙", "#ffad38"],
  ["极EX橙", "#ffd34a"],
  ["白", "#e1e5ea"],
  ["极白", "#ffffff"],
  ["红", "#ee3038"],
  ["极红", "#ff695b"],
  ["蓝", "#2453dd"],
  ["极蓝", "#35baff"],
  ["黄", "#edcf12"],
  ["极黄", "#fff36a"],
  ["粉", "#ed36b9"],
  ["极粉", "#ff8ade"],
  ["绿", "#18ae53"],
  ["极绿", "#66ff65"],
  ["紫", "#814bd7"],
  ["极紫", "#c18bff"],
  ["红樱", "#ff426c"],
  ["山吹", "#ffbc2b"],
  ["浅葱", "#37dce5"],
  ["萌葱", "#54d481"],
  ["翡翠", "#1ce5b4"],
  ["琉璃", "#476bff"],
] as const;
export type StickColor = (typeof colors)[number][0];
const color = z.custom<StickColor>((value) =>
  colors.some(([name]) => name === value),
);
export const poseSchema = z.object({
  dancerId: z.string().min(1),
  x: z.number().finite().min(0.03).max(0.97),
  y: z.number().finite().min(0.04).max(0.96),
  left: color,
  right: color,
  visible: z.boolean(),
});
export const canvasSchema = z.object({
  width: z.number().int().min(320).max(4000),
  height: z.number().int().min(240).max(3000),
});
export const choreographySchema = z
  .object({
    canvas: canvasSchema.default({ width: 800, height: 600 }),
    dancers: z.array(
      z.object({ id: z.string().min(1), name: z.string().min(1) }),
    ),
    frames: z.array(
      z.object({
        id: z.string().min(1),
        time: z.number().finite().nonnegative(),
        poses: z.array(poseSchema),
      }),
    ),
  })
  .superRefine((c, ctx) => {
    const ids = [...c.dancers.map((d) => d.id), ...c.frames.map((f) => f.id)];
    const invalid =
      new Set(ids).size !== ids.length ||
      new Set(c.frames.map((f) => Math.round(f.time * 1000))).size !==
        c.frames.length ||
      c.frames.some(
        (f) =>
          f.poses.length !== c.dancers.length ||
          new Set(f.poses.map((p) => p.dancerId)).size !== f.poses.length ||
          f.poses.some((p) => !c.dancers.some((d) => d.id === p.dancerId)),
      );
    if (invalid)
      ctx.addIssue({ code: "custom", message: "队形 ID、时间或舞者引用无效" });
  });
export type Choreography = z.infer<typeof choreographySchema>;
export type Pose = z.infer<typeof poseSchema>;
export const emptyChoreography = (): Choreography => ({
  canvas: { width: 800, height: 600 },
  dancers: [],
  frames: [],
});
export const defaultPose = (dancerId: string): Pose => ({
  dancerId,
  x: 0.5,
  y: 0.5,
  left: "极橙",
  right: "极橙",
  visible: false,
});
export const colorHex = (name: StickColor) =>
  colors.find((c) => c[0] === name)![1];
export function frameTime(time: number, duration?: number) {
  if (
    !Number.isFinite(time) ||
    time < 0 ||
    (duration !== undefined && time > duration)
  )
    throw new Error("关键帧时间必须在歌曲范围内。");
  return Math.round(time * 1000) / 1000;
}
export function sampleFormation(c: Choreography, time: number): Pose[] {
  const frames = [...c.frames].sort((a, b) => a.time - b.time);
  const before = frames.filter((f) => f.time <= time).at(-1);
  if (!before) return c.dancers.map((d) => defaultPose(d.id));
  const after = frames.find((f) => f.time > time);
  return before.poses.map((p) => {
    const next = after?.poses.find((n) => n.dancerId === p.dancerId);
    if (!after || !p.visible || !next?.visible) return { ...p };
    const ratio = (time - before.time) / (after.time - before.time);
    return {
      ...p,
      x: p.x + (next.x - p.x) * ratio,
      y: p.y + (next.y - p.y) * ratio,
    };
  });
}
export function saveFrame(
  c: Choreography,
  time: number,
  poses = sampleFormation(c, time),
) {
  const t = frameTime(time);
  if (!c.frames.length && t > 0)
    c.frames.push({
      id: crypto.randomUUID(),
      time: 0,
      poses: c.dancers.map((d) => defaultPose(d.id)),
    });
  const existing = c.frames.find(
    (f) => Math.round(f.time * 1000) === Math.round(t * 1000),
  );
  if (existing) existing.poses = structuredClone(poses);
  else
    c.frames.push({
      id: crypto.randomUUID(),
      time: t,
      poses: structuredClone(poses),
    });
  c.frames.sort((a, b) => a.time - b.time);
}
export function addDancer(c: Choreography, name: string, time: number) {
  if (!name.trim()) throw new Error("请输入姓名。");
  const id = crypto.randomUUID();
  c.dancers.push({ id, name: name.trim() });
  for (const frame of c.frames) frame.poses.push(defaultPose(id));
  setVisibility(c, id, time, true);
  return id;
}
export function setVisibility(
  c: Choreography,
  id: string,
  time: number,
  visible: boolean,
) {
  const t = frameTime(time);
  saveFrame(c, t);
  for (const frame of c.frames)
    if (frame.time >= t) {
      const pose = frame.poses.find((p) => p.dancerId === id);
      if (pose) pose.visible = visible;
    }
}
export function changePose(
  c: Choreography,
  id: string,
  time: number,
  patch: Partial<Omit<Pose, "dancerId">>,
) {
  const poses = sampleFormation(c, time);
  const pose = poses.find((p) => p.dancerId === id);
  if (!pose) throw new Error("舞者不存在。");
  Object.assign(pose, patch);
  poseSchema.parse(pose);
  saveFrame(c, time, poses);
}
export function deleteDancer(c: Choreography, id: string) {
  c.dancers = c.dancers.filter((d) => d.id !== id);
  for (const frame of c.frames)
    frame.poses = frame.poses.filter((p) => p.dancerId !== id);
}
export function moveFrame(
  c: Choreography,
  id: string,
  time: number,
  duration?: number,
) {
  const t = frameTime(time, duration);
  if (
    c.frames.some(
      (f) => f.id !== id && Math.round(f.time * 1000) === Math.round(t * 1000),
    )
  )
    throw new Error("该时刻已有队形关键帧。");
  const f = c.frames.find((f) => f.id === id);
  if (!f) throw new Error("关键帧不存在。");
  f.time = t;
  c.frames.sort((a, b) => a.time - b.time);
}

/** Resize every formation; unscaled coordinates use the top-left stage origin. */
export function resizeCanvas(
  c: Choreography,
  width: number,
  height: number,
  scalePositions: boolean,
) {
  const next = canvasSchema.parse({ width, height });
  const previous = c.canvas ?? { width: 800, height: 600 };
  if (previous.width === width && previous.height === height) return;
  if (!scalePositions) {
    for (const frame of c.frames)
      for (const pose of frame.poses) {
        pose.x = Math.max(
          0.03,
          Math.min(0.97, (pose.x * previous.width) / width),
        );
        pose.y = Math.max(
          0.04,
          Math.min(0.96, (pose.y * previous.height) / height),
        );
      }
  }
  c.canvas = next;
}
