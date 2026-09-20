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

async function timedProject(page: Page) {
  await boot(page);
  await page.getByLabel("打开项目文件").setInputFiles({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        id: "fixture",
        songName: "合成对时",
        bpm: "120",
        audio: null,
        position: 0,
        updatedAt: 1,
        blocks: [
          { id: "a", type: "前奏", start: 0, end: 3 },
          { id: "b", type: "副歌", start: 5, end: 9 },
        ].map((b) => ({
          ...b,
          beats: "8",
          arrangement: b.type,
          remarks: "",
          lyrics: [{ id: `lyric-${b.id}`, jp: "合成", cn: "", time: null }],
        })),
      }),
    ),
  });
  await expect(page.getByLabel("歌曲名称")).toHaveValue("合成对时");
  await audio(page);
}
async function position(page: Page, time: number) {
  await page.getByLabel("播放进度", { exact: true }).fill(String(time));
}
test("直接记录 AB，拒绝反向区间，循环和替换音频清除", async ({ page }) => {
  await boot(page);
  await expect(
    page.getByRole("button", { name: "选 A", exact: true }),
  ).toBeDisabled();
  await audio(page);
  await position(page, 2);
  await page.getByRole("button", { name: "选 A", exact: true }).click();
  await position(page, 1);
  await page.getByRole("button", { name: "选 B", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("B 出点必须晚于 A 入点");
  await expect(
    page.getByRole("button", { name: "开始 A/B 循环" }),
  ).toBeDisabled();
  await position(page, 4);
  await page.getByRole("button", { name: "选 B", exact: true }).click();
  await page.getByRole("button", { name: "开始 A/B 循环" }).click();
  await position(page, 3.95);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeLessThan(3);
  await page.getByRole("button", { name: "退出 A/B 循环" }).click();
  await expect(
    page.getByRole("button", { name: "开始 A/B 循环" }),
  ).toBeEnabled();
  await expect(page.locator(".ab-picker")).toHaveCount(0);
  await audio(page, 10);
  await expect(page.locator(".ab-marker")).toHaveCount(0);
});
test("播放覆盖手动选择，关闭跟随后保持选中段落", async ({ page }) => {
  await timedProject(page);
  await page.locator(".timeline-block").nth(1).click();
  await position(page, 1);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(page.getByTestId("editor-card").getByRole("heading")).toHaveText(
    "前奏",
  );
  await position(page, 6);
  await expect(page.getByTestId("editor-card").getByRole("heading")).toHaveText(
    "副歌",
  );
  await page.getByRole("checkbox", { name: "跟随播放" }).uncheck();
  await position(page, 1);
  await expect(page.getByTestId("editor-card").getByRole("heading")).toHaveText(
    "副歌",
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
});
test("快捷键打点、输入保护和相邻边界拖动", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await timedProject(page);
  await page.locator(".timeline-block").nth(1).click();
  await expect(page.getByLabel("入点（秒）")).toHaveCount(0);
  await expect(page.locator(".ab-controls .primary")).toHaveCount(2);
  await position(page, 6);
  await page.locator(".timeline-block").nth(1).focus();
  await page.keyboard.press("[");
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:06.00/,
  );
  await position(page, 10);
  await page.locator(".timeline-block").nth(1).focus();
  await page.keyboard.press("]");
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:10.00/,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await position(page, 2);
  await page.locator(".timeline-block").nth(1).focus();
  await page.keyboard.press("a");
  await position(page, 4);
  await page.locator(".timeline-block").nth(1).focus();
  await page.keyboard.press("b");
  await expect(page.locator(".ab-status")).toContainText(
    "A 00:02.00 · B 00:04.00",
  );
  await page.getByLabel("歌曲名称").focus();
  await page.keyboard.press("a");
  await page.keyboard.press("[");
  await expect(page.locator(".ab-status")).toContainText("A 00:02.00");
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:05.00/,
  );
  await page.getByLabel("时间轴缩放").fill("2");
  const first = page.locator(".timeline-block").first();
  const width = (await page.locator(".timeline").boundingBox())!.width;
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width - 2 + width / 3,
    box.y + box.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(first).toHaveAttribute("title", /00:05.00/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const second = page.locator(".timeline-block").nth(1);
  const nextBox = (await second.boundingBox())!;
  await page.mouse.move(nextBox.x + 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    nextBox.x + 2 - width / 3,
    nextBox.y + nextBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(second).toHaveAttribute("title", /00:03.00/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("仅轨道空白可新建，刻度、片段和循环标记不触发", async ({ page }) => {
  await timedProject(page);
  const timeline = page.locator(".timeline");
  let box = (await timeline.boundingBox())!;
  // Empty ruler above an occupied interval, and space below the clip lane.
  await page.mouse.click(box.x + box.width / 12, box.y + 10);
  await page.mouse.click(box.x + box.width / 3, box.y + box.height - 2);
  await page.locator(".timeline-block").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await position(page, 4);
  await page.getByRole("button", { name: "选 A", exact: true }).click();
  await page.locator(".ab-marker b").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await position(page, 10);
  await page.getByLabel("时间轴缩放").fill("2");
  await page.locator(".timeline-scroll").evaluate((el) => {
    el.scrollLeft = 100;
  });
  box = (await timeline.boundingBox())!;
  await page.mouse.click(box.x + (box.width * 4.5) / 12, box.y + 34);
  await expect(page.getByRole("dialog")).toContainText("新建段落");
  await expect(page.getByRole("dialog")).toContainText("00:04.50");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  // Clicking an occupied interval must still only select its clip.
  await page.locator(".timeline-block").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
