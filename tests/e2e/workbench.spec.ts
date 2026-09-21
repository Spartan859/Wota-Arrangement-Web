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
  await page.getByLabel("拍数", { exact: true }).fill("16");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByTestId("editor-card")).toContainText("16 拍");
  await page.getByRole("button", { name: /技 \/ 动作编排/ }).click();
  await page.getByLabel("技 \/ 动作编排").fill("换位");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByTestId("editor-card").getByText("换位")).toBeVisible();
  await page.getByRole("button", { name: "删除副歌", exact: true }).click();
  await expect(page.locator(".timeline-block")).toHaveCount(0);
});
test("类型与拍数同弹窗，LRC 同刻选择生成中文", async ({ page }) => {
  await boot(page);
  await clickTimeline(page, 0.1);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: "编辑类型与拍数" }).click();
  await expect(page.getByRole("dialog")).toContainText("段落类型与拍数");
  await page.getByLabel("拍数", { exact: true }).fill("12");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: /双语歌词/ }).click();
  await page.getByRole("button", { name: "打开 LRC" }).click();
  await page.getByLabel("歌词文件").setInputFiles({
    name: "sample.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from("[00:01]日文\n[00:01]中文一\n[00:01]中文二"),
  });
  await expect(page.locator(".lrc-option")).toHaveCount(3);
  await page.locator(".lrc-option").first().getByRole("checkbox").check();
  await page.getByRole("button", { name: "加入当前段落" }).click();
  await expect(page.getByText("日文")).toBeVisible();
});
test("时间轴拖动冲突被拒绝且手机无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await audio(page);
  await clickTimeline(page, 0.1);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: "编辑类型与拍数" }).click();
  await page.getByLabel("拍数", { exact: true }).fill("4");
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
async function multiTimedProject(page: Page) {
  await boot(page);
  await page.getByLabel("打开项目文件").setInputFiles({
    name: "multi-synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        id: "multi-fixture",
        songName: "多选对时",
        bpm: "120",
        audio: null,
        position: 0,
        updatedAt: 1,
        blocks: [
          ["a", "前奏", 0, 2],
          ["b", "主歌", 3, 5],
          ["c", "副歌", 7, 9],
          ["d", "尾奏", 10, 12],
        ].map(([id, type, start, end]) => ({
          id,
          type,
          start,
          end,
          beats: "8",
          arrangement: type,
          remarks: "",
          lyrics: [{ id: `lyric-${id}`, jp: "合成", cn: "", time: null }],
        })),
      }),
    ),
  });
  await expect(page.getByLabel("歌曲名称")).toHaveValue("多选对时");
  await audio(page);
}
async function position(page: Page, time: number) {
  await page.getByLabel("播放进度", { exact: true }).fill(String(time));
}

test("时间轴修饰键选择、范围选择和单选回退", async ({ page }) => {
  await multiTimedProject(page);
  const blocks = page.locator(".timeline-block");
  await blocks.first().click();
  await blocks.nth(3).click({ modifiers: ["Shift"] });
  await expect(page.locator(".timeline-block.selected")).toHaveCount(4);
  await expect(blocks.nth(3)).toHaveClass(/primary-selected/);
  await expect(page.locator(".timeline-selection-count")).toHaveText(
    "已选 4 段",
  );
  const selectionStyles = await blocks.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        boxShadow: style.boxShadow,
        outlineWidth: style.outlineWidth,
      };
    }),
  );
  expect(selectionStyles[0].boxShadow).toContain("rgb(69, 104, 212)");
  expect(selectionStyles[3].boxShadow).toContain("rgb(69, 104, 212)");
  expect(selectionStyles[3].outlineWidth).toBe("3px");
  expect(selectionStyles[0].boxShadow).not.toBe(selectionStyles[3].boxShadow);
  await blocks.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".timeline-block.selected")).toHaveCount(3);
  await blocks.nth(2).click();
  await expect(page.locator(".timeline-block.selected")).toHaveCount(1);
  await expect(blocks.nth(2)).toHaveClass(/primary-selected/);
});

