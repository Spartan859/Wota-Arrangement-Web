import { test, expect, type Page } from "@playwright/test";
function wav(seconds = 12) {
  const b = Buffer.alloc(44 + 8000 * seconds * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
async function song(page: Page, seconds = 12) {
  await page.getByLabel("音频文件").setInputFiles({
    name: "synthetic.wav",
    mimeType: "audio/wav",
    buffer: wav(seconds),
  });
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled();
}
async function at(page: Page, time: number) {
  await page.getByLabel("播放进度", { exact: true }).fill(String(time));
}
async function add(page: Page, name: string) {
  await page.getByRole("button", { name: "添加舞者", exact: true }).click();
  await page.getByLabel("舞者姓名").fill(name);
  await page.getByRole("button", { name: "保存舞者", exact: true }).click();
}
async function boot(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "当前段落" })).toBeVisible();
}
async function getX(page: Page, name: string) {
  return page
    .getByRole("button", { name: `舞者 ${name}`, exact: true })
    .evaluate((el) =>
      Number(el.getAttribute("transform")!.match(/translate\(([^ ]+)/)![1]),
    );
}
test("舞者双手颜色、拖动建帧、插值、登退场、撤销和刷新", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await add(page, "小一");
  await song(page);
  const dancer = page.getByRole("button", { name: "舞者 小一", exact: true });
  await expect(dancer).toBeVisible();
  await dancer.locator('[data-hand="left"]').click();
  await expect(page.locator(".stick-palette button")).toHaveCount(24);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "红", exact: true })
    .click();
  await dancer.locator('[data-hand="right"]').click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "绿", exact: true })
    .click();
  await expect(dancer.locator('[data-hand="left"]')).toHaveAttribute(
    "fill",
    "#ee3038",
  );
  await expect(dancer.locator('[data-hand="right"]')).toHaveAttribute(
    "fill",
    "#18ae53",
  );
  await at(page, 4);
  const box = (await dancer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".formation-key")).toHaveCount(2);
  const finalX = await getX(page, "小一");
  expect(finalX).toBeGreaterThan(400);
  await at(page, 2);
  await expect
    .poll(() => getX(page, "小一"))
    .toBeCloseTo((400 + finalX) / 2, 0);
  await at(page, 4);
  await page.getByRole("button", { name: "退场", exact: true }).click();
  await expect(dancer).toBeHidden();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(dancer).toBeVisible();
  await expect(page.locator(".save-state")).toContainText("已保存");
  await page.reload();
  await expect(dancer).toBeVisible();
  await expect(page.locator(".formation-key")).toHaveCount(2);
  expect(errors).toEqual([]);
});
test("共享轨道改时冲突、越界保留、删除与窄屏切换", async ({ page }) => {
  await page.setViewportSize({ width: 922, height: 880 });
  await boot(page);
  await page
    .getByRole("navigation", { name: "编辑视图" })
    .getByRole("button", { name: "队形", exact: true })
    .click();
  await song(page);
  await at(page, 2);
  await add(page, "入场者");
  await expect(page.locator(".formation-key")).toHaveCount(2);
  await page.locator(".formation-key").nth(1).click();
  await page.getByRole("button", { name: "关键帧时间", exact: true }).click();
  await page.getByLabel("关键帧秒数").fill("0");
  await page
    .getByRole("button", { name: "保存关键帧时间", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "已有",
  );
  await page.getByLabel("关键帧秒数").fill("5");
  await page
    .getByRole("button", { name: "保存关键帧时间", exact: true })
    .click();
  await song(page, 3);
  await expect(page.locator(".formation-key.out-of-range")).toHaveCount(1);
  await page.locator(".formation-key.out-of-range").click();
  await page.getByRole("button", { name: "删除关键帧", exact: true }).click();
  await expect(page.locator(".formation-key")).toHaveCount(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".formation-key")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("舞台俯视图")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

async function formationFixture(page: Page) {
  await boot(page);
  const dancers = [
    { id: "alice", name: "甲" },
    { id: "bob", name: "乙" },
  ];
  const frames = [0, 4].map((time, i) => ({
    id: `f${i}`,
    time,
    poses: dancers.map((d, j) => ({
      dancerId: d.id,
      x: i ? 0.75 : 0.25,
      y: j ? 0.7 : 0.3,
      left: i ? "红" : "蓝",
      right: "绿",
      visible: true,
    })),
  }));
  await page.getByLabel("打开项目文件").setInputFiles({
    name: "formation.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        id: "fixture",
        songName: "队形测试",
        bpm: "120",
        blocks: [],
        audio: null,
        position: 0,
        updatedAt: 1,
        choreography: { dancers, frames },
      }),
    ),
  });
  await expect(page.getByLabel("歌曲名称")).toHaveValue("队形测试");
  await song(page);
}
test("多人同步播放、变速与AB回跳，拖动关键帧和边界限制", async ({ page }) => {
  await formationFixture(page);
  await at(page, 2);
  await expect.poll(() => getX(page, "甲")).toBeCloseTo(400, 0);
  await expect.poll(() => getX(page, "乙")).toBeCloseTo(400, 0);
  await page.getByLabel("播放速度").selectOption("2");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect.poll(() => getX(page, "甲")).toBeGreaterThan(410);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await at(page, 1);
  await page.getByRole("button", { name: "选 A", exact: true }).click();
  await at(page, 2);
  await page.getByRole("button", { name: "选 B", exact: true }).click();
  await page
    .getByRole("button", { name: "开始 A/B 循环", exact: true })
    .click();
  await at(page, 1.95);
  await expect.poll(() => getX(page, "甲")).toBeLessThan(380);
  await page
    .getByRole("button", { name: "退出 A/B 循环", exact: true })
    .click();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByLabel("时间轴缩放").fill("2");
  const key = page.locator(".formation-key").nth(1),
    lane = (await page.locator(".formation-key-lane").boundingBox())!,
    box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + lane.width / 12,
    box.y + box.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(key).toHaveAttribute("title", "00:05.00");
  await expect(page.locator(".timeline-block")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await at(page, 5);
  const dancer = page.getByRole("button", { name: "舞者 甲", exact: true }),
    d = (await dancer.boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, 0, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => getX(page, "甲")).toBeCloseTo(24, 0);
});
test("冲突后禁止队形修改，可另存副本，全曲删除可撤销", async ({
  page,
  context,
}) => {
  await formationFixture(page);
  await expect(page.locator(".save-state")).toContainText("已保存");
  const second = await context.newPage();
  await boot(second);
  await expect(second.getByLabel("歌曲名称")).toHaveValue("队形测试");
  await page.getByLabel("歌曲名称").fill("另一标签已更新");
  await page.getByLabel("歌曲名称").press("Tab");
  await expect(page.locator(".save-state")).toContainText("已保存");
  await add(second, "冲突舞者");
  await expect(second.locator(".conflict")).toBeVisible();
  await expect(
    second.getByRole("button", { name: "添加舞者", exact: true }),
  ).toBeDisabled();
  await expect(
    second.getByRole("button", { name: "记录队形", exact: true }),
  ).toBeDisabled();
  await second.getByRole("button", { name: "保留副本", exact: true }).click();
  await second.getByLabel("选择舞者").selectOption("alice");
  await second.getByRole("button", { name: "全曲删除", exact: true }).click();
  await second
    .getByRole("button", { name: "确认删除舞者", exact: true })
    .click();
  await expect(
    second.getByRole("button", { name: "舞者 甲", exact: true }),
  ).toHaveCount(0);
  await second.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    second.getByRole("button", { name: "舞者 甲", exact: true }),
  ).toHaveCount(1);
});

