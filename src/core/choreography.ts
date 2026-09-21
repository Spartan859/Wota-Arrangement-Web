import { z } from "zod";

export const colors = [
  ["黑", "#111827"],
  ["极橙", "#ffad38"],
  ["极EX橙", "#ffd34a"],
  ["极白", "#ffffff"],
  ["极红", "#ff695b"],
  ["极蓝", "#35baff"],
  ["极黄", "#fff36a"],
  ["极粉", "#ff8ade"],
  ["极绿", "#66ff65"],
  ["极紫", "#c18bff"],
  ["红樱", "#ff426c"],
  ["山吹", "#ffbc2b"],
  ["浅葱", "#37dce5"],
  ["萌葱", "#54d481"],
  ["翡翠", "#1ce5b4"],
  ["琉璃", "#476bff"],
] as const;
const legacyColorAliases: Record<string, StickColor> = {
  橙: "极橙",
  白: "极白",
  红: "极红",
  蓝: "极蓝",
  黄: "极黄",
  粉: "极粉",
  绿: "极绿",
  紫: "极紫",
};
export type StickColor = (typeof colors)[number][0];
const color = z.custom<StickColor | string>(
  (value) =>
    colors.some(([name]) => name === value) ||
    (typeof value === "string" && Object.hasOwn(legacyColorAliases, value)),
);
export const poseSchema = z.object({
  dancerId: z.string().min(1),
  x: z.number().finite().min(0.03).max(0.97),
  y: z.number().finite().min(0.04).max(0.96),
  left: color,
  right: color,
  visible: z.boolean(),
});
const positionKeyframeSchema = z.object({
  id: z.string().min(1),
  time: z.number().finite().nonnegative(),
  x: z.number().finite().min(0.03).max(0.97),
  y: z.number().finite().min(0.04).max(0.96),
  visible: z.boolean(),
});
const colorKeyframeSchema = z.object({
  id: z.string().min(1),
  time: z.number().finite().nonnegative(),
  left: color,
  right: color,
});
const dancerTrackSchema = z.object({
  dancerId: z.string().min(1),
  positionFrames: z.array(positionKeyframeSchema),
  colorFrames: z.array(colorKeyframeSchema),
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
    tracks: z.array(dancerTrackSchema).default([]),
  })
  .superRefine((c, ctx) => {
    const trackFrames = c.tracks.flatMap((track) => [
      ...track.positionFrames,
      ...track.colorFrames,
    ]);
    const ids = [
      ...c.dancers.map((d) => d.id),
      ...c.frames.map((f) => f.id),
      ...trackFrames.map((frame) => frame.id),
    ];
    const invalid =
      new Set(ids).size !== ids.length ||
      new Set(c.frames.map((f) => Math.round(f.time * 1000))).size !==
        c.frames.length ||
      c.frames.some(
        (f) =>
          f.poses.length !== c.dancers.length ||
          new Set(f.poses.map((p) => p.dancerId)).size !== f.poses.length ||
          f.poses.some((p) => !c.dancers.some((d) => d.id === p.dancerId)),
      ) ||
      new Set(c.tracks.map((track) => track.dancerId)).size !==
        c.tracks.length ||
      c.tracks.some(
        (track) =>
          !c.dancers.some((d) => d.id === track.dancerId) ||
          new Set(
            track.positionFrames.map((frame) => Math.round(frame.time * 1000)),
          ).size !== track.positionFrames.length ||
          new Set(
            track.colorFrames.map((frame) => Math.round(frame.time * 1000)),
          ).size !== track.colorFrames.length,
      );
    if (invalid)
      ctx.addIssue({ code: "custom", message: "队形 ID、时间或舞者引用无效" });
  });
export type Choreography = z.infer<typeof choreographySchema>;
export type Pose = z.infer<typeof poseSchema>;
export type PositionKeyframe = z.infer<typeof positionKeyframeSchema>;
export type ColorKeyframe = z.infer<typeof colorKeyframeSchema>;
export type DancerTrack = z.infer<typeof dancerTrackSchema>;
export type TrackKind = "position" | "color";
export const emptyChoreography = (): Choreography => ({
  canvas: { width: 800, height: 600 },
  dancers: [],
  frames: [],
  tracks: [],
});
export const defaultPose = (dancerId: string): Pose => ({
  dancerId,
  x: 0.5,
  y: 0.5,
  left: "极橙",
  right: "极橙",
  visible: false,
});
export function normalizeStickColor(name: string): StickColor {
  const canonical = Object.hasOwn(legacyColorAliases, name)
    ? legacyColorAliases[name]
    : name;
  const color = colors.find((c) => c[0] === canonical);
  if (!color) throw new Error("未知光棒颜色。");
  return color[0];
}
export const colorHex = (name: StickColor | string) => {
  const canonical = normalizeStickColor(name);
  return colors.find((c) => c[0] === canonical)![1];
};
const sameTime = (a: number, b: number) =>
  Math.round(a * 1000) === Math.round(b * 1000);