test("多选段落整体拖动保持间距、限位并一次撤销", async ({ page }) => {
  await multiTimedProject(page);
  const blocks = page.locator(".timeline-block");
  await blocks.first().click();
  await blocks.nth(1).click({ modifiers: ["ControlOrMeta"] });
  const timeline = page.locator(".timeline");
  const timelineBox = (await timeline.boundingBox())!;
  const second = (await blocks.nth(1).boundingBox())!;
  await page.mouse.move(
    second.x + second.width / 2,
    second.y + second.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    second.x + second.width / 2 + timelineBox.width / 12,
    second.y + second.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(blocks.nth(0)).toHaveAttribute("title", /00:01.00 — 00:03.00/);
  await expect(blocks.nth(1)).toHaveAttribute("title", /00:04.00 — 00:06.00/);
  await expect(blocks.nth(2)).toHaveAttribute("title", /00:07.00 — 00:09.00/);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(blocks.nth(0)).toHaveAttribute("title", /00:00.00 — 00:02.00/);
  await expect(blocks.nth(1)).toHaveAttribute("title", /00:03.00 — 00:05.00/);
});

test("多选时边缘只调整当前段落，Delete 批量删除，触屏多选可用", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await multiTimedProject(page);
  const blocks = page.locator(".timeline-block");
  await page.getByRole("button", { name: "多选模式" }).click();
  await expect(page.getByRole("button", { name: "多选模式" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await blocks.nth(0).click();
  await blocks.nth(1).click();
  await expect(page.locator(".timeline-block.selected")).toHaveCount(2);

  const firstTitle = await blocks.nth(0).getAttribute("title");
  const timelineBox = (await page.locator(".timeline").boundingBox())!;
  const second = (await blocks.nth(1).boundingBox())!;
  await page.mouse.move(second.x + 2, second.y + second.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    second.x + 2 - timelineBox.width / 12,
    second.y + second.height / 2,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await expect(blocks.nth(0)).toHaveAttribute("title", firstTitle!);
  await expect(blocks.nth(1)).toHaveAttribute("title", /00:02.00 — 00:05.00/);

  await blocks.nth(0).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".timeline-block")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".timeline-block")).toHaveCount(4);
  await blocks.nth(0).locator(".timeline-delete").click();
  await expect(page.locator(".timeline-block")).toHaveCount(3);
});
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
  await expect(page.locator(".ab-controls .primary")).toHaveCount(3);
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
  await position(page, 6);
  await page.getByRole("button", { name: "选 B", exact: true }).click();
  await page.locator(".timeline-block").nth(1).click();
  await expect(page.locator(".ab-marker").nth(1)).toHaveCSS("z-index", "7");
  await expect(page.locator(".ab-region")).toHaveCSS("z-index", "6");
  await expect(page.locator(".timeline-block").nth(1)).toHaveCSS(
    "z-index",
    "5",
  );
  await page.getByTestId("playhead").locator(".playhead-time").click();
  await page.locator(".ab-marker b").last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await position(page, 10);
  await page.getByLabel("时间轴缩放").fill("2");
  await page.locator(".timeline-scroll").evaluate((el) => {
    el.scrollLeft = 100;
  });
  box = (await timeline.boundingBox())!;
  await page.mouse.click(box.x + (box.width * 4.5) / 12, box.y + 50);
  await expect(page.getByRole("dialog")).toContainText("新建段落");
  await expect(page.getByRole("dialog")).toContainText("起点 00:03.00");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  // Clicking an occupied interval must still only select its clip.
  await page.locator(".timeline-block").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("浮动提示不挤占工作区，按拍数设出点及循环快捷键", async ({ page }) => {
  await timedProject(page);
  await page.locator(".timeline-block").nth(1).click();
  await expect(page.locator(".timeline-arrangement").nth(1)).toHaveText("副歌");
  await expect(page.locator(".timeline-arrangement").nth(1)).toHaveCSS(
    "text-overflow",
    "ellipsis",
  );
  const heading = await page.locator(".block-title-row h2").boundingBox();
  const beats = await page.locator(".block-beat-count").boundingBox();
  expect(Math.abs(heading!.y - beats!.y)).toBeLessThan(4);
  await page.getByRole("button", { name: "编辑类型与拍数" }).click();
  await page.getByLabel("拍数", { exact: true }).fill("6");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: /按拍数设出点/ }).click();
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:08.00/,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.locator(".timeline-block").nth(1).focus();
  await page.keyboard.press("e");
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:08.00/,
  );
  // First interval would end at 8 and overlap the second interval.
  await page.locator(".timeline-block").first().click();
  await page.getByRole("button", { name: "编辑类型与拍数" }).click();
  await page.getByLabel("拍数", { exact: true }).fill("16");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  const before = (await page.locator(".workbench").boundingBox())!;
  await page.getByRole("button", { name: /按拍数设出点/ }).click();
  await expect(page.getByRole("alert")).toContainText("重叠");
  await expect(page.getByRole("alert")).toHaveCSS("position", "fixed");
  const after = (await page.locator(".workbench").boundingBox())!;
  expect(after.y).toBe(before.y);
  expect(after.height).toBe(before.height);
  await expect(page.locator(".timeline-block").first()).toHaveAttribute(
    "title",
    /00:03.00/,
  );
  await position(page, 1);
  await page.getByRole("button", { name: "选 A", exact: true }).click();
  await position(page, 2);
  await page.getByRole("button", { name: "选 B", exact: true }).click();
  await page.keyboard.press("l");
  await expect(
    page.getByRole("button", { name: "退出 A/B 循环", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("l");
  await expect(
    page.getByRole("button", { name: "开始 A/B 循环", exact: true }),
  ).toBeEnabled();
});

test("LRC 原文与偏移保存、再次选词及左右多行编辑", async ({ page }) => {
  await timedProject(page);
  await page.locator(".timeline-block").nth(1).click();
  await expect(
    page.locator(".topbar").getByRole("button", { name: "撤销", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(".editor-panel .panel-heading").getByText("歌词偏移"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /双语歌词/ }).click();
  await expect(page.getByRole("dialog").locator("textarea")).toHaveCount(2);
  await page.getByLabel("日文歌词", { exact: true }).fill("第一句\n第二句");
  await page.getByLabel("中文歌词", { exact: true }).fill("译文一\n译文二");
  await page.getByRole("button", { name: "打开 LRC", exact: true }).click();
  await page.getByLabel("歌词文件").setInputFiles({
    name: "remember.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from("[00:05]日本語\n[00:05]翻译"),
  });
  await page.getByLabel("歌词偏移秒数").fill("1.5");
  await page.getByLabel("歌词偏移秒数").press("Tab");
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.locator(".topbar")).toContainText("编辑歌词");
  await expect(page.locator(".topbar")).toContainText("偏移 1.5s");
  await page.getByRole("button", { name: /双语歌词/ }).click();
  await expect(page.getByLabel("日文歌词", { exact: true })).toHaveValue(
    "第一句\n第二句",
  );
  await page.getByRole("button", { name: "打开 LRC", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("选择 LRC 歌词");
  await expect(page.locator(".lrc-picker header")).toHaveText("00:06.50");
  await page.locator(".lrc-option").first().getByRole("checkbox").check();
  await expect(
    page.locator(".lrc-option").nth(1).getByRole("checkbox"),
  ).toBeDisabled();
  await page.getByRole("button", { name: "加入当前段落" }).click();
  await expect(page.locator(".save-state")).toContainText("已保存");
  await page.reload();
  await expect(page.locator(".topbar")).toContainText("编辑歌词");
  await expect(page.locator(".topbar")).toContainText("偏移 1.5s");
  await page
    .locator(".topbar")
    .getByRole("button", { name: "编辑歌词" })
    .click();
  await expect(page.getByLabel("歌词文本")).toHaveValue(
    "[00:05]日本語\n[00:05]翻译",
  );
  await page.getByLabel("歌词文本").fill("[ti:invalid]");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "预览", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "没有找到歌词",
  );
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(page.locator(".topbar")).toContainText("编辑歌词");
});

test("播放头逐帧跟随音频且暂停定位不漂移", async ({ page }) => {
  await boot(page);
  await audio(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  const samples = await page.evaluate(async () => {
    const head = document.querySelector<HTMLElement>(".playhead")!;
    const audio = document.querySelector<HTMLAudioElement>("audio")!;
    const rows: { position: number; actual: number }[] = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(requestAnimationFrame);
      rows.push({
        position: (parseFloat(head.style.left) / 100) * audio.duration,
        actual: audio.currentTime,
      });
    }
    return rows;
  });
  // Headless Chrome may expose audio.currentTime at a lower cadence than rAF.
  expect(new Set(samples.map((s) => s.position)).size).toBeGreaterThan(10);
  expect(
    Math.max(...samples.map((s) => Math.abs(s.actual - s.position))),
  ).toBeLessThan(0.1);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await position(page, 8);
  await expect
    .poll(() =>
      page
        .locator(".playhead")
        .evaluate((el) => parseFloat((el as HTMLElement).style.left)),
    )
    .toBeCloseTo((100 * 8) / 12, 2);
  const paused = await page.locator(".playhead").getAttribute("style");
  await page.waitForTimeout(200);
  expect(await page.locator(".playhead").getAttribute("style")).toBe(paused);
});

test("空隙新建生成完整区间且刷新后仍位于原位置", async ({ page }) => {
  await timedProject(page);
  const box = (await page.locator(".timeline-gap-target").boundingBox())!;
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 2);
  await expect(page.getByRole("dialog")).toContainText("起点 00:03.00");
  await expect(page.getByRole("dialog")).toContainText("出点 00:05.00");
  await expect(page.getByRole("dialog")).toContainText("空隙不足");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".timeline-block")).toHaveCount(3);
  await expect(page.locator(".untimed-strip")).toHaveCount(0);
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:03.00 — 00:05.00/,
  );
  await expect(page.locator(".save-state")).toContainText("已保存");
  await page.reload();
  await expect(page.locator(".timeline-block").nth(1)).toHaveAttribute(
    "title",
    /00:03.00 — 00:05.00/,
  );
});

