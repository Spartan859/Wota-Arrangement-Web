import "fake-indexeddb/auto";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { unzipSync, strToU8, zipSync } from "fflate";
import {
  buildProjectArchive,
  mediaExtension,
  projectEntryName,
  readProjectArchive,
} from "../src/core/archive";
import {
  addDancer,
  addVideoAsset,
  addVideoClip,
  emptyChoreography,
} from "../src/core/choreography";
import { block, project, uid, type Project } from "../src/core/model";
import { ProjectDatabase } from "../src/core/storage";

const databases: ProjectDatabase[] = [];
const python = ["python3", "python"].find(
  (binary) => spawnSync(binary, ["-c", "import zipfile"]).status === 0,
);

afterEach(async () => {
  for (const db of databases) await db.delete();
  databases.length = 0;
});

function testDatabase() {
  const db = new ProjectDatabase("test-" + crypto.randomUUID());
  databases.push(db);
  return db;
}

async function fixture(db: ProjectDatabase) {
  const p = project();
  p.songName = "压缩包测试";
  p.blocks = [block("副歌", "16")];
  p.blocks[0].start = 1;
  p.blocks[0].end = 9;
  p.lyricSource = {
    raw: "[00:01]合成",
    name: "test.lrc",
    lrc: true,
    offset: 0.5,
  };
  p.choreography = emptyChoreography();
  const dancer = addDancer(p.choreography, "舞者", 0);
  const audioId = uid();
  const audioBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  p.audio = { id: audioId, name: "synthetic.wav", duration: 20 };
  await db.audio.put({ id: audioId, blob: new Blob([audioBytes]) });
  const asset = addVideoAsset(p.choreography, {
    name: "片段.mov",
    mimeType: "video/quicktime",
    sizeBytes: 6,
    duration: 3,
    width: 640,
    height: 360,
    frameRate: 30,
  });
  const videoBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  await db.videos.put({
    id: asset.localBlobId!,
    blob: new Blob([videoBytes]),
  });
  addVideoClip(p.choreography, dancer, asset.id, 1);
  return { project: p, audioId, audioBytes, asset, videoBytes };
}

