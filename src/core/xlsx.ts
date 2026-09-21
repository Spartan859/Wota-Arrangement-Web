import { appendBatonUsage, usageFooterName } from "./xlsxBatonUsage";
import ExcelJS from "exceljs";
import {
  block,
  headers,
  lyric,
  project,
  pureText,
  type Project,
} from "./model";
function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value)
      return value.richText
        .map((r) => r.text)
        .join("")
        .trim();
    throw new Error("表格包含不支持的公式或对象，请使用标准文本模板。");
  }
  return String(value).trim();
}
export async function readXlsx(data: ArrayBuffer): Promise<Project> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel 中没有工作表。");
  if (headers.some((h, i) => text(ws.getCell(2, i + 1).value) !== h))
    throw new Error("表头不匹配，仅支持本工具生成的六列标准模板。");
  const p = project();
  const title = text(ws.getCell("A1").value);
  const match = title.match(/^(.*)\s+\(BPM:\s*(.*)\)$/);
  p.songName = match?.[1].trim() || title || "未命名歌曲";
  p.bpm = match?.[2].trim() || "120";
  let section = "";
  let current: ReturnType<typeof block> | undefined;
  const raw = (row: number, col: number) => {
    const cell = ws.getCell(row, col);
    return cell.isMerged && cell.master.address !== cell.address
      ? ""
      : text(cell.value);
  };
  const footerRange = wb.definedNames.getRanges(usageFooterName).ranges?.[0];
  const footerRow =
    footerRange && footerRange.startsWith(`'${ws.name}'!`)
      ? Number(footerRange.match(/\$A\$(\d+)$/)?.[1])
      : NaN;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (r === footerRow) break;
    const values = Array.from({ length: 6 }, (_, c) => raw(r, c + 1));
    const beatsCell = ws.getCell(r, 2);
    const continuation = beatsCell.isMerged && Number(beatsCell.master.row) < r;
    if (!values.some(Boolean) && !continuation) continue;
    const [s, beats, jp, cn, arrangement, remarks] = values;
    if (s) section = s;
    if (beats) {
      if (!section) throw new Error(`第 ${r} 行缺少段落类型。`);
      current = block(section, beats);
      current.lyrics = [];
      current.arrangement = arrangement;
      current.remarks = remarks;
      p.blocks.push(current);
    }
    if (!current) throw new Error(`第 ${r} 行无法定位编排块。`);
    if (beats || jp || cn || continuation) current.lyrics.push(lyric(jp, cn));
  }
  if (!p.blocks.length) throw new Error("Excel 中没有可解析的编排段落。");
  for (const b of p.blocks)
    if (!b.lyrics.length) b.lyrics = [lyric(pureText, pureText)];
  return p;
}
export async function writeXlsx(p: Project): Promise<ArrayBuffer> {
  if (!p.blocks.length) throw new Error("请先添加至少一个段落。");
  if (
    p.blocks.some(
      (b) =>
        !b.type.trim() || !/^\d+$/.test(b.beats.trim()) || Number(b.beats) <= 0,
    )
  )
    throw new Error("导出前请填写正整数拍数和段落类型。");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("打艺编排脚本");
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = `${p.songName} (BPM: ${p.bpm})`;
  ws.getCell("A1").font = { size: 18, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 34;
  ws.getRow(2).values = headers;
  ws.getRow(2).eachCell((c) => {
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2D3D" },
    };
    c.font = { color: { argb: "FFFFFFFF" }, bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
  });
  ws.getRow(2).height = 26;
  const spans: [number, number][] = [];
  let row = 3;
  let alternate = false;
  p.blocks.forEach((b, i) => {
    if (i === 0 || p.blocks[i - 1].type !== b.type) alternate = !alternate;
    const start = row;
    for (const l of b.lyrics) {
      ws.getCell(row, 3).value = l.jp;
      ws.getCell(row, 4).value = l.cn;
      for (let c = 1; c <= 6; c++) {
        const cell = ws.getCell(row, c);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: alternate ? "FFF9FAFB" : "FFEFF3F6" },
        };
        cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
        cell.border = Object.fromEntries(
          ["top", "bottom", "left", "right"].map((side) => [
            side,
            { style: "thin", color: { argb: "FFDCDFE6" } },
          ]),
        );
      }
      ws.getRow(row).height = 30;
      row++;
    }
    spans.push([start, row - 1]);
    for (const [col, value] of [
      [2, b.beats],
      [5, b.arrangement],
      [6, b.remarks],
    ] as const) {
      if (row - 1 > start) ws.mergeCells(start, col, row - 1, col);
      const cell = ws.getCell(start, col);
      cell.value = value;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    }
  });
  for (let i = 0; i < p.blocks.length;) {
    let j = i;
    while (j + 1 < p.blocks.length && p.blocks[j + 1].type === p.blocks[i].type)
      j++;
    if (spans[j][1] > spans[i][0])
      ws.mergeCells(spans[i][0], 1, spans[j][1], 1);
    const cell = ws.getCell(spans[i][0], 1);
    cell.value = p.blocks[i].type;
    cell.font = { bold: true, color: { argb: "FF409EFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    i = j + 1;
  }
  [14, 12, 40, 40, 30, 26].forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
  await appendBatonUsage(wb, p);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer).buffer;
}
