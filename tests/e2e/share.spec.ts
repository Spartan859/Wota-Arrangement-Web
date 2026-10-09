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

async function syntheticWebm(page: Page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext("2d")!;
    const recorder = new MediaRecorder(canvas.captureStream(30), {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });
    recorder.start();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const draw = () => {
        const elapsed = performance.now() - start;
        context.fillStyle = elapsed % 200 < 100 ? "#e85d75" : "#4778d6";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (elapsed >= 700) resolve();
        else requestAnimationFrame(draw);
      };
      draw();
    });
    recorder.stop();
    const bytes = new Uint8Array(await (await done).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
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
  await expect(page.locator(".public-arrangement .editor-card")).toBeVisible();
  await expect(page.getByRole("button", { name: /当前作为入点/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "多选模式" })).toHaveCount(0);
  await expect(page.getByText("选中编辑，拖动边缘对时")).toHaveCount(0);
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
  await page.getByRole("button", { name: "播放设置" }).click();
  await page.getByLabel("同步偏移").fill("0.25");
  await expect(page.getByText("+0.25 秒")).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByRole("button", { name: "循环", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "退出循环", exact: true }).first(),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("舞台俯视图")).toBeVisible();
  await expect(page.locator(".public-arrangement .editor-card")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("只读分享页播放云端视频并支持每片段最小化和恢复", async ({ page }) => {
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
  await page.route("**/api/public/shares/video-token", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: "video-token",
        revision: 1,
        publishedAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        audioAvailable: false,
        audioUrl: "/api/public/shares/video-token/audio",
        videos: [
          {
            id: "video-asset",
            sourceVersion: "v1",
            name: "video.webm",
            mimeType: "video/webm",
            sizeBytes: 1000,
            duration: 1,
            width: 160,
            height: 120,
            frameRate: 30,
            url: "/api/public/shares/video-token/videos/video-asset",
            available: true,
          },
        ],
        snapshot: {
          snapshotVersion: 1,
          sourceProjectVersion: 2,
          songName: "视频分享",
          bpm: "120",
          audio: null,
          blocks: [],
          choreography: {
            canvas: { width: 800, height: 600 },
            videoAssets: [
              {
                id: "video-asset",
                sourceVersion: "v1",
                name: "video.webm",
                mimeType: "video/webm",
                sizeBytes: 1000,
                duration: 1,
                width: 160,
                height: 120,
                frameRate: 30,
              },
            ],
            dancers: [{ id: "dancer-a", name: "小一" }],
            frames: [],
            tracks: [
              {
                dancerId: "dancer-a",
                positionFrames: [
                  { id: "pos", time: 0, x: 0.5, y: 0.5, visible: true },
                ],
                colorFrames: [],
                videoClips: [
                  {
                    id: "clip",
                    assetId: "video-asset",
                    inPoint: 0,
                    crop: { x: 0, y: 0, width: 1, height: 1 },
                    offset: { x: -0.175, y: -0.1167 },
                    scale: 0.35,
                  },
                ],
                videoFrames: [
                  { id: "insert", clipId: "clip", kind: "insert", time: 0 },
                ],
              },
            ],
          },
        },
      }),
    }),
  );
  await page.goto("/");
  const video = await syntheticWebm(page);
  await page.route(
    "**/api/public/shares/video-token/videos/video-asset",
    (route) =>
      route.fulfill({
        status: 206,
        headers: { "content-type": "video/webm" },
        body: video,
      }),
  );
  await page.goto("/s/video-token");
  await expect(page.getByRole("heading", { name: "视频分享" })).toBeVisible();
  await expect(page.locator(".formation-video video")).toBeVisible();
  await page.locator(".formation-video-tray button").first().click();
  await expect(page.locator(".formation-video")).toBeHidden();
  await page.locator(".formation-video-tray button").first().click();
  await expect(page.locator(".formation-video")).toBeVisible();
});