test("左右手同时设置颜色", async ({ page }) => {
  await boot(page);
  await add(page, "同时设置");
  const dancer = page.getByRole("button", {
    name: "舞者 同时设置",
    exact: true,
  });
  await dancer.locator('[data-hand="left"]').click();
  await page.getByRole("button", { name: "左右手同时", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "黑", exact: true })
    .click();
  await expect(dancer.locator('[data-hand="left"]')).toHaveAttribute(
    "fill",
    "#111827",
  );
  await expect(dancer.locator('[data-hand="right"]')).toHaveAttribute(
    "fill",
    "#111827",
  );
});

test("画布尺寸校验、实时坐标、拖动、撤销和刷新", async ({ page }) => {
  await boot(page);
  await add(page, "尺寸测试");
  const stage = page.getByLabel("舞台俯视图");
  const dancer = page.getByRole("button", {
    name: "舞者 尺寸测试",
    exact: true,
  });
  const changeSize = async (width: string, height: string) => {
    await page.getByRole("button", { name: "画布尺寸", exact: true }).click();
    await page.getByLabel("画布宽度").fill(width);
    await page.getByLabel("画布高度").fill(height);
    await page.getByRole("button", { name: "保存尺寸", exact: true }).click();
  };
  await changeSize("0", "400");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "尺寸范围",
  );
  await expect(stage).toHaveAttribute("viewBox", "0 0 800 600");
  await page.getByLabel("画布宽度").fill("1200");
  await page.getByRole("button", { name: "保存尺寸", exact: true }).click();
  await expect(stage).toHaveAttribute("viewBox", "0 0 1200 400");
  await expect
    .poll(() => dancer.getAttribute("transform"))
    .toContain("translate(600 200)");
  await page.waitForTimeout(150);
  await expect(dancer).toHaveAttribute("transform", /translate\(600 200\)/);
  const box = (await dancer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() => dancer.getAttribute("transform"))
    .not.toContain("translate(600 200)");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(dancer).toHaveAttribute("transform", /translate\(600 200\)/);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(stage).toHaveAttribute("viewBox", "0 0 800 600");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(stage).toHaveAttribute("viewBox", "0 0 1200 400");
  await expect(page.locator(".save-state")).toContainText("已保存");
  await page.reload();
  await expect(stage).toHaveAttribute("viewBox", "0 0 1200 400");
  await expect(dancer).toHaveAttribute("transform", /translate\(600 200\)/);
  await changeSize("400", "1200");
  await expect(stage).toHaveAttribute("viewBox", "0 0 400 1200");
  await expect(dancer).toHaveAttribute("transform", /translate\(200 600\)/);
  await expect(page.locator(".save-state")).toContainText("已保存");
  // Simulate an IndexedDB project saved before canvas dimensions existed.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("wota-workbench");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("projects", "readwrite");
          const store = tx.objectStore("projects");
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const current = cursor.result;
            if (!current) return;
            const record = current.value;
            if (record.document.choreography)
              delete record.document.choreography.canvas;
            current.update(record);
            current.continue();
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(stage).toHaveAttribute("viewBox", "0 0 800 600");
  await expect(dancer).toHaveAttribute("transform", /translate\(400 300\)/);
});

