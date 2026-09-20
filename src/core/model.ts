import { choreographySchema } from "./choreography";
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
export const sectionTypes = [
  "前奏",
  "主歌",
  "A melo",
  "B melo",
  "C melo",
  "预副歌",
  "副歌",
  "第一副歌",
  "第二副歌",
  "最终副歌",
  "桥段",
  "过渡段",
  "间奏",
  "舞蹈段",
  "留白",
  "尾奏",
];
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
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  songName: z.string(),
  bpm: z.string(),
  blocks: z.array(blockSchema),
  choreography: choreographySchema.optional(),
  lyricSource: z
    .object({
      raw: z.string(),
      name: z.string(),
      lrc: z.boolean(),
      offset: z.number().finite(),
    })
    .optional(),
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
  schemaVersion: 2,
  id: uid(),
  songName: "未命名歌曲",
  bpm: "120",
  blocks: [],
  audio: null,
  position: 0,
  updatedAt: Date.now(),
});
export function parseProject(text: string): Project {
  const result = projectSchema.safeParse(JSON.parse(text));
  if (!result.success)
    throw new Error("项目格式或版本不受支持，请导入本工具导出的 JSON。");
  const p = result.data;
  const ids = p.blocks.flatMap((b) => [b.id, ...b.lyrics.map((l) => l.id)]);
  if (new Set(ids).size !== ids.length) throw new Error("项目存在重复 ID。");
  return p;
}
export function backup(p: Project): string {
  return JSON.stringify(
    { ...p, audio: p.audio ? { ...p.audio, id: null } : null },
    null,
    2,
  );
}
export function insertAt(
  p: Project,
  b: Block,
  time: number | null = null,
): void {
  if (time !== null) b.start = time;
  const index =
    time === null
      ? p.blocks.length
      : p.blocks.findIndex((x) => x.start !== null && x.start > time);
  p.blocks.splice(index < 0 ? p.blocks.length : index, 0, b);
}
export function removeBlock(p: Project, id: string): void {
  p.blocks = p.blocks.filter((b) => b.id !== id);
}
export function move(p: Project, from: number, to: number): void {
  if (from < 0 || to < 0 || to >= p.blocks.length || from === to) return;
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
