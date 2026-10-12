import { appendBatonUsage } from "./xlsxBatonUsage";
import ExcelJS from "exceljs";
import { headers, type Project } from "./model";
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