test("编辑卡片随可用高度压缩，无需滚动查看对时按钮", async ({ page }) => {
  await page.setViewportSize({ width: 922, height: 880 });
  await timedProject(page);
  await page.locator(".timeline-block").first().click();
  await page.getByRole("button", { name: "编辑类型与拍数" }).click();
  await page.getByLabel("拍数", { exact: true }).fill("32");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  for (const viewport of [
    { width: 922, height: 880 },
    { width: 1282, height: 720 },
    { width: 922, height: 720 },
  ]) {
    await page.setViewportSize(viewport);

    await expect
      .poll(() =>
        page
          .locator(".editor-card")
          .evaluate((el) => el.scrollHeight - el.clientHeight),
      )
      .toBeLessThanOrEqual(1);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - innerWidth,
      y: document.documentElement.scrollHeight - innerHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(1);
    expect(overflow.y).toBeLessThanOrEqual(1);
    await expect(page.locator(".editor-time-row")).toBeInViewport();
  }
});

test("缩放时间轴跟随播放分页，暂停后不强制滚动", async ({ page }) => {
  await boot(page);
  await audio(page, 12);
  await page.getByLabel("时间轴缩放").fill("8");
  const scroll = page.locator(".timeline-scroll");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(20);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.getByLabel("播放进度", { exact: true }).fill("10.5");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await scroll.evaluate((el) => el.scrollLeft);
  await page.getByLabel("播放进度", { exact: true }).fill("2");
  await page.waitForTimeout(200);
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(paused);
  await page.getByRole("checkbox", { name: "跟随播放" }).uncheck();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.getByLabel("播放进度", { exact: true }).fill("11");
  await page.waitForTimeout(200);
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(paused);
});

