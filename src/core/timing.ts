import type { Block, Lyric } from "./model";
export function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "未对时";
  const seconds = Math.max(0, value);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}
export function suggestedDuration(bpm: string, beats: string): number | null {
  const b = Number(bpm.trim()),
    count = Number(beats.trim());
  return b > 0 && count > 0 && Number.isFinite(b) && Number.isFinite(count)
    ? (count * 60) / b
    : null;
}
export function intervalError(
  candidate: Block,
  blocks: Block[],
  duration?: number,
): string | null {
  const { start, end } = candidate;
  if (
    [start, end].some(
      (t) =>
        t !== null &&
        (!Number.isFinite(t) ||
          t < 0 ||
          (duration !== undefined && t > duration)),
    )
  )
    return "时间必须在歌曲范围内。";
  if (start === null || end === null) return null;
  if (end <= start) return "结束时间必须晚于开始时间。";
  if (
    blocks.some(
      (b) =>
        b.id !== candidate.id &&
        b.start !== null &&
        b.end !== null &&
        start < b.end &&
        end > b.start,
    )
  )
    return "段落时间不能与其他段落重叠。";
  return null;
}
export function playable(
  b: Block,
  blocks: Block[],
  duration?: number,
): boolean {
  return (
    duration !== undefined &&
    b.start !== null &&
    b.end !== null &&
    !intervalError(b, blocks, duration)
  );
}
export function activeBlock(blocks: Block[], time: number): Block | undefined {
  return blocks.find(
    (b) =>
      b.start !== null && b.end !== null && time >= b.start && time < b.end,
  );
}
export function activeLyric(
  blocks: Block[],
  time: number,
  duration: number,
): Lyric | undefined {
  const rows = blocks
    .flatMap((b) =>
      b.lyrics
        .filter((l) => l.time !== null)
        .map((l) => ({ row: l, end: b.end })),
    )
    .sort((a, b) => a.row.time! - b.row.time!);
  for (let i = rows.length - 1; i >= 0; i--) {
    const { row, end } = rows[i];
    const until = rows[i + 1]?.row.time ?? end ?? duration;
    if (time >= row.time! && time < until) return row;
  }
}
export function orderConflict(blocks: Block[]): boolean {
  const timed = blocks.filter((b) => b.start !== null);
  return timed.some((b, i) => i > 0 && b.start! < timed[i - 1].start!);
}

/** Clamp a drag to the neighbouring time intervals, independently of list order. */
export function draggedRange(
  block: Block,
  blocks: Block[],
  duration: number,
  mode: "start" | "end" | "move",
  delta: number,
): { start: number; end: number } {
  const start = block.start!,
    end = block.end!;
  const others = blocks.filter(
    (b) => b.id !== block.id && b.start !== null && b.end !== null,
  );
  const lower = Math.max(
    0,
    ...others.filter((b) => b.end! <= start).map((b) => b.end!),
  );
  const upper = Math.min(
    duration,
    ...others.filter((b) => b.start! >= end).map((b) => b.start!),
  );
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  if (mode === "start")
    return {
      start: clamp(
        start + delta,
        lower,
        end - Math.min(0.01, (end - start) / 2),
      ),
      end,
    };
  if (mode === "end")
    return {
      start,
      end: clamp(end + delta, start + Math.min(0.01, (end - start) / 2), upper),
    };
  const shift = clamp(delta, lower - start, upper - end);
  return { start: start + shift, end: end + shift };
}

/** Plan a new clip inside the clicked gap without moving existing clips. */
export function insertionRange(
  start: number | null,
  beats: string,
  bpm: string,
  blocks: Block[],
  duration?: number,
) {
  if (start === null) return { start: null, end: null };
  const length = suggestedDuration(bpm, beats);
  if (length === null) throw new Error("请填写有效 BPM 后创建时间轴片段。");
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    (duration !== undefined && start >= duration)
  )
    throw new Error("起点必须在歌曲范围内。");
  if (
    blocks.some(
      (b) =>
        b.start !== null && b.end !== null && start >= b.start && start < b.end,
    )
  )
    throw new Error("请在段落之间的空白处新建。");
  const end = Math.min(
    start + length,
    duration ?? Infinity,
    ...blocks
      .filter((b) => b.start !== null && b.start > start)
      .map((b) => b.start!),
  );
  return { start, end };
}

/** Resolve a click in an empty lane to the beginning of that gap. */
export function insertionStart(clicked: number, blocks: Block[]) {
  return Math.max(
    0,
    ...blocks
      .filter(
        (b) =>
          b.start !== null &&
          b.end !== null &&
          b.end <= clicked &&
          b.start < b.end,
      )
      .map((b) => b.end!),
  );
}
