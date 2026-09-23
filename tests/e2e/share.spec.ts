import { test, expect, type Page } from "@playwright/test";

function wav(seconds = 12) {
  const rate = 8000;
  const length = rate * seconds;
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(length * 2, 40);
  return buffer;
}

async function mockShare(page: Page) {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: false,
        csrfToken: null,
        user: null,
      }),
    }),
  );
  await page.route("**/api/public/shares/demo-token", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "demo-token",
        revision: 3,
        publishedAt: "2026-09-23T00:00:00.000Z",
        updatedAt: "2026-09-23T01:00:00.000Z",
        audioAvailable: false,
        audioUrl: "/api/public/shares/demo-token/audio",
        snapshot: {
          snapshotVersion: 1,
          sourceProjectVersion: 2,
          songName: "合成分享",
          bpm: "120",
          audio: {
            name: "synthetic.wav",
            duration: 12,
            mimeType: "audio/wav",
            sizeBytes: 192044,
          },
          blocks: [
            {
              id: "block-a",
              type: "前奏",
              beats: "8",
              arrangement: "中心集合",
              remarks: "保持节奏",
              start: 0,
              end: 4,
              lyrics: [
                { id: "lyric-a", jp: "第一句", cn: "第一句中文", time: 0.5 },
              ],
            },
            {
              id: "block-b",
              type: "副歌",
              beats: "8",
              arrangement: "向前一步",
              remarks: "",
              start: 5,
              end: 9,
              lyrics: [
                { id: "lyric-b", jp: "第二句", cn: "第二句中文", time: 5.2 },
              ],
            },
          ],
          choreography: {
            dancers: [{ id: "dancer-a", name: "小一" }],
            canvas: { width: 800, height: 600 },
            tracks: [
              {
                dancerId: "dancer-a",
                positionFrames: [
                  {
                    id: "pos-a",
                    time: 0,
                    x: 0.25,
                    y: 0.5,
                    visible: true,
                  },
                  {
                    id: "pos-b",
                    time: 8,
                    x: 0.75,
                    y: 0.5,
                    visible: true,
                  },
                ],
                colorFrames: [
                  {
                    id: "color-a",
                    time: 0,
                    left: "极橙",
                    right: "蓝",
                  },
                ],
              },
            ],
            frames: [],
          },
        },
      }),
    }),
  );
}

test("只读分享页支持本地音乐、播放跟随、段落循环和移动端视图", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Local synthetic audio is not reliable in CI WebKit.",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockShare(page);
  await page.goto("/s/demo-token");
  await expect(page.getByRole("heading", { name: "合成分享" })).toBeVisible();
  await expect(page.getByText("云端音乐已被删除")).toBeVisible();
  await page.locator('.local-audio-banner input[type="file"]').setInputFiles({
    name: "synthetic.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "当前编排" }).getByText("中心集合"),
  ).toBeVisible();
  await page.getByLabel("同步偏移").fill("0.25");
  await expect(page.getByText("+0.25 秒")).toBeVisible();
  await page.getByRole("button", { name: "循环当前段", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出循环", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "查看视图" })
    .getByRole("button", { name: "队形", exact: true })
    .click();
  await expect(page.getByLabel("舞台俯视图")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