test("跟随播放读取最新缩放和开关状态", async ({ page }) => {
  await boot(page);
  await audio(page, 12);
  const scroll = page.locator(".timeline-scroll");
  await page.getByLabel("时间轴缩放").fill("8");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(20);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.getByLabel("播放进度", { exact: true }).fill("10");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "跟随播放" }).uncheck();
  const stopped = await scroll.evaluate((el) => el.scrollLeft);
  await page.getByLabel("播放进度", { exact: true }).fill("2");
  await page.waitForTimeout(200);
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(stopped);
  await page.getByRole("checkbox", { name: "跟随播放" }).check();
  await page.getByLabel("播放进度", { exact: true }).fill("11");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(stopped);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
});

test("段落拖动失焦或取消后停止，无按键移动不继续拖动", async ({ page }) => {
  await timedProject(page);
  const clip = page.locator(".timeline-block").first();
  const original = await clip.getAttribute("title");
  for (const reason of ["blur", "pointercancel"]) {
    const box = (await clip.boundingBox())!;
    await clip.evaluate((el) =>
      el.addEventListener("pointerdown", (e) => {
        (el as HTMLElement).dataset.pointerId = String(
          (e as PointerEvent).pointerId,
        );
      }),
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, {
      steps: 4,
    });
    await expect(clip).not.toHaveAttribute("title", original!);
    await clip.evaluate((el, reason) => {
      const id = Number((el as HTMLElement).dataset.pointerId);
      if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else
        window.dispatchEvent(
          new PointerEvent("pointercancel", { pointerId: id }),
        );
    }, reason);
    await expect(clip).toHaveAttribute("title", original!);
    await page.mouse.up();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
    await expect(clip).toHaveAttribute("title", original!);
  }
  const box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, {
    steps: 3,
  });
  const preview = await clip.getAttribute("title");
  await clip.evaluate((el) =>
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: Number((el as HTMLElement).dataset.pointerId),
        buttons: 0,
        clientX: 900,
        clientY: 500,
      }),
    ),
  );
  await expect(clip).toHaveAttribute("title", preview!);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2);
  await expect(clip).toHaveAttribute("title", preview!);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(clip).toHaveAttribute("title", original!);
});

