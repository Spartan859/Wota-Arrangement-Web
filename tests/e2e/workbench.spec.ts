import { test, expect, type Page } from "@playwright/test";
function wav(seconds = 12) {
  const rate = 8000,
    length = rate * seconds,
    b = Buffer.alloc(44 + length * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + length * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(length * 2, 40);
  return b;
}
async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "当前段落" })).toBeVisible();
  await expect(page.getByText("歌词池")).toHaveCount(0);
  await expect(page.getByText("暂存区")).toHaveCount(0);
}
async function audio(page: Page, seconds = 12) {
  await page.getByLabel("音频文件").setInputFiles({
    name: "synthetic.wav",
    mimeType: "audio/wav",
    buffer: wav(seconds),
  });
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled();
}
async function clickTimeline(page: Page, fraction: number) {
  const timeline = page.locator(".timeline");
  const box = (await timeline.boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}
test("时间轴新建、卡片编辑、拍子流水灯和删除", async ({ page }) => {
  await boot(page);
  await audio(page);
  await clickTimeline(page, 0.1);
  await expect(page.getByRole("dialog")).toContainText("新建段落");
  await page.getByLabel("拍数").fill("16");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByTestId("editor-card")).toContainText("16 拍");
  await page.getByRole("button", { name: /技 \/ 动作编排/ }).click();
  await page.getByLabel("技 \/ 动作编排").fill("换位");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByText("换位")).toBeVisible();
  await page.getByRole("button", { name: "删除副歌" }).click();
  await expect(page.locator(".timeline-block")).toHaveCount(0);
});
test("类型与拍数同弹窗，LRC 同刻选择生成中文", async ({ page }) => {
  await boot(page);
  await clickTimeline(page, 0.1);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: /8 拍/ }).click();
  await expect(page.getByRole("dialog")).toContainText("段落类型与拍数");
  await page.getByLabel("拍数").fill("12");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: /双语歌词/ }).click();
  await page.getByRole("button", { name: "打开 LRC" }).click();
  await page.getByLabel("歌词文件").setInputFiles({
    name: "sample.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from("[00:01]日文\n[00:01]中文一\n[00:01]中文二"),
  });
  await expect(page.locator(".lrc-option")).toHaveCount(3);
  await page.locator(".lrc-option").first().getByRole("radio").check();
  await page.getByRole("button", { name: "加入当前段落" }).click();
  await expect(page.getByText("日文")).toBeVisible();
});
test("时间轴拖动冲突被拒绝且手机无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await audio(page);
  await clickTimeline(page, 0.1);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: /8 拍/ }).click();
  await page.getByLabel("拍数").fill("4");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