describe("项目压缩包", () => {
  it("打包后导入还原项目与媒体，并按 Blob ID 重新分配", async () => {
    const source = testDatabase(),
      target = testDatabase();
    const {
      project: p,
      audioId,
      audioBytes,
      asset,
      videoBytes,
    } = await fixture(source);
    const progress: number[] = [];
    const { blob, skipped } = await buildProjectArchive(
      p,
      (percent) => progress.push(percent),
      source,
    );
    expect(skipped).toEqual([]);
    expect(progress.at(-1)).toBe(100);
    const entries = Object.keys(
      unzipSync(new Uint8Array(await blob.arrayBuffer())),
    );
    expect(entries).toContain(projectEntryName);
    expect(entries).toContain(`audio/${audioId}.wav`);
    expect(entries).toContain(`videos/${asset.localBlobId}.mov`);

    const { project: restored, missing } = await readProjectArchive(
      blob,
      () => {},
      target,
    );
    expect(missing).toEqual([]);
    expect(restored.songName).toBe("压缩包测试");
    expect(restored.blocks).toEqual(p.blocks);
    expect(restored.lyricSource).toEqual(p.lyricSource);
    expect(restored.choreography!.dancers).toEqual(p.choreography!.dancers);
    expect(restored.choreography!.canvas).toEqual(p.choreography!.canvas);
    expect(restored.choreography!.tracks).toEqual(p.choreography!.tracks);
    expect(restored.choreography!.frames).toEqual(p.choreography!.frames);
    expect(restored.audio).toEqual({ ...p.audio, id: restored.audio!.id });
    expect(restored.audio!.id).not.toBe(audioId);
    expect(restored.choreography!.videoAssets).toHaveLength(1);
    const restoredAsset = restored.choreography!.videoAssets[0];
    expect(restoredAsset.localBlobId).not.toBe(asset.localBlobId);
    expect({ ...restoredAsset, localBlobId: null }).toEqual({
      ...asset,
      localBlobId: null,
    });
    expect(
      new Uint8Array(
        await (await target.audio.get(restored.audio!.id!))!.blob.arrayBuffer(),
      ),
    ).toEqual(audioBytes);
    expect(
      new Uint8Array(
        await (await target.videos.get(
          restoredAsset.localBlobId!,
        ))!.blob.arrayBuffer(),
      ),
    ).toEqual(videoBytes);
  });

  it("缺少本地文件的视频不写入压缩包且逐个报告", async () => {
    const db = testDatabase();
    const { project: p } = await fixture(db);
    const unlinked = addVideoAsset(p.choreography!, {
      name: "未关联.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4,
      duration: 2,
      width: 320,
      height: 240,
      frameRate: 30,
      localBlobId: null,
    });
    const dangling = addVideoAsset(p.choreography!, {
      name: "丢失文件.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4,
      duration: 2,
      width: 320,
      height: 240,
      frameRate: 30,
      localBlobId: "missing-blob",
    });
    const { blob, skipped } = await buildProjectArchive(p, () => {}, db);
    expect(skipped).toEqual(["未关联.mp4", "丢失文件.mp4"]);
    expect(unlinked.localBlobId).toBeNull();
    expect(dangling.localBlobId).toBe("missing-blob");
    const entries = Object.keys(
      unzipSync(new Uint8Array(await blob.arrayBuffer())),
    );
    expect(entries.filter((name) => name.startsWith("videos/"))).toHaveLength(
      1,
    );

    const { project: restored, missing } = await readProjectArchive(
      blob,
      () => {},
      testDatabase(),
    );
    expect(missing).toEqual(["未关联.mp4", "丢失文件.mp4"]);
    expect(
      restored.choreography!.videoAssets.map((a) => a.localBlobId),
    ).toEqual([expect.any(String), null, null]);
  });

  it("同一个 Blob 被多个资源引用时只写入一次", async () => {
    const db = testDatabase();
    const { project: p, asset } = await fixture(db);
    const shared = addVideoAsset(p.choreography!, {
      name: "同一文件.webm",
      mimeType: "video/webm",
      sizeBytes: 6,
      duration: 3,
      width: 640,
      height: 360,
      frameRate: 30,
      localBlobId: asset.localBlobId,
    });
    expect(shared.localBlobId).toBe(asset.localBlobId);
    const { blob } = await buildProjectArchive(p, () => {}, db);
    const entries = Object.keys(
      unzipSync(new Uint8Array(await blob.arrayBuffer())),
    );
    expect(entries.filter((name) => name.startsWith("videos/"))).toHaveLength(
      1,
    );
  });

  it("音频缺失时清空引用，仍保留元信息", async () => {
    const db = testDatabase();
    const { project: p } = await fixture(db);
    p.audio = { id: "missing-audio", name: "gone.wav", duration: 12 };
    const { blob } = await buildProjectArchive(p, () => {}, db);
    expect(
      Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer()))).filter(
        (name) => name.startsWith("audio/"),
      ),
    ).toEqual([]);
    const { project: restored } = await readProjectArchive(
      blob,
      () => {},
      testDatabase(),
    );
    expect(restored.audio).toEqual({
      id: null,
      name: "gone.wav",
      duration: 12,
    });
  });

  it("损坏文件、缺少文档和非法文档分别报错", async () => {
    const db = testDatabase();
    await expect(
      readProjectArchive(
        new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])]),
        () => {},
        db,
      ),
    ).rejects.toThrow("压缩包无法读取，请确认文件完整。");
    const withoutDocument = zipSync({ "audio/other.wav": strToU8("x") });
    await expect(
      readProjectArchive(new Blob([withoutDocument]), () => {}, db),
    ).rejects.toThrow("压缩包缺少 project.json，无法导入。");
    const broken = project();
    broken.blocks = [block()];
    broken.blocks[0].start = -1;
    const invalid = zipSync({
      [projectEntryName]: strToU8(JSON.stringify(broken)),
    });
    await expect(
      readProjectArchive(new Blob([invalid]), () => {}, db),
    ).rejects.toThrow("blocks[0].start");
  });

  it("媒体扩展名优先取原文件名，其次是 MIME 类型", () => {
    expect(mediaExtension("song.WAV", "audio/wav")).toBe(".wav");
    expect(mediaExtension("clip", "video/webm;codecs=vp8")).toBe(".webm");
    expect(mediaExtension("voice", "audio/mpeg")).toBe(".mp3");
    expect(mediaExtension("unknown", "application/octet-stream")).toBe(".bin");
  });
});

describe.skipIf(!python)("Python 独立校验压缩包", () => {
  it("zipfile 能通过 CRC 校验并读出项目文档与媒体", async () => {
    const db = testDatabase();
    const { project: p, audioBytes } = await fixture(db);
    const { blob } = await buildProjectArchive(p, () => {}, db);
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "wota-archive-"));
    try {
      const path = join(directory, "project.wota.zip");
      await writeFile(path, Buffer.from(await blob.arrayBuffer()));
      const script = [
        "import json, sys, zipfile",
        "with zipfile.ZipFile(sys.argv[1]) as archive:",
        "    assert archive.testzip() is None",
        "    names = archive.namelist()",
        "    document = json.loads(archive.read('project.json'))",
        "    audio = archive.read([n for n in names if n.startswith('audio/')][0])",
        "print(document['songName'], len(names), len(audio))",
      ].join("\n");
      const result = spawnSync(python!, ["-c", script, path], {
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const [songName, entryCount, audioSize] = result.stdout.trim().split(" ");
      expect(songName).toBe("压缩包测试");
      expect(Number(entryCount)).toBe(3);
      expect(Number(audioSize)).toBe(audioBytes.length);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
