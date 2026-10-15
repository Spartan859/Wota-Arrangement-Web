import {
  Unzip,
  UnzipInflate,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  strFromU8,
  strToU8,
} from "fflate";
import { parseProject, serializeProject, uid, type Project } from "./model";
import { db as defaultDatabase, type ProjectDatabase } from "./storage";

export const projectEntryName = "project.json";
const audioDirectory = "audio";
const videoDirectory = "videos";
const chunkBytes = 1024 * 1024;
const mimeExtensions: Record<string, string> = {
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-flac": ".flac",
  "audio/x-m4a": ".m4a",
  "audio/x-wav": ".wav",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
};

export type ArchiveProgress = (percent: number) => void;
export type ArchiveResult = { blob: Blob; skipped: string[] };
export type ArchiveReadResult = { project: Project; missing: string[] };

export function mediaExtension(name: string, mimeType = "") {
  const matched = /\.[A-Za-z0-9]{1,8}$/.exec(name.trim());
  if (matched) return matched[0].toLowerCase();
  const mime = mimeType.trim().toLowerCase().split(";")[0].trim();
  return mimeExtensions[mime] ?? ".bin";
}

/**
 * Builds the downloadable project archive: the current project document plus
 * the local song file and every inserted video that still has a local Blob.
 * Media is stored uncompressed because the supported audio/video formats are
 * already compressed; only the JSON document is deflated.
 */
export async function buildProjectArchive(
  project: Project,
  onProgress: ArchiveProgress = () => {},
  store: ProjectDatabase = defaultDatabase,
): Promise<ArchiveResult> {
  const document = serializeProject(project);
  const media: { path: string; blob: Blob }[] = [];
  const skipped: string[] = [];
  const skippedNames = new Set<string>();
  const audioId = project.audio?.id ?? null;
  if (audioId) {
    const record = await store.audio.get(audioId);
    if (record)
      media.push({
        path: `${audioDirectory}/${audioId}${mediaExtension(
          project.audio!.name,
          record.blob.type,
        )}`,
        blob: record.blob,
      });
  }
  const inserted = new Set<string>();
  for (const asset of project.choreography?.videoAssets ?? []) {
    const blobId = asset.localBlobId;
    if (!blobId || inserted.has(blobId)) {
      if (!blobId && !skippedNames.has(asset.name)) {
        skippedNames.add(asset.name);
        skipped.push(asset.name);
      }
      continue;
    }
    const record = await store.videos.get(blobId);
    if (!record) {
      if (!skippedNames.has(asset.name)) {
        skippedNames.add(asset.name);
        skipped.push(asset.name);
      }
      continue;
    }
    inserted.add(blobId);
    media.push({
      path: `${videoDirectory}/${blobId}${mediaExtension(
        asset.name,
        asset.mimeType || record.blob.type,
      )}`,
      blob: record.blob,
    });
  }

  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      failure ??= error;
      return;
    }
    if (chunk.length) parts.push(chunk);
  });
  const documentEntry = new ZipDeflate(projectEntryName, { level: 6 });
  zip.add(documentEntry);
  documentEntry.push(strToU8(document), true);
  const totalBytes = media.reduce((sum, item) => sum + item.blob.size, 0);
  let writtenBytes = 0;
  for (const item of media) {
    const entry = new ZipPassThrough(item.path);
    zip.add(entry);
    for (let offset = 0; offset < item.blob.size; offset += chunkBytes) {
      const chunk = new Uint8Array(
        await item.blob.slice(offset, offset + chunkBytes).arrayBuffer(),
      );
      entry.push(chunk, false);
      writtenBytes += chunk.length;
      if (failure) throw failure;
      if (totalBytes)
        onProgress(Math.min(99, Math.floor((writtenBytes / totalBytes) * 100)));
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failure) throw failure;
  onProgress(100);
  return { blob: toBlob(parts, "application/zip"), skipped };
}