const clonePose = (pose: Pose, dancerId = pose.dancerId): Pose => ({
  ...pose,
  dancerId,
});
const derivedTrackFrameId = (
  frameId: string,
  dancerId: string,
  kind: TrackKind,
) => `${frameId}:${dancerId}:${kind}`;

/** Build per-dancer tracks from the original aggregate frame format on demand. */
export function ensureTracks(c: Choreography): DancerTrack[] {
  c.tracks ??= [];
  for (const dancer of c.dancers) {
    if (c.tracks.some((track) => track.dancerId === dancer.id)) continue;
    c.tracks.push({
      dancerId: dancer.id,
      positionFrames: c.frames.flatMap((frame) => {
        const pose = frame.poses.find((item) => item.dancerId === dancer.id);
        return pose
          ? [
              {
                id: derivedTrackFrameId(frame.id, dancer.id, "position"),
                time: frame.time,
                x: pose.x,
                y: pose.y,
                visible: pose.visible,
              },
            ]
          : [];
      }),
      colorFrames: c.frames.flatMap((frame) => {
        const pose = frame.poses.find((item) => item.dancerId === dancer.id);
        return pose
          ? [
              {
                id: derivedTrackFrameId(frame.id, dancer.id, "color"),
                time: frame.time,
                left: pose.left,
                right: pose.right,
              },
            ]
          : [];
      }),
    });
  }
  c.tracks = c.tracks.filter((track) =>
    c.dancers.some((dancer) => dancer.id === track.dancerId),
  );
  return c.tracks;
}
export function getDancerFrames(
  c: Choreography,
  dancerId: string,
  kind: TrackKind,
) {
  const track = c.tracks?.find((item) => item.dancerId === dancerId);
  if (track)
    return [
      ...(kind === "position" ? track.positionFrames : track.colorFrames),
    ].sort((a, b) => a.time - b.time);
  return c.frames
    .flatMap((frame) => {
      const pose = frame.poses.find((item) => item.dancerId === dancerId);
      return pose
        ? [
            {
              id: derivedTrackFrameId(frame.id, dancerId, kind),
              time: frame.time,
              ...(kind === "position"
                ? { x: pose.x, y: pose.y, visible: pose.visible }
                : { left: pose.left, right: pose.right }),
            },
          ]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}
function samplePosition(track: DancerTrack | undefined, time: number) {
  const frames = track?.positionFrames ?? [];
  const before = frames.filter((frame) => frame.time <= time).at(-1);
  if (!before) return { x: 0.5, y: 0.5, visible: false };
  const after = frames.find((frame) => frame.time > time);
  if (!after || !before.visible || !after.visible)
    return { x: before.x, y: before.y, visible: before.visible };
  const ratio = (time - before.time) / (after.time - before.time);
  return {
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
    visible: before.visible,
  };
}
function sampleColor(track: DancerTrack | undefined, time: number) {
  const before = (track?.colorFrames ?? [])
    .filter((frame) => frame.time <= time)
    .at(-1);
  return before
    ? { left: before.left, right: before.right }
    : { left: "极橙" as StickColor, right: "极橙" as StickColor };
}
export function sampleDancer(c: Choreography, dancerId: string, time: number) {
  const track = c.tracks?.find((item) => item.dancerId === dancerId);
  if (track || c.tracks?.length) {
    if (!c.dancers.some((dancer) => dancer.id === dancerId)) return undefined;
    return {
      dancerId,
      ...samplePosition(track, time),
      ...sampleColor(track, time),
    };
  }
  const frames = [...c.frames].sort((a, b) => a.time - b.time);
  const before = frames.filter((frame) => frame.time <= time).at(-1);
  if (!before)
    return c.dancers.some((dancer) => dancer.id === dancerId)
      ? defaultPose(dancerId)
      : undefined;
  const pose = before.poses.find((item) => item.dancerId === dancerId);
  if (!pose) return undefined;
  const after = frames.find((frame) => frame.time > time);
  const next = after?.poses.find((item) => item.dancerId === dancerId);
  if (!after || !pose.visible || !next?.visible)
    return clonePose(pose, dancerId);
  const ratio = (time - before.time) / (after.time - before.time);
  return {
    ...clonePose(pose, dancerId),
    x: pose.x + (next.x - pose.x) * ratio,
    y: pose.y + (next.y - pose.y) * ratio,
  };
}
function rebuildFrames(c: Choreography) {
  const tracks = ensureTracks(c);
  const times = [
    ...new Set(
      tracks.flatMap((track) => [
        ...track.positionFrames.map((frame) => frame.time),
        ...track.colorFrames.map((frame) => frame.time),
      ]),
    ),
  ].sort((a, b) => a - b);
  c.frames = times.map((time) => ({
    id:
      c.frames.find((frame) => sameTime(frame.time, time))?.id ??
      crypto.randomUUID(),
    time,
    poses: c.dancers.map((dancer) => sampleDancer(c, dancer.id, time)!),
  }));
}
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
  if (c.tracks?.length)
    return c.dancers.flatMap((dancer) => {
      const pose = sampleDancer(c, dancer.id, time);
      return pose ? [pose] : [];
    });
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
  const tracks = ensureTracks(c);
  for (const dancer of c.dancers) {
    const pose =
      poses.find((item) => item.dancerId === dancer.id) ??
      defaultPose(dancer.id);
    saveDancerFrame(c, dancer.id, "position", t, pose, false);
    saveDancerFrame(c, dancer.id, "color", t, pose, false);
  }
  rebuildFrames(c);
}
export function saveDancerFrame(
  c: Choreography,
  dancerId: string,
  kind: TrackKind,
  time: number,
  pose = sampleDancer(c, dancerId, time),
  rebuild = true,
) {
  if (!pose) throw new Error("舞者不存在。");
  const t = frameTime(time),
    tracks = ensureTracks(c),
    track = tracks.find((item) => item.dancerId === dancerId);
  if (!track) throw new Error("舞者不存在。");
  if (kind === "position") {
    if (!track.positionFrames.length && t > 0)
      track.positionFrames.push({
        id: crypto.randomUUID(),
        time: 0,
        x: 0.5,
        y: 0.5,
        visible: false,
      });
    const existing = track.positionFrames.find((frame) =>
      sameTime(frame.time, t),
    );
    const next = { x: pose.x, y: pose.y, visible: pose.visible };
    if (existing) Object.assign(existing, next);
    else
      track.positionFrames.push({ id: crypto.randomUUID(), time: t, ...next });
    track.positionFrames.sort((a, b) => a.time - b.time);
  } else {
    if (!track.colorFrames.length && t > 0)
      track.colorFrames.push({
        id: crypto.randomUUID(),
        time: 0,
        left: "极橙",
        right: "极橙",
      });
    const existing = track.colorFrames.find((frame) => sameTime(frame.time, t));
    const next = { left: pose.left, right: pose.right };
    if (existing) Object.assign(existing, next);
    else track.colorFrames.push({ id: crypto.randomUUID(), time: t, ...next });
    track.colorFrames.sort((a, b) => a.time - b.time);
  }
  if (rebuild) rebuildFrames(c);
}
export function addDancer(c: Choreography, name: string, time: number) {
  if (!name.trim()) throw new Error("请输入姓名。");
  const id = crypto.randomUUID();
  const tracks = ensureTracks(c);
  c.dancers.push({ id, name: name.trim() });
  tracks.push({
    dancerId: id,
    positionFrames: [],
    colorFrames: [],
  });
  setVisibility(c, id, time, true);
  saveDancerFrame(c, id, "color", time);
  return id;
}
export function setVisibility(
  c: Choreography,
  id: string,
  time: number,
  visible: boolean,
) {
  const t = frameTime(time);
  const pose = sampleDancer(c, id, t);
  if (!pose) throw new Error("舞者不存在。");
  saveDancerFrame(c, id, "position", t, { ...pose, visible }, false);
  const track = ensureTracks(c).find((item) => item.dancerId === id)!;
  for (const frame of track.positionFrames)
    if (frame.time >= t) frame.visible = visible;
  rebuildFrames(c);
}
export function changePose(
  c: Choreography,
  id: string,
  time: number,
  patch: Partial<Omit<Pose, "dancerId">>,
) {
  const pose = sampleDancer(c, id, time);
  if (!pose) throw new Error("舞者不存在。");
  Object.assign(pose, patch);
  poseSchema.parse(pose);
  if ("x" in patch || "y" in patch || "visible" in patch)
    saveDancerFrame(c, id, "position", time, pose, false);
  if ("left" in patch || "right" in patch)
    saveDancerFrame(c, id, "color", time, pose, false);
  rebuildFrames(c);
}
export function deleteDancer(c: Choreography, id: string) {
  ensureTracks(c);
  c.dancers = c.dancers.filter((d) => d.id !== id);
  c.tracks = c.tracks.filter((track) => track.dancerId !== id);
  rebuildFrames(c);
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
export function moveDancerFrame(
  c: Choreography,
  dancerId: string,
  kind: TrackKind,
  id: string,
  time: number,
  duration?: number,
) {
  const t = frameTime(time, duration),
    track = ensureTracks(c).find((item) => item.dancerId === dancerId);
  if (!track) throw new Error("舞者不存在。");
  const frames = kind === "position" ? track.positionFrames : track.colorFrames;
  if (frames.some((frame) => frame.id !== id && sameTime(frame.time, t)))
    throw new Error(
      `该舞者在此时刻已有${kind === "position" ? "位置" : "颜色"}关键帧。`,
    );
  const frame = frames.find((item) => item.id === id);
  if (!frame) throw new Error("关键帧不存在。");
  frame.time = t;
  frames.sort((a, b) => a.time - b.time);
  rebuildFrames(c);
}
export type KeyframeCleanupResult = {
  position: number;
  color: number;
  total: number;
};

const closeEnough = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Remove keyframes whose value is reproduced exactly by the surrounding track. */
export function cleanupRedundantKeyframes(
  c: Choreography,
): KeyframeCleanupResult {
  const result: KeyframeCleanupResult = { position: 0, color: 0, total: 0 };
  for (const track of ensureTracks(c)) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index < track.positionFrames.length; index++) {
        const frame = track.positionFrames[index];
        track.positionFrames.splice(index, 1);
        const sampled = samplePosition(track, frame.time);
        if (
          sampled.visible === frame.visible &&
          closeEnough(sampled.x, frame.x) &&
          closeEnough(sampled.y, frame.y)
        ) {
          result.position++;
          changed = true;
          break;
        }
        track.positionFrames.splice(index, 0, frame);
      }
    }
    changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index < track.colorFrames.length; index++) {
        const frame = track.colorFrames[index];
        track.colorFrames.splice(index, 1);
        const sampled = sampleColor(track, frame.time);
        if (sampled.left === frame.left && sampled.right === frame.right) {
          result.color++;
          changed = true;
          break;
        }
        track.colorFrames.splice(index, 0, frame);
      }
    }
  }
  result.total = result.position + result.color;
  if (result.total) rebuildFrames(c);
  return result;
}