for (const releaseCapture of [false, true]) {
  test(`段落拖到前块限位后在前块上松手保留位置${releaseCapture ? "（捕获提前丢失）" : ""}`, async ({
    page,
  }) => {
    await timedProject(page);
    const previous = page.locator(".timeline-block").first();
    const clip = page.locator(".timeline-block").nth(1);
    await clip.evaluate((el) =>
      el.addEventListener(
        "pointerdown",
        (e) => {
          (el as HTMLElement).dataset.pointerId = String(
            (e as PointerEvent).pointerId,
          );
        },
        { once: true },
      ),
    );
    const from = (await clip.boundingBox())!,
      to = (await previous.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 10,
    });
    await expect(clip).toHaveAttribute("title", /00:03.00 — 00:07.00/);
    if (releaseCapture)
      await clip.evaluate((el) =>
        el.releasePointerCapture(Number((el as HTMLElement).dataset.pointerId)),
      );
    await page.mouse.up();
    await expect(clip).toHaveAttribute("title", /00:03.00 — 00:07.00/);
    await page.mouse.move(to.x + 10, to.y + 10);
    await expect(clip).toHaveAttribute("title", /00:03.00 — 00:07.00/);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(clip).toHaveAttribute("title", /00:05.00 — 00:09.00/);
  });
}

