import { useEffect, useRef, useState } from "react";
import { History, project, uid, type Project } from "./core/model";
import { db, type SavedProject } from "./core/storage";
export function useProject() {
  const [document, setDocument] = useState<Project>(project);
  const latest = useRef(document),
    history = useRef(new History<Project>()),
    revisions = useRef(new Map<string, number>()),
    saved = useRef("");
  const [ready, setReady] = useState(false),
    [status, setStatus] = useState("正在打开本地项目…"),
    [conflict, setConflict] = useState(false),
    conflictRef = useRef(false);
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const refresh = async () => {
    const all = await db.projects.toArray();
    setProjects(
      all.sort((a, b) => b.document.updatedAt - a.document.updatedAt),
    );
  };
  function replace(p: Project) {
    latest.current = p;
    setDocument(p);
  }
  function install(p: Project, revision: number) {
    revisions.current.set(p.id, revision);
    history.current = new History();
    conflictRef.current = false;
    setConflict(false);
    saved.current = revision ? JSON.stringify(p) : "";
    replace(p);
    try {
      localStorage.setItem("wota-active", p.id);
    } catch {
      /* IndexedDB remains the source of truth. */
    }
    setStatus(revision ? "已保存到此浏览器" : "待保存");
  }
  function flush(): Promise<boolean> {
    const snapshot = structuredClone(latest.current);
    queue.current = queue.current
      .catch(() => false)
      .then(async () => {
        if (conflictRef.current) return false;
        const serialized = JSON.stringify(snapshot);
        if (saved.current === serialized) return true;
        try {
          const rev = await db.save(
            snapshot,
            revisions.current.get(snapshot.id) ?? 0,
          );
          revisions.current.set(snapshot.id, rev);
          saved.current = serialized;
          if (latest.current.id === snapshot.id)
            setStatus(
              JSON.stringify(latest.current) === serialized
                ? "已保存到此浏览器"
                : "待保存",
            );
          await refresh();
          return true;
        } catch (error) {
          if (error instanceof Error && error.message === "CONFLICT") {
            conflictRef.current = true;
            setConflict(true);
            setStatus("另一标签页已更新此项目，请保留副本或重新载入。");
          } else
            setStatus("本地保存失败，请下载 JSON 备份；当前编辑仍保留在内存。");
          return false;
        }
      });
    return queue.current;
  }
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const all = await db.projects.toArray();
        if (!mounted) return;
        let active: string | null = null;
        try {
          active = localStorage.getItem("wota-active");
        } catch {
          /* optional */
        }
        const p =
          all.find((p) => p.id === active) ??
          all.sort((a, b) => b.document.updatedAt - a.document.updatedAt)[0];
        if (p) install(p.document, p.revision);
        setProjects(all);
      } catch {
        setStatus("无法打开本地存储，可继续编辑并下载 JSON 备份。");
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || conflict) return;
    const timer = setTimeout(() => {
      void flush();
    }, 550);
    return () => clearTimeout(timer);
  }, [document, ready, conflict]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (saved.current !== JSON.stringify(latest.current)) {
        e.preventDefault();
      }
    };
    const hidden = () => {
      if (globalThis.document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("beforeunload", unload);
    globalThis.document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", unload);
      globalThis.document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  function edit(fn: (p: Project) => void, historical = true) {
    if (conflictRef.current) return;
    const next = structuredClone(latest.current);
    fn(next);
    if (JSON.stringify(next) === JSON.stringify(latest.current)) return;
    if (historical) history.current.record(latest.current);
    next.updatedAt = Date.now();
    replace(next);
    setStatus("待保存");
  }
  function travel(direction: "undo" | "redo") {
    if (conflictRef.current) return;
    const current = latest.current;
    const next = history.current[direction](current);
    replace({
      ...next,
      audio: current.audio,
      position: current.position,
      updatedAt: Date.now(),
    });
    setStatus("待保存");
  }
  async function flushLatest() {
    do {
      if (!(await flush())) return false;
    } while (saved.current !== JSON.stringify(latest.current));
    return true;
  }
  async function open(id: string) {
    if (!(await flushLatest())) return;
    const found = await db.projects.get(id);
    if (found) install(found.document, found.revision);
  }
  async function create(p = project()) {
    if (!(await flushLatest())) return;
    install(p, 0);
  }
  async function reload() {
    const found = await db.projects.get(latest.current.id);
    if (found) install(found.document, found.revision);
  }
  async function copy() {
    await queue.current;
    const p = structuredClone(latest.current);
    p.id = uid();
    p.songName += "（副本）";
    install(p, 0);
  }
  return {
    document,
    latest,
    ready,
    status,
    conflict,
    projects,
    edit,
    travel,
    flush,
    open,
    create,
    reload,
    copy,
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
  };
}
