import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/auto-commit-push.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("自动提交脚本", () => {
  it("在 main 上提交前失败", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wota-auto-commit-"));
    temporaryDirectories.push(directory);
    execFileSync("git", ["init", "-b", "main"], {
      cwd: directory,
      stdio: "ignore",
    });
    writeFileSync(path.join(directory, "note.txt"), "change\n");

    const result = spawnSync(
      process.execPath,
      [script, "docs", "test protected branch", "note.txt"],
      { cwd: directory, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("禁止在 main 上自动提交或 push");
    expect(
      execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd: directory,
        encoding: "utf8",
      }),
    ).toBe("");
    expect(
      spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: directory,
        encoding: "utf8",
      }).status,
    ).not.toBe(0);
  });
});
