#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const [kind, message, ...files] = process.argv.slice(2);
const allowed = new Set(["feat", "fix", "docs", "chore"]);
if (!allowed.has(kind) || !message || files.length === 0) {
  console.error(
    '用法: npm run commit -- <feat|fix|docs|chore> "说明" <文件>...',
  );
  process.exit(2);
}
const run = (args, options = {}) =>
  execFileSync("git", args, { stdio: "inherit", ...options });
const output = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const branch = output(["branch", "--show-current"]);
if (branch === "main") {
  console.error("禁止在 main 上自动提交或 push；请先创建任务分支。");
  process.exit(1);
}
const status = output(["status", "--short"]);
if (!status) {
  console.error("工作区没有可提交的修改。");
  process.exit(1);
}
run(["diff", "--check", "--", ...files]);
run(["add", "--", ...files]);
const staged = output(["diff", "--cached", "--name-only"])
  .split("\n")
  .filter(Boolean);
const unexpected = staged.filter((file) => !files.includes(file));
if (unexpected.length) {
  console.error("暂存区包含未授权文件:", unexpected.join(", "));
  run(["reset", "--", ...staged]);
  process.exit(1);
}
if (!staged.length) {
  console.error("指定文件没有产生可提交的差异。");
  process.exit(1);
}
run(["commit", "-m", `${kind}: ${message}`]);
let remote = "";
try {
  remote = output(["remote", "get-url", "origin"]);
} catch {
  remote = "";
}
if (!remote) {
  console.log("已完成本地提交；未配置 origin，未执行 push。");
  process.exit(0);
}
if (!branch) {
  console.error("当前处于 detached HEAD，未执行 push。");
  process.exit(1);
}
run(["push", "origin", branch]);
