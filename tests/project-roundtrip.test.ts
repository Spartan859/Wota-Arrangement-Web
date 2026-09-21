import { describe, it, expect } from "vitest";
import {
  project,
  block,
  backup,
  parseProject,
  type Project,
} from "../src/core/model";
import { emptyChoreography, addDancer } from "../src/core/choreography";
function oldDraft() {
  const p = project();
  p.blocks = [block("副歌", "32")];
  p.blocks[0].start = 1;
  p.blocks[0].end = 13;
  p.lyricSource = {
    raw: "[00:01]合成",
    name: "test.lrc",
    lrc: true,
    offset: 0.5,
  };
  p.choreography = emptyChoreography();
  addDancer(p.choreography, "舞者", 0);
  p.audio = { id: "local-blob", name: "synthetic.wav", duration: 20 };
  return { ...p, schemaVersion: 1 } as unknown as Project;
}
describe("项目备份往返", () => {
  it("旧草稿被新界面编辑后导出为当前版本且立即可导入", () => {
    const p = oldDraft(),
      before = structuredClone(p);
    const exported = backup(p);
    const restored = parseProject(exported);
    expect(restored.schemaVersion).toBe(2);
    expect(restored.blocks).toEqual(p.blocks);
    expect(restored.choreography).toEqual(p.choreography);
    expect(restored.lyricSource).toEqual(p.lyricSource);
    expect(restored.audio).toEqual({ ...p.audio, id: null });
    expect(p).toEqual(before);
  });
});

it("无效字段报告具体路径，拒绝导出不可读备份", () => {
  const p = project();
  p.blocks = [block()];
  p.blocks[0].start = -1;
  expect(() => parseProject(JSON.stringify(p))).toThrow("blocks[0].start");
  expect(() => backup(p)).toThrow("blocks[0].start");
  expect(() => parseProject('{"broken":')).toThrow("JSON 无法解析");
});
it("无尺寸旧队形、旧颜色、BOM文本可导入且仍校验真实错误", () => {
  const p = project();
  p.choreography = emptyChoreography();
  addDancer(p.choreography, "旧舞者", 0);
  delete (p.choreography as Partial<typeof p.choreography>).canvas;
  p.choreography.frames[0].poses[0].left = "红";
  expect(parseProject("\uFEFF" + backup(p)).choreography?.canvas).toEqual({
    width: 800,
    height: 600,
  });
  p.choreography.frames[0].poses[0].x = 2;
  expect(() => backup(p)).toThrow("choreography.frames[0].poses[0].x");
});
