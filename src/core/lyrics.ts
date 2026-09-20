import { lyric, type Lyric } from "./model";
export type ImportPreview = {
  rows: Lyric[];
  warnings: string[];
  needsAcknowledgement: boolean;
};
export function parseLyrics(raw: string, lrc: boolean): ImportPreview {
  const text = raw.replace(/^\uFEFF/, "");
  const warnings: string[] = [];
  const rows: Lyric[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lrc) {
    for (let i = 0; i < lines.length; i += 2)
      rows.push(lyric(lines[i], lines[i + 1] ?? ""));
    if (lines.length % 2)
      warnings.push("最后一行没有中文译文，请补全或确认保留为空译文。");
  } else {
    const offsets = [...text.matchAll(/\[offset:([+-]?\d+)\]/gi)];
    const offset = offsets.length ? Number(offsets.at(-1)![1]) / 1000 : 0;
    const grouped = new Map<number, string[]>();
    for (const line of lines) {
      const stamps = [
        ...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g),
      ];
      const content = line.replace(/\[[^\]]*\]/g, "").trim();
      if (!content) continue;
      if (!stamps.length) {
        rows.push(lyric(content));
        continue;
      }
      for (const stamp of stamps) {
        const t =
          Number(stamp[1]) * 60 +
          Number(stamp[2]) +
          Number(`0.${stamp[3] ?? "0"}`) +
          offset;
        const existing = grouped.get(t) ?? [];
        existing.push(content);
        grouped.set(t, existing);
      }
    }
    for (const [t, values] of [...grouped].sort((a, b) => a[0] - b[0])) {
      for (const value of values) rows.push(lyric(value, "", t));
    }
    if (rows.some((r) => r.time === null))
      warnings.push("无时间戳的行已保留，可稍后手动打点。");
    if (rows.some((r) => r.time !== null && r.time < 0))
      warnings.push("offset 导致负时间，请修正后导入。");
  }
  if (!rows.length) throw new Error("没有找到歌词，请检查文件内容。");
  return {
    rows,
    warnings,
    needsAcknowledgement: !lrc && lines.length % 2 === 1,
  };
}
export function shifted(
  rows: Lyric[],
  offset: number,
  duration?: number,
): Lyric[] {
  if (!Number.isFinite(offset)) throw new Error("时间偏移必须是有效秒数。");
  return rows.map((row) => {
    const time =
      row.time === null ? null : Math.round((row.time + offset) * 1000) / 1000;
    if (
      time !== null &&
      (time < 0 || (duration !== undefined && time > duration))
    )
      throw new Error("歌词时间超出歌曲范围，请调整偏移或时间。");
    return { ...row, time };
  });
}
