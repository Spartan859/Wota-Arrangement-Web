import { z } from "zod";
export const sections: Record<string, string> = {
  p: "前奏",
  a: "A melo",
  b: "B melo",
  c: "C melo",
  r: "副歌",
  i: "间奏",
  o: "尾奏",
};
export const pureText = "（纯动作/无歌词）";
export const headers = [
  "段落",
  "拍数",
  "日文歌词",
  "中文歌词",
  "技 / 动作编排",
  "备注",
];
const time = z.number().finite().nonnegative().nullable();
const lyricSchema = z.object({
  id: z.string().min(1),
  jp: z.string(),
  cn: z.string(),
  time,
});
export const blockSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  beats: z.string(),
  lyrics: z.array(lyricSchema).min(1),
  arrangement: z.string(),
  remarks: z.string(),
  start: time,
  end: time,
});
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  songName: z.string(),
  bpm: z.string(),
  blocks: z.array(blockSchema),
  pool: z.array(
    lyricSchema.extend({
      status: z.enum(["pending", "staged", "used", "skipped"]),
    }),
  ),
  staging: z.array(z.string()),
  insertionAfter: z.string().nullable(),
  audio: z
    .object({
      id: z.string().nullable(),
      name: z.string(),
      duration: z.number().finite().positive(),
    })
    .nullable(),
  position: z.number().finite().nonnegative(),
  updatedAt: z.number().finite(),
});
export type Lyric = z.infer<typeof lyricSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Project = z.infer<typeof projectSchema>;
export const uid = () => crypto.randomUUID();
export const lyric = (jp = "", cn = "", time: number | null = null): Lyric => ({
  id: uid(),
  jp,
  cn,
  time,
});
export const resolveSection = (value: string) =>
  sections[value.toLowerCase()] ?? value;
export const block = (type = "副歌", beats = "8", pure = false): Block => ({
  id: uid(),
  type: resolveSection(type),
  beats,
  lyrics: [lyric(pure ? pureText : "", pure ? pureText : "")],
  arrangement: "",
  remarks: "",
  start: null,
  end: null,
});
export const project = (): Project => ({
  schemaVersion: 1,
  id: uid(),
  songName: "未命名歌曲",
  bpm: "120",
  blocks: [],
  pool: [],
  staging: [],
  insertionAfter: null,
  audio: null,
  position: 0,
  updatedAt: Date.now(),
});
export function parseProject(text: string): Project {
  const result = projectSchema.safeParse(JSON.parse(text));
  if (!result.success)
    throw new Error("项目格式或版本不受支持，请导入本工具导出的 JSON。");
  const p = result.data;
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(p.blocks.map((b) => b.id)) ||
    !unique(p.blocks.flatMap((b) => b.lyrics.map((l) => l.id))) ||
    !unique(p.pool.map((l) => l.id)) ||
    !unique(p.staging)
  )
    throw new Error("项目存在重复 ID。");
  if (
    p.staging.some(
      (id) => !p.pool.some((l) => l.id === id && l.status === "staged"),
    ) ||
    p.pool.some((l) => l.status === "staged" && !p.staging.includes(l.id))
  )
    throw new Error("项目暂存区数据不一致。");
  if (
    p.insertionAfter !== null &&
    p.insertionAfter !== "start" &&
    !p.blocks.some((b) => b.id === p.insertionAfter)
  )
    throw new Error("项目插入位置不存在。");
  return p;
}
export function backup(p: Project): string {
  return JSON.stringify(
    { ...p, audio: p.audio ? { ...p.audio, id: null } : null },
    null,
    2,
  );
}
export function collect(p: Project, ids: string[]): void {
  for (const l of p.pool)
    if (ids.includes(l.id) && l.status === "pending") {
      l.status = "staged";
      p.staging.push(l.id);
    }
}
export function insert(p: Project, b: Block): void {
  const index =
    p.insertionAfter === "start"
      ? 0
      : p.insertionAfter === null
        ? p.blocks.length
        : p.blocks.findIndex((x) => x.id === p.insertionAfter) + 1;
  p.blocks.splice(index, 0, b);
  p.insertionAfter = b.id;
}
export function pack(p: Project, type: string, beats: string): string {
  const b = block(type, beats);
  if (p.staging.length)
    b.lyrics = p.staging.map((id) => {
      const row = p.pool.find((l) => l.id === id)!;
      row.status = "used";
      return { id: uid(), jp: row.jp, cn: row.cn, time: row.time };
    });
  insert(p, b);
  p.staging = [];
  return b.id;
}
export function move(p: Project, from: number, to: number): void {
  if (from < 0 || to < 0 || to >= p.blocks.length) return;
  const [b] = p.blocks.splice(from, 1);
  p.blocks.splice(to, 0, b);
}
export class History<T> {
  past: T[] = [];
  future: T[] = [];
  record(value: T) {
    this.past = [...this.past.slice(-99), structuredClone(value)];
    this.future = [];
  }
  undo(value: T) {
    if (!this.past.length) return value;
    this.future.push(structuredClone(value));
    return this.past.pop()!;
  }
  redo(value: T) {
    if (!this.future.length) return value;
    this.past.push(structuredClone(value));
    return this.future.pop()!;
  }
}
