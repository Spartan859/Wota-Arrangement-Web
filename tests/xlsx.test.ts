import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { block, headers, lyric, project, pureText } from "../src/core/model";
import { readXlsx, writeXlsx } from "../src/core/xlsx";
describe("Excel 标准模板兼容", () => {
  it("合并类型但保留各块边界，内容往返保真，时间不写入表格", async () => {
    const p = project();
    p.songName = "合成测试";
    p.blocks = [block("r", "8"), block("r", "4"), block("o", "2", true)];
    p.blocks[0].lyrics = [lyric("日一", "中一", 1), lyric("日二", "中二", 2)];
    p.blocks[0].arrangement = "动作\n换位";
    p.blocks[0].remarks = "备注";
    p.blocks[0].start = 1;
    p.blocks[0].end = 5;
    p.blocks[1].lyrics = [lyric("日三", "中三")];
    const bytes = await writeXlsx(p);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    expect(ws.model.merges).toContain("A3:A5");
    expect(ws.model.merges).toContain("B3:B4");
    expect(ws.getCell("C3").value).toBe("日一");
    expect(ws.getCell("E3").value).toBe("动作\n换位");
    expect(ws.getCell("A1").value).toBe("合成测试 (BPM: 120)");
    const result = await readXlsx(bytes);
    expect(result.blocks).toHaveLength(3);
    expect(
      result.blocks.map((b) => [b.type, b.beats, b.lyrics.length]),
    ).toEqual([
      ["副歌", "8", 2],
      ["副歌", "4", 1],
      ["尾奏", "2", 1],
    ]);
    expect(result.blocks[0].arrangement).toBe(p.blocks[0].arrangement);
    expect(result.blocks[0].start).toBeNull();
    expect(result.blocks[0].lyrics[0].time).toBeNull();
    expect(result.blocks[2].lyrics[0].jp).toBe(pureText);
  });
  it("拒绝损坏文件、非标准表头、缺少段落和空导出", async () => {
    await expect(readXlsx(new ArrayBuffer(4))).rejects.toThrow();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("bad");
    ws.addRow(["wrong"]);
    await expect(
      readXlsx(new Uint8Array(await wb.xlsx.writeBuffer()).buffer),
    ).rejects.toThrow("表头");
    ws.getRow(2).values = headers;
    ws.getRow(3).values = ["", "8", "歌词"];
    await expect(
      readXlsx(new Uint8Array(await wb.xlsx.writeBuffer()).buffer),
    ).rejects.toThrow("缺少段落");
    await expect(writeXlsx(project())).rejects.toThrow();
  });
  it("纯文本等号不变成公式", async () => {
    const p = project();
    const b = block("r", "8");
    b.lyrics = [lyric("=1+1", "测试")];
    p.blocks = [b];
    const bytes = await writeXlsx(p);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    expect(wb.worksheets[0].getCell("C3").type).toBe(ExcelJS.ValueType.String);
  });
});
it("保留空歌词块及合并块内空行，与纯动作块区分", async () => {
  const p = project();
  const blank = block("a", "2");
  const mixed = block("b", "4");
  mixed.lyrics = [lyric("日一", "中一"), lyric(), lyric("日二", "中二")];
  p.blocks = [blank, mixed, block("o", "2", true)];
  const result = await readXlsx(await writeXlsx(p));
  expect(result.blocks[0].lyrics[0].jp).toBe("");
  expect(result.blocks[1].lyrics.map((l) => l.jp)).toEqual([
    "日一",
    "",
    "日二",
  ]);
  expect(result.blocks[2].lyrics[0].jp).toBe(pureText);
});