export function removeDancerFrame(
  c: Choreography,
  dancerId: string,
  kind: TrackKind,
  id: string,
) {
  const track = ensureTracks(c).find((item) => item.dancerId === dancerId);
  if (!track) throw new Error("舞者不存在。");
  const frames = kind === "position" ? track.positionFrames : track.colorFrames;
  const before = frames.length;
  if (kind === "position")
    track.positionFrames = track.positionFrames.filter(
      (frame) => frame.id !== id,
    );
  else track.colorFrames = track.colorFrames.filter((frame) => frame.id !== id);
  if (
    (kind === "position" ? track.positionFrames : track.colorFrames).length ===
    before
  )
    throw new Error("关键帧不存在。");
  rebuildFrames(c);
}

/** Resize every formation; unscaled coordinates preserve offsets from the stage center. */
export function resizeCanvas(
  c: Choreography,
  width: number,
  height: number,
  scalePositions: boolean,
) {
  const next = canvasSchema.parse({ width, height });
  const previous = c.canvas ?? { width: 800, height: 600 };
  if (previous.width === width && previous.height === height) return;
  const tracks = ensureTracks(c);
  if (!scalePositions) {
    for (const track of tracks)
      for (const frame of track.positionFrames) {
        frame.x = Math.max(
          0.03,
          Math.min(0.97, 0.5 + ((frame.x - 0.5) * previous.width) / width),
        );
        frame.y = Math.max(
          0.04,
          Math.min(0.96, 0.5 + ((frame.y - 0.5) * previous.height) / height),
        );
      }
  }
  c.canvas = next;
  rebuildFrames(c);
}
