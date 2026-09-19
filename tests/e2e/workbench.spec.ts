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
  for (let i = 0; i < length; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 220) / rate) * 1000),
      44 + i * 2,
    );
  return b;
}
async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByText("编排，让每一拍有迹可循。")).toBeVisible();
}
async function addLyrics(page: Page, content = "日一\n中一\n日二\n中二") {
  await page.getByRole("button", { name: "导入歌词", exact: true }).click();
  await page.getByLabel("歌词文本").fill(content);
  await page.getByRole("button", { name: "预览配对" }).click();
  await page.getByRole("button", { name: "确认导入" }).click();
}
async function field(page: Page, name: string, value: string) {
  const locator = page.getByLabel(name, { exact: true });
  await locator.fill(value);
  await locator.press("Tab");
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
async function setProgress(page: Page, value: number) {
  await page.getByLabel("播放进度", { exact: true }).evaluate((el, value) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
test("完整编排、同步、循环、刷新恢复和双格式导出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await field(page, "歌曲名称", "合成排练");
  await addLyrics(page);
  await page.getByRole("button", { name: "收纳当前句" }).click();
  await page.getByRole("button", { name: "打包为段落" }).click();
  await expect(page.getByTestId("block-card")).toHaveCount(1);
  await page.getByRole("button", { name: "编辑段落 1 副歌" }).click();
  await field(page, "技 / 动作编排", "挥棒 → 换位");
  await audio(page);
  await field(page, "开始时间（秒）", "0");
  await field(page, "结束时间（秒）", "2");
  await field(page, "歌词起点 1（秒）", "0");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".block-card.is-playing")).toHaveCount(1);
  await expect(page.locator(".lyric-edit.is-playing")).toHaveCount(1);
  await page.getByLabel("播放速度").selectOption("1.5");
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.playbackRate),
    )
    .toBe(1.5);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await page
    .locator("audio")
    .evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(200);
  expect(
    await page
      .locator("audio")
      .evaluate((a: HTMLAudioElement) => a.currentTime),
  ).toBeCloseTo(paused, 1);
  await page.getByRole("button", { name: "循环此段" }).click();
  await expect(page.getByRole("button", { name: "退出循环" })).toBeEnabled();
  await setProgress(page, 1.8);
  await expect
    .poll(
      () =>
        page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
      { timeout: 12000 },
    )
    .toBeLessThan(1.5);
  await page.getByRole("button", { name: "退出循环" }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await setProgress(page, 3);
  await expect(page.locator(".block-card.is-playing")).toHaveCount(0);
  await expect(page.getByRole("status").first()).toContainText(
    "已保存到此浏览器",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("歌曲名称")).toHaveValue("合成排练");
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeCloseTo(3, 1);
  expect(
    await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const [json] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 JSON 备份" }).click(),
  ]);
  expect(json.suggestedFilename()).toContain(".wota.json");
  const [xlsx] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 Excel", exact: true }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toBe("合成排练_编排表.xlsx");
  expect(errors).toEqual([]);
});
test("奇数行确认、撤销重做、错误导入保留原项目", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "导入歌词", exact: true }).click();
  await page.getByLabel("歌词文本").fill("日一\n中一\n末行");
  await page.getByRole("button", { name: "预览配对" }).click();
  await expect(page.getByRole("button", { name: "确认导入" })).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "已检查未配对末行，确认补全或保留为空译文" })
    .check();
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("button", { name: "收纳 2 句" }).click();
  await page.getByRole("button", { name: "打包为段落" }).click();
  await expect(page.getByTestId("block-card")).toHaveCount(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByTestId("block-card")).toHaveCount(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.getByTestId("block-card")).toHaveCount(1);
  await page.getByLabel("打开项目文件").setInputFiles({
    name: "broken.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("bad"),
  });
  await expect(page.getByRole("alert")).toContainText("导入失败");
  await expect(page.getByTestId("block-card")).toHaveCount(1);
});
test("时间重叠被拒绝，短音频替换使越界段落不可定位", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "＋ 添加纯动作段落" }).click();
  await audio(page);
  await field(page, "开始时间（秒）", "0");
  await field(page, "结束时间（秒）", "10");
  await page.getByRole("button", { name: "空段落", exact: true }).click();
  await field(page, "开始时间（秒）", "5");
  await field(page, "结束时间（秒）", "11");
  await expect(page.getByRole("alert")).toContainText("重叠");
  await expect(page.getByLabel("结束时间（秒）")).toHaveValue("");
  await page.getByRole("button", { name: "编辑段落 1 副歌" }).click();
  await audio(page, 3);
  await expect(page.getByRole("button", { name: "定位此段" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "循环此段" })).toBeDisabled();
});
test("手机布局无页面横向溢出且可编排", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.getByRole("button", { name: "歌词", exact: true }).click();
  await addLyrics(page);
  await page.getByRole("button", { name: "收纳当前句" }).click();
  await page.getByRole("button", { name: "打包为段落" }).click();
  await expect(page.getByTestId("block-card")).toBeVisible();
  await page.getByRole("button", { name: "编辑段落 1 副歌" }).click();
  await expect(page.getByLabel("技 / 动作编排")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("多标签页冲突阻止覆盖并允许另存副本", async ({ page, context }) => {
  await boot(page);
  await field(page, "歌曲名称", "原项目");
  await expect(page.getByRole("status").first()).toContainText(
    "已保存到此浏览器",
  );
  const second = await context.newPage();
  await boot(second);
  await field(page, "歌曲名称", "第一标签更新");
  await expect(page.getByRole("status").first()).toContainText(
    "已保存到此浏览器",
  );
  await field(second, "歌曲名称", "第二标签更新");
  await expect(
    second.getByText("此项目已在另一标签页更新。编辑已暂停，避免覆盖。"),
  ).toBeVisible();
  await expect(second.getByLabel("歌曲名称")).toBeDisabled();
  await second.getByRole("button", { name: "保留为副本", exact: true }).click();
  await expect(second.getByLabel("歌曲名称")).toHaveValue(
    "第二标签更新（副本）",
  );
  await page.reload();
  await expect(page.getByLabel("歌曲名称")).toHaveValue("第一标签更新");
});
test("LRC 双语时间保留、整体偏移、JSON 导入重新关联歌曲", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "导入歌词", exact: true }).click();
  await page.getByLabel("歌词文件").setInputFiles({
    name: "synthetic.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from("[offset:200]\n[00:01]光\n[00:01]光芒\n[00:03]進め"),
  });
  await expect(page.getByLabel("第1行时间")).toHaveValue("1.2");
  await expect(page.getByLabel("第1行中文")).toHaveValue("光芒");
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await page.getByRole("button", { name: "收纳 2 句" }).click();
  await page.getByRole("button", { name: "打包为段落" }).click();
  await page.getByRole("button", { name: "编辑段落 1 副歌" }).click();
  await expect(page.getByLabel("歌词起点 1（秒）")).toHaveValue("1.2");
  await page.getByRole("button", { name: "歌词时间偏移", exact: true }).click();
  await page.getByLabel("整体偏移秒数").fill("0.5");
  await page.getByRole("button", { name: "确认应用偏移" }).click();
  await expect(page.getByLabel("歌词起点 1（秒）")).toHaveValue("1.7");
  await audio(page);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 JSON 备份" }).click(),
  ]);
  const path = await download.path();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByLabel("打开项目文件").setInputFiles(path!);
  await expect(
    page.getByText("项目时间标记已导入，请重新选择本地歌曲。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "编辑段落 1 副歌" }).click();
  await expect(page.getByLabel("歌词起点 1（秒）")).toHaveValue("1.7");
});
test("存储失败保留内存编辑并可下载备份", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "projects")
        throw new DOMException("synthetic quota failure", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await boot(page);
  await field(page, "歌曲名称", "未丢失的编排");
  await page.getByRole("button", { name: "＋ 添加纯动作段落" }).click();
  await expect(page.getByRole("status").first()).toContainText("本地保存失败");
  await expect(page.getByTestId("block-card")).toHaveCount(1);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 JSON 备份" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("未丢失的编排.wota.json");
});
test("项目切换停止播放且互不覆盖播放位置", async ({ page }) => {
  await boot(page);
  await field(page, "歌曲名称", "第一首");
  await audio(page);
  await setProgress(page, 4);
  await expect(page.getByRole("status").first()).toContainText(
    "已保存到此浏览器",
  );
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByLabel("歌曲名称")).toHaveValue("未命名歌曲");
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await field(page, "歌曲名称", "第二首");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: /第一首/ }).click();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeCloseTo(4, 1);
  expect(
    await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(true);
});
