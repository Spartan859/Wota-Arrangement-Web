import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || "chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForLoadState("networkidle");
  const lyric = (jp, cn, time) => ({ id: crypto.randomUUID(), jp, cn, time });
  const p = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    songName: "光のリハーサル · 排练示例",
    bpm: "120",
    blocks: [
      {
        id: "intro",
        type: "前奏",
        beats: "2",
        lyrics: [lyric("（纯动作/无歌词）", "（纯动作/无歌词）", null)],
        arrangement: "起势 → 双手展开",
        remarks: "面向观众，等待第一拍",
        start: 0,
        end: 8,
      },
      {
        id: "verse",
        type: "A melo",
        beats: "4",
        lyrics: [
          lyric("光の中で、一歩ずつ", "在光里，一步一步", 8),
          lyric("このリズムを、つないでいこう", "让这个节奏，继续连接下去", 16),
        ],
        arrangement: "左右交替挥棒 × 2\n第二句转向中线",
        remarks: "保持八拍的呼吸",
        start: 8,
        end: 24,
      },
      {
        id: "chorus",
        type: "副歌",
        beats: "4",
        lyrics: [lyric("ここから、もう一度", "就从这里，再来一次", 24)],
        arrangement: "双臂上举 → 交叉 → 展开",
        remarks: "最后两拍统一收势",
        start: 24,
        end: 40,
      },
    ],
    pool: [
      ...Array.from({ length: 6 }, (_, i) => ({
        ...lyric(
          ["次の光を見つけよう", "一緒に歩いていこう", "まだ終わらない歌"][
            i % 3
          ],
          ["寻找下一束光", "一起向前走", "还未结束的歌"][i % 3],
          40 + i * 4,
        ),
        status: "pending",
      })),
    ],
    staging: [],
    insertionAfter: null,
    audio: null,
    position: 0,
    updatedAt: Date.now(),
  };
  await page.getByLabel("打开项目文件").setInputFiles({
    name: "demo.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole("button", { name: "编辑段落 2 A melo" }).click();
  const rate = 8000,
    samples = rate * 60,
    b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples * 2, 4);
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
  b.writeUInt32LE(samples * 2, 40);
  await page.getByLabel("音频文件").setInputFiles({
    name: "合成排练音轨.wav",
    mimeType: "audio/wav",
    buffer: b,
  });
  await page
    .getByRole("button", { name: "播放", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/desktop.png" });
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        overflow: document.documentElement.scrollWidth > innerWidth,
        panels: [...document.querySelectorAll(".panel")].map((p) => ({
          class: p.className,
          top: p.getBoundingClientRect().top,
          height: p.getBoundingClientRect().height,
          scroll: p.scrollTop,
          heading: p.querySelector(".panel-heading")?.getBoundingClientRect()
            .top,
        })),
        errors: [],
      })),
    ),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "test-results/desktop-compact.png" });
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        compactLyricsHeaderVisible:
          document
            .querySelector(".lyrics-panel .panel-heading")
            .getBoundingClientRect().top >=
          document.querySelector(".lyrics-panel").getBoundingClientRect().top,
        compactOverflow: document.documentElement.scrollWidth > innerWidth,
      })),
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "段落", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile.png" });
  console.log(
    JSON.stringify({
      errors,
      mobileOverflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    }),
  );
} finally {
  await browser.close();
}
