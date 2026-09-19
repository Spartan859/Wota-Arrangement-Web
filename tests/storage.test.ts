import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDatabase } from "../src/core/storage";
import { project } from "../src/core/model";
const databases: ProjectDatabase[] = [];
afterEach(async () => {
  for (const db of databases) await db.delete();
  databases.length = 0;
});
describe("浏览器存储与多标签页", () => {
  it("项目与音频分开保存并读回", async () => {
    const db = new ProjectDatabase("test-" + crypto.randomUUID());
    databases.push(db);
    const p = project();
    const revision = await db.save(p, 0);
    expect(revision).toBe(1);
    expect((await db.projects.get(p.id))!.document).toEqual(p);
    await db.audio.put({ id: "audio", blob: new Blob(["test"]) });
    expect((await db.audio.get("audio"))!.blob.size).toBe(4);
  });
  it("同版本并发写入仅一次成功，旧标签页不会覆盖", async () => {
    const db = new ProjectDatabase("test-" + crypto.randomUUID());
    databases.push(db);
    const p = project();
    await db.save(p, 0);
    const first = { ...p, songName: "first" },
      second = { ...p, songName: "second" };
    const outcomes = await Promise.allSettled([
      db.save(first, 1),
      db.save(second, 1),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    expect((await db.projects.get(p.id))!.document.songName).toBe("first");
  });
});
