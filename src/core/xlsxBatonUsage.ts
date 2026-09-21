import type ExcelJS from "exceljs";
import type { Project } from "./model";
import {
  batonUsage,
  batonLabel,
  replacementChanges,
  usageRule,
  usageTime,
} from "./batonUsage";
import { batonSequenceImage } from "./batonSequenceImage";
export const usageFooterName = "WOTA_USAGE_FOOTER";
export async function appendBatonUsage(wb: ExcelJS.Workbook, project: Project) {
  const stats = batonUsage(project),
    sheet = wb.worksheets[0];
  const footer = sheet.rowCount + 2;
  wb.definedNames.add(`'${sheet.name}'!$A$${footer}`, usageFooterName);
  const note = (row: number, text: string, bold = false) => {
    sheet.mergeCells(row, 1, row, 6);
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { size: bold ? 12 : 10, bold, color: { argb: "FF243247" } };
    cell.alignment = { vertical: "middle", shrinkToFit: true };
    sheet.getRow(row).height = 28;
  };
  note(
    footer,
    `光棒用量 · 共 ${stats.total} 根   ${stats.colors.map((c) => `${c.color} ${c.count} 根`).join(" · ")}`,
    true,
  );
  sheet.getCell(footer, 1).note = usageRule;
  let row = footer + 1;
  if (stats.outOfRange)
    note(
      row++,
      `注意：包含 ${stats.outOfRange} 个超出歌曲时长的关键帧，请检查对时。`,
    );
  note(row++, "换棒列表", true);
  // Values exist only in column A; original Python readers ignore trailing rows
  // without beats/lyrics. The Web reader additionally uses the named boundary.
  const width = sheet.columns
    .slice(2, 6)
    .reduce((sum, c) => sum + (c.width ?? 10) * 7 + 5, 0);
  for (const [i, d] of stats.dancers.entries()) {
    sheet.mergeCells(row, 1, row, 2);
    const name = sheet.getCell(row, 1);
    name.value = `${i + 1}. ${d.name} · ${d.total} 根`;
    name.font = { size: 11, bold: true };
    name.alignment = { vertical: "middle", shrinkToFit: true };
    const changes = replacementChanges(d.changes);
    name.note =
      changes
        .map(
          (c) =>
            `${usageTime(c.time)} 左手：${batonLabel(c.left)}；右手：${batonLabel(c.right)}`,
        )
        .join("\n") || "无换棒记录";
    sheet.getRow(row).height = 32;
    if (changes.length) {
      const image = await batonSequenceImage(changes),
        ratio = Math.min(1, (width - 12) / image.width);
      const id = wb.addImage({ base64: image.base64, extension: "png" });
      sheet.addImage(id, {
        tl: { col: 2, row: row - 1 + 0.1 },
        ext: { width: image.width * ratio, height: image.height * ratio },
        editAs: "oneCell",
      });
    } else name.value += " · 无换棒记录";
    row++;
  }
  if (!stats.dancers.length) note(row, "暂无换棒记录");
}
