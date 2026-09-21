import type ExcelJS from "exceljs";
import type { Project } from "./model";
import { batonUsage, batonLabel, usageRule, usageTime } from "./batonUsage";
export function appendBatonUsage(wb: ExcelJS.Workbook, project: Project) {
  const stats = batonUsage(project);
  const sheet = wb.addWorksheet("光棒用量统计");
  sheet.columns = [
    { width: 9 },
    { width: 18 },
    { width: 16 },
    { width: 21 },
    { width: 21 },
    { width: 16 },
  ];
  const band = (label: string) => {
    const row = sheet.addRow([label]);
    sheet.mergeCells(row.number, 1, row.number, 6);
    row.height = 28;
    row.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF31465E" },
    };
  };
  const note = (text: string) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, 6);
    row.height = 34;
    row.alignment = { wrapText: true, vertical: "middle" };
  };
  const header = (values: string[]) => {
    const row = sheet.addRow(values);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE7EEF8" },
      };
    });
  };
  band("光棒用量统计");
  note(project.songName);
  note(usageRule);
  if (stats.outOfRange)
    note(
      `注意：统计包含 ${stats.outOfRange} 个超出歌曲时长的关键帧，请检查对时。`,
    );
  header(["序号", "颜色", "累计消耗（根）"]);
  stats.colors.forEach((row, i) => sheet.addRow([i + 1, row.color, row.count]));
  sheet.addRow(["合计", "", stats.total]);
  if (!stats.colors.length) note("暂无光棒消耗记录");
  sheet.addRow([]);
  band("舞者切换顺序");
  for (const [index, d] of stats.dancers.entries()) {
    band(`${index + 1}. ${d.name} · ${d.total} 根`);
    note(
      d.colors.map((c) => `${c.color} ${c.count} 根`).join(" · ") || "无消耗",
    );
    header(["顺序", "时间", "状态", "左手", "右手", "新增（根）"]);
    d.changes.forEach((change, i) =>
      sheet.addRow([
        i + 1,
        usageTime(change.time),
        change.kind,
        batonLabel(change.left),
        batonLabel(change.right),
        change.added,
      ]),
    );
    if (!d.changes.length) note("无入场记录");
    sheet.addRow([]);
  }
  if (!stats.dancers.length) note("未添加舞者");
  sheet.eachRow((row) => {
    row.height ??= 24;
    row.eachCell((cell) => {
      cell.alignment = {
        ...cell.alignment,
        wrapText: true,
        vertical: "middle",
      };
    });
  });
  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:F${sheet.rowCount}`,
  };
}
