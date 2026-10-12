import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { block, lyric, project } from "../src/core/model";
import { writeXlsx } from "../src/core/xlsx";
const source = process.env.WOTA_CLI_PATH;
test.skipIf(!source)("Web 导出 → 原 Python，数据与合并范围一致", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wota-compat-"));
  try {
    const exported = join(dir, "web.xlsx");
    const run = (path: string) =>
      execFileSync(
        process.env.PYTHON || "python3",
        ["scripts/python_compat.py", source!, path],
        { encoding: "utf8" },
      );
    const p = project();
    p.songName = "Synthetic compatibility";
    p.bpm = "128";
    p.blocks = [
      block("副歌", "8"),
      block("副歌", "4"),
      block("尾奏", "2", true),
    ];
    p.blocks[0].lyrics = [lyric("日文一", "中文一"), lyric("日文二", "中文二")];
    p.blocks[0].arrangement = "动作一\n动作二";
    p.blocks[0].remarks = "合成备注";
    p.blocks[1].lyrics = [lyric("日文三", "中文三")];
    p.blocks[1].arrangement = "动作三";
    p.blocks[2].remarks = "结束";
    const { emptyChoreography, addDancer, changePose } =
      await import("../src/core/choreography");
    p.choreography = emptyChoreography();
    const dancer = addDancer(p.choreography, "合成舞者", 0);
    changePose(p.choreography, dancer, 2, { left: "极蓝" });
    changePose(p.choreography, dancer, 3, { left: "极橙" });
    writeFileSync(exported, new Uint8Array(await writeXlsx(p)));
    const actual = JSON.parse(run(exported));
    expect(actual.song).toBe(p.songName);
    expect(actual.bpm).toBe(p.bpm);
    expect(actual.blocks).toHaveLength(3);
    expect(
      actual.blocks.map((b: { lyrics: unknown[] }) => b.lyrics.length),
    ).toEqual([2, 1, 1]);
    expect(actual.merges).toContain("A3:A5");
    expect(actual.merges).toContain("B3:B4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
