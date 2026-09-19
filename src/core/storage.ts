import Dexie, { type EntityTable } from "dexie";
import type { Project } from "./model";
export type SavedProject = { id: string; revision: number; document: Project };
export type AudioRecord = { id: string; blob: Blob };
export class ProjectDatabase extends Dexie {
  projects!: EntityTable<SavedProject, "id">;
  audio!: EntityTable<AudioRecord, "id">;
  constructor(name = "wota-workbench") {
    super(name);
    this.version(1).stores({ projects: "id", audio: "id" });
  }
  async save(document: Project, expectedRevision: number): Promise<number> {
    return this.transaction("rw", this.projects, async () => {
      const current = await this.projects.get(document.id);
      if ((current?.revision ?? 0) !== expectedRevision)
        throw new Error("CONFLICT");
      const revision = expectedRevision + 1;
      await this.projects.put({ id: document.id, revision, document });
      return revision;
    });
  }
}
export const db = new ProjectDatabase();
export function download(data: BlobPart, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const safeName = (name: string) =>
  (name.trim() || "未命名歌曲").replace(/[\\/:*?"<>|]/g, "_");