test("播放头标签及竖线拖动定位，缩放滚动后坐标准确且不改编排", async ({
  page,
}) => {
  await timedProject(page);
  const head = page.getByRole("slider", { name: "时间轴播放头", exact: true });
  const titles = await page
    .locator(".timeline-block")
    .evaluateAll((els) => els.map((el) => el.getAttribute("title")));
  await page.getByLabel("时间轴缩放").fill("2");
  await position(page, 8);
  await page.locator(".timeline-scroll").evaluate((el) => {
    el.scrollLeft = el.scrollWidth / 2;
  });
  const width = (await page.locator(".timeline").boundingBox())!.width;
  const box = (await head.locator(".playhead-time").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + width / 12,
    box.y + box.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeCloseTo(9, 1);
  await page.mouse.move(20, 20);
  await expect(head).toHaveAttribute("aria-valuenow", /^(8\.99|9)/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page
      .locator(".timeline-block")
      .evaluateAll((els) => els.map((el) => el.getAttribute("title"))),
  ).toEqual(titles);
  // Drag the vertical line as well, staying outside the keyframe track.
  const line = (await head.boundingBox())!;
  await page.mouse.move(line.x + 1, line.y + 20);
  await page.mouse.down();
  await page.mouse.move(line.x + 1 - width / 12, line.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeCloseTo(8, 1);
});
test("拖动播放头暂停、限制歌曲边界、不产生撤销；失焦后结束拖动", async ({
  page,
}) => {
  await boot(page);
  const head = page.getByRole("slider", { name: "时间轴播放头", exact: true });
  await expect(head).toHaveAttribute("aria-disabled", "true");
  await audio(page, 12);
  await position(page, 5);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  let label = (await head.locator(".playhead-time").boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.down();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
  await page.mouse.move(0, label.y + label.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBe(0);
  label = (await head.locator(".playhead-time").boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(1279, label.y + label.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBe(12);
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
  await position(page, 4);
  label = (await head.locator(".playhead-time").boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    label.x + label.width / 2 + 50,
    label.y + label.height / 2,
    { steps: 3 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const stopped = await page
    .locator("audio")
    .evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.mouse.up();
  await page.mouse.move(900, 500);
  expect(
    await page
      .locator("audio")
      .evaluate((a: HTMLAudioElement) => a.currentTime),
  ).toBe(stopped);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("空格播放暂停，不重复触发按钮且输入弹窗不响应", async ({ page }) => {
  await boot(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await audio(page);
  const paused = () =>
    page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused);
  await page.getByRole("button", { name: "播放", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await page.keyboard.down("Space");
  await expect.poll(paused).toBe(true);
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await expect.poll(paused).toBe(true);
  await page.getByLabel("歌曲名称", { exact: true }).focus();
  await page.keyboard.press("Space");
  expect(await paused()).toBe(true);
  await page.getByRole("button", { name: "新建", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await expect(page.getByLabel("歌曲名称")).not.toHaveValue("未命名歌曲");
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(true);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框", exact: true }).focus();
  await page.keyboard.press("Space"); // Native close still works; playback remains paused.
  expect(await paused()).toBe(true);
});

test("复选框滑块和下拉框获得焦点后空格仍播放暂停", async ({ page }) => {
  await boot(page);
  await audio(page);
  const paused = () =>
    page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused);
  const follow = page.getByRole("checkbox", { name: "跟随播放" });
  await follow.click();
  await expect(follow).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await expect(follow).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(true);
  await expect(follow).not.toBeChecked();
  const zoom = page.getByLabel("时间轴缩放");
  await zoom.fill("2");
  await zoom.focus();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await expect(zoom).toHaveValue("2");
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(true);
  const speed = page.getByLabel("播放速度");
  await speed.selectOption("1.5");
  await speed.focus();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await expect(speed).toHaveValue("1.5");
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(true);
  const names = page.getByRole("checkbox", { name: "显示名字" });
  await names.check();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await expect(names).toBeChecked();
  await page.keyboard.press("Space");
  await expect.poll(paused).toBe(true);
  await page.getByLabel("歌曲名称", { exact: true }).fill("合成");
  await page.keyboard.press("End");
  await page.keyboard.press("Space");
  await expect(page.getByLabel("歌曲名称", { exact: true })).toHaveValue(
    "合成 ",
  );
  expect(await paused()).toBe(true);
});
