import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readXlsx, writeXlsx } from "../src/core/xlsx";
const source = process.env.WOTA_CLI_PATH;
test.skipIf(!source)(
  "原 Python 导出 → Web → 原 Python，数据与合并范围一致",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "wota-compat-"));
    try {
      const original = join(dir, "python.xlsx"),
        exported = join(dir, "web.xlsx");
      const run = (command: string, path: string) =>
        execFileSync(
          process.env.PYTHON || "python3",
          ["scripts/python_compat.py", source!, command, path],
          { encoding: "utf8" },
        );
      run("generate", original);
      const input = readFileSync(original);
      const p = await readXlsx(
        input.buffer.slice(
          input.byteOffset,
          input.byteOffset + input.byteLength,
        ),
      );
      expect(p.blocks).toHaveLength(3);
      expect(p.blocks.map((b) => b.lyrics.length)).toEqual([2, 1, 1]);
      // Statistics are appended to a separate trailing sheet; the original CLI
      // must still read exactly the original arrangement and merge structure.
      const { emptyChoreography, addDancer, changePose } =
        await import("../src/core/choreography");
      p.choreography = emptyChoreography();
      const dancer = addDancer(p.choreography, "合成舞者", 0);
      changePose(p.choreography, dancer, 2, { left: "极蓝" });
      changePose(p.choreography, dancer, 3, { left: "极橙" });
      writeFileSync(exported, new Uint8Array(await writeXlsx(p)));
      expect(JSON.parse(run("read", exported))).toEqual(
        JSON.parse(run("read", original)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