test("尺寸弹窗选择缩放站位，按钮相邻及全帧保留坐标", async ({ page }) => {
  await formationFixture(page);
  const addButton = page.getByRole("button", { name: "添加舞者", exact: true });
  const sizeButton = page.getByRole("button", {
    name: "画布尺寸",
    exact: true,
  });
  const a = (await addButton.boundingBox())!,
    b = (await sizeButton.boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(b.x - (a.x + a.width)).toBeLessThan(12);
  await at(page, 0);
  await sizeButton.click();
  await expect(
    page.getByRole("checkbox", { name: "按比例缩放舞者站位" }),
  ).not.toBeChecked();
  await page.getByLabel("画布宽度").fill("1600");
  await page.getByLabel("画布高度").fill("1200");
  await expect(page.getByRole("dialog")).toContainText("正中心");
  await page.getByRole("button", { name: "保存尺寸", exact: true }).click();
  await expect.poll(() => getX(page, "甲")).toBeCloseTo(600, 0);
  await at(page, 4);
  await expect.poll(() => getX(page, "甲")).toBeCloseTo(1000, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("舞台俯视图")).toHaveAttribute(
    "viewBox",
    "0 0 800 600",
  );
  await sizeButton.click();
  await page.getByLabel("画布宽度").fill("1600");
  await page.getByLabel("画布高度").fill("1200");
  await page.getByRole("checkbox", { name: "按比例缩放舞者站位" }).check();
  await page.getByRole("button", { name: "保存尺寸", exact: true }).click();
  await expect.poll(() => getX(page, "甲")).toBeCloseTo(1200, 0);
  await expect(page.locator(".save-state")).toContainText("已保存");
  await page.reload();
  await expect.poll(() => getX(page, "甲")).toBeCloseTo(1200, 0);
});

test("关键帧拖动全局松开只提交一次，捕获丢失回退", async ({ page }) => {
  await formationFixture(page);
  const key = page.locator(".formation-key").nth(1);
  await key.evaluate((el) =>
    el.addEventListener("pointerdown", (e) => {
      (el as HTMLElement).dataset.pointerId = String(
        (e as PointerEvent).pointerId,
      );
    }),
  );
  let box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, {
    steps: 4,
  });
  await key.evaluate((el) =>
    el.releasePointerCapture(Number((el as HTMLElement).dataset.pointerId)),
  );
  await expect
    .poll(() =>
      key.evaluate((el) => parseFloat((el as HTMLElement).style.left)),
    )
    .toBeCloseTo(100 / 3, 2);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await expect(key).toHaveAttribute("title", "00:04.00");
  box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, {
    steps: 4,
  });
  await key.evaluate((el) =>
    document.body.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: Number((el as HTMLElement).dataset.pointerId),
      }),
    ),
  );
  await expect(key).not.toHaveAttribute("title", "00:04.00");
  const committed = await key.getAttribute("title");
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
  await expect(key).toHaveAttribute("title", committed!);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(key).toHaveAttribute("title", "00:04.00");
});