/**
 * Reads a project archive produced by {@link buildProjectArchive}. Media files
 * are written back into IndexedDB under fresh Blob IDs so importing never
 * overwrites media that already belongs to another local project.
 */
export async function readProjectArchive(
  file: Blob,
  onProgress: ArchiveProgress = () => {},
  store: ProjectDatabase = defaultDatabase,
): Promise<ArchiveReadResult> {
  const documentChunks: Uint8Array[] = [];
  const found = new Map<string, Blob>();
  let discovered = 0;
  let pending = 0;
  let inputEnded = false;
  let failure: Error | null = null;
  let finish = () => {};
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const settle = () => {
    if (inputEnded && pending === 0) finish();
  };
  const unzip = new Unzip((entry) => {
    const target = archiveTarget(entry.name);
    if (!target) return;
    discovered += 1;
    pending += 1;
    const parts: Uint8Array[] = [];
    entry.ondata = (error, chunk, final) => {
      if (error) {
        failure ??= new Error("压缩包无法读取，请确认文件完整。");
        if (final) {
          pending -= 1;
          settle();
        }
        return;
      }
      if (chunk.length) parts.push(chunk);
      if (!final) return;
      pending -= 1;
      if (target.kind === "project") documentChunks.push(...parts);
      else found.set(`${target.kind}:${target.id}`, toBlob(parts));
      settle();
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  const totalBytes = file.size || 1;
  let readBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      readBytes += value.length;
      unzip.push(value, false);
      onProgress(Math.min(99, Math.floor((readBytes / totalBytes) * 100)));
    }
  } catch {
    // Unsupported or truncated entries surface as decoder errors; report them
    // with the same guidance the user sees for a damaged file.
    throw new Error("压缩包无法读取，请确认文件完整。");
  }
  inputEnded = true;
  if (!discovered) throw new Error("压缩包无法读取，请确认文件完整。");
  if (pending) throw new Error("压缩包内容不完整，请重新导出后再试。");
  settle();
  await completed;
  if (failure) throw failure;
  if (!documentChunks.length)
    throw new Error(`压缩包缺少 ${projectEntryName}，无法导入。`);
  const project = parseProject(strFromU8(concat(documentChunks)));
  const missing: string[] = [];
  const missingNames = new Set<string>();
  if (project.audio) {
    const blob = found.get(`audio:${project.audio.id}`);
    if (blob) {
      const id = uid();
      await store.audio.put({ id, blob });
      project.audio.id = id;
    } else project.audio.id = null;
  }
  for (const asset of project.choreography?.videoAssets ?? []) {
    const blob = asset.localBlobId
      ? found.get(`video:${asset.localBlobId}`)
      : undefined;
    if (blob) {
      const id = uid();
      await store.videos.put({ id, blob });
      asset.localBlobId = id;
      continue;
    }
    asset.localBlobId = null;
    if (!missingNames.has(asset.name)) {
      missingNames.add(asset.name);
      missing.push(asset.name);
    }
  }
  onProgress(100);
  return { project, missing };
}

type ArchiveTarget =
  | { kind: "project" }
  | { kind: "audio"; id: string }
  | { kind: "video"; id: string };

function archiveTarget(rawName: string): ArchiveTarget | null {
  const name = rawName.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (!name || name.endsWith("/") || name.includes("..")) return null;
  if (name === projectEntryName) return { kind: "project" };
  const matched = /^(audio|videos)\/([^/]+)$/.exec(name);
  if (!matched) return null;
  const id = matched[2].replace(/\.[^.]*$/, "");
  if (!id) return null;
  return matched[1] === audioDirectory
    ? { kind: "audio", id }
    : { kind: "video", id };
}

function concat(chunks: Uint8Array[]) {
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// fflate hands back `Uint8Array<ArrayBufferLike>` values, which the DOM types do
// not accept as `BlobPart` even though every runtime implementation does.
function toBlob(chunks: Uint8Array[], type?: string) {
  return new Blob(chunks as unknown as BlobPart[], type ? { type } : undefined);
}
