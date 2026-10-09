import { BatonUsage } from "./components/BatonUsage";
import { FormationCanvas } from "./components/FormationCanvas";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Download,
  Eye,
  FolderOpen,
  Plus,
  Redo2,
  Undo2,
  Upload,
  Waves,
} from "lucide-react";
import {
  backup,
  block,
  insertAt,
  parseProject,
  project,
  sectionTypes,
  uid,
  type Block,
  type Lyric,
  type Project,
} from "./core/model";
import {
  createShareSnapshot,
  formatBytes,
  type ShareSnapshot,
  type ShareSummary,
} from "./core/share";
import { ApiError, fetchShares, uploadShare } from "./api/client";
import { db, download, safeName } from "./core/storage";
import {
  activeBlock,
  activeLyric,
  formatTime,
  intervalError,
  insertionRange,
  playable,
} from "./core/timing";
import { useProject } from "./useProject";
import { Field, Modal } from "./components/Fields";
import { LyricsImport } from "./components/LyricsImport";
import { Preview } from "./components/Preview";
import { BlockEditor } from "./components/BlockEditor";
import { Player, type PlayerHandle } from "./components/Player";
import { useSession } from "./session";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, loading: sessionLoading, login, logout } = useSession();
  const store = useProject(),
    p = store.document;
  const player = useRef<PlayerHandle>(null),
    audioRequest = useRef(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]),
    [primarySelectedId, setPrimarySelectedId] = useState<string | null>(null),
    [selectionAnchor, setSelectionAnchor] = useState<string | null>(null),
    [time, setTime] = useState(0),
    [pendingTime, setPendingTime] = useState<number | null>(null);
  const [workspaceView, setWorkspaceView] = useState("blocks");
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [formationDancer, setFormationDancer] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [audioReady, setAudioReady] = useState(false),
    [loop, setLoop] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "lyrics" | "preview" | "export" | "projects" | "source" | "create" | null
  >(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [publishing, setPublishing] = useState(false),
    [publishProgress, setPublishProgress] = useState(0),
    [shares, setShares] = useState<ShareSummary[]>([]),
    [shareUrlFallback, setShareUrlFallback] = useState("");
  const currentBlock =
    p.blocks.find((b) => b.id === primarySelectedId) ??
    activeBlock(p.blocks, time);
  const currentLyric = activeLyric(p.blocks, time, p.audio?.duration ?? 0);
  const readOnly = store.conflict || busy;
  const fail = (message: string) => setError(message);
  const activeShare = shares.find((share) => share.projectId === p.id) ?? null;
  useEffect(() => {
    if (!error && !notice) return;
    const timer = setTimeout(() => {
      setError("");
      setNotice("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [error, notice]);
  useEffect(() => {
    if (!session.authenticated) {
      setShares([]);
      return;
    }
    let active = true;
    fetchShares()
      .then((value) => {
        if (active) setShares(value);
      })
      .catch(() => {
        // Local editing remains usable when the sharing service is unavailable.
      });
    return () => {
      active = false;
    };
  }, [session.authenticated]);
  useEffect(() => {
    if (!store.ready || !session.authenticated) return;
    const pending = sessionStorage.getItem("wota-publish-pending");
    if (pending !== p.id) return;
    sessionStorage.removeItem("wota-publish-pending");
    setModal("export");
    navigate("/", { replace: true });
  }, [p.id, session.authenticated, store.ready]);
  async function attempt(fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (e) {
      fail(e instanceof Error ? e.message : "操作失败，请重试。");
    }
  }
  useEffect(() => {
    setSelectedIds([]);
    setPrimarySelectedId(null);
    setSelectionAnchor(null);
    setMultiSelectMode(false);
    setFormationDancer(null);
    setLoop(null);
    setModal(null);
    audioRequest.current++;
  }, [p.id]);
  useEffect(() => {
    const valid = new Set(p.blocks.map((b) => b.id));
    const nextSelected = selectedIds.filter((id) => valid.has(id));
    if (nextSelected.length !== selectedIds.length)
      setSelectedIds(nextSelected);
    setPrimarySelectedId((id) =>
      id && valid.has(id) ? id : (nextSelected[0] ?? null),
    );
    setSelectionAnchor((id) => (id && valid.has(id) ? id : null));
  }, [p.blocks, selectedIds]);
  const selectSingle = (id: string | null) => {
    setSelectedIds((current) =>
      id && current.length === 1 && current[0] === id
        ? current
        : id
          ? [id]
          : [],
    );
    setPrimarySelectedId((current) => (current === id ? current : id));
    setSelectionAnchor((current) => (current === id ? current : id));
  };
  const selectBlock = (
    id: string,
    gesture: { additive?: boolean; range?: boolean } = {},
  ) => {
    const selectedBlock = p.blocks.find((b) => b.id === id);
    if (!selectedBlock) return;
    if (selectedBlock.start === null || selectedBlock.end === null) {
      selectSingle(id);
      return;
    }
    const ordered = p.blocks
      .map((b, index) => ({ b, index }))
      .filter(({ b }) => b.start !== null && b.end !== null)
      .sort((a, b) => a.b.start! - b.b.start! || a.index - b.index)
      .map(({ b }) => b);
    if (gesture.range && selectionAnchor) {
      const anchorIndex = ordered.findIndex((b) => b.id === selectionAnchor);
      const targetIndex = ordered.findIndex((b) => b.id === id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [from, to] = [anchorIndex, targetIndex].sort((a, b) => a - b);
        setSelectedIds(ordered.slice(from, to + 1).map((b) => b.id));
        setPrimarySelectedId(id);
        return;
      }
    }
    if (gesture.additive) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id];
      setSelectedIds(next);
      setPrimarySelectedId(next.includes(id) ? id : (next[0] ?? null));
      setSelectionAnchor(id);
      return;
    }
    selectSingle(id);
  };
  const deleteBlocks = (ids: string[]) => {
    const removeIds = new Set(ids);
    if (!removeIds.size) return;
    store.edit((d) => {
      d.blocks = d.blocks.filter((b) => !removeIds.has(b.id));
    });
    const remaining = selectedIds.filter((id) => !removeIds.has(id));
    setSelectedIds(remaining);
    setPrimarySelectedId((id) =>
      id && !removeIds.has(id) ? id : (remaining[0] ?? null),
    );
    setSelectionAnchor((id) =>
      id && !removeIds.has(id) ? id : (remaining[0] ?? null),
    );
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        document.querySelector("dialog[open]") ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        readOnly
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        store.travel(e.shiftKey ? "redo" : "undo");
      }
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedIds.length > 0 &&
        !(e.target as HTMLElement)?.closest(".formation-panel,.formation-track")
      ) {
        e.preventDefault();
        deleteBlocks(selectedIds);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [readOnly, selectedIds, p]);
  async function uploadAudio(file: File) {
    const request = ++audioRequest.current,
      projectId = p.id;
    setBusy(true);
    const url = URL.createObjectURL(file),
      probe = new Audio();
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("读取歌曲超时。")),
          15000,
        );
        probe.onloadedmetadata = () => {
          clearTimeout(timer);
          probe.duration > 0
            ? resolve(probe.duration)
            : reject(new Error("歌曲时长无效。"));
        };
        probe.onerror = () => {
          clearTimeout(timer);
          reject(new Error("无法读取歌曲。"));
        };
        probe.src = url;
      });
      if (
        request !== audioRequest.current ||
        store.latest.current.id !== projectId
      )
        return;
      const id = uid();
      await db.audio.put({ id, blob: file });
      player.current?.pause();
      setLoop(null);
      store.edit((d) => {
        d.audio = { id, name: file.name, duration };
        d.position = 0;
      }, false);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }
  async function importProject(file: File) {
    setBusy(true);
    try {
      let next: Project;
      if (/\.xlsx$/i.test(file.name)) {
        const { readXlsx } = await import("./core/xlsx");
        next = await readXlsx(await file.arrayBuffer());
      } else {
        next = parseProject(await file.text());
        next.id = uid();
        if (next.audio) next.audio.id = null;
      }
      player.current?.pause();
      await store.create(next);
      if (next.audio) setNotice("项目已导入，请重新选择歌曲。");
    } catch (e) {
      fail("导入失败：" + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copyShareUrl(url: string) {
    setShareUrlFallback("");
    try {
      await navigator.clipboard.writeText(url);
      setNotice("分享链接已复制。");
    } catch {
      setShareUrlFallback(url);
      setNotice("浏览器未允许自动复制，请使用下方链接手动复制。");
    }
  }
  async function publishOnline() {
    if (!session.authenticated || !session.user || !session.csrfToken) {
      sessionStorage.setItem("wota-publish-pending", p.id);
      login(`${location.pathname}?publish=1`);
      return;
    }
    if (!session.user.emailVerified) {
      fail("请先完成邮箱验证，再发布在线分享。");
      return;
    }
    if (!p.blocks.length) {
      fail("至少需要一个编排段落后才能发布。");
      return;
    }
    setPublishing(true);
    setPublishProgress(0);
    try {
      const record = p.audio?.id ? await db.audio.get(p.audio.id) : undefined;
      const audioMeta: ShareSnapshot["audio"] = record
        ? {
            name:
              record.blob instanceof File ? record.blob.name : p.audio!.name,
            duration: p.audio!.duration,
            mimeType: record.blob.type,
            sizeBytes: record.blob.size,
          }
        : activeShare?.audio
          ? { ...activeShare.audio }
          : null;
      const snapshot = createShareSnapshot(p, audioMeta);
      const updated = await uploadShare(
        {
          projectId: p.id,
          shareId: activeShare?.id,
          snapshot,
          audio: record
            ? {
                blob: record.blob,
                name:
                  record.blob instanceof File
                    ? record.blob.name
                    : p.audio!.name,
              }
            : undefined,
          preserveAudio: Boolean(activeShare?.audio && !record),
        },
        session.csrfToken,
        setPublishProgress,
      );
      setShares((current) => {
        const exists = current.some((share) => share.id === updated.id);
        return exists
          ? current.map((share) => (share.id === updated.id ? updated : share))
          : [...current, updated];
      });
      await copyShareUrl(updated.url);
      if (!record && !activeShare?.audio)
        setNotice("编排已发布；之后可在“我的分享”中补充云端音乐。");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "quota_exceeded")
        fail(`${cause.message} 可前往“我的分享”删除旧音乐。`);
      else fail(cause instanceof Error ? cause.message : "发布失败，请重试。");
    } finally {
      setPublishing(false);
    }
  }
  const updateRange = (id: string, patch: Partial<Block>) => {
    const b = p.blocks.find((x) => x.id === id);
    if (!b) return;
    const next = { ...b, ...patch };
    const err = intervalError(next, p.blocks, p.audio?.duration);
    if (err) {
      fail(err);
      return;
    }
    store.edit((d) =>
      Object.assign(
        d.blocks.find((x) => x.id === id)!,
        patch,
      ),
    );
    selectSingle(id);
  };
  const updateRanges = (
    ranges: Record<string, { start: number; end: number }>,
  ) => {
    const ids = Object.keys(ranges);
    if (!ids.length) return;
    const nextBlocks = p.blocks.map((b) =>
      ranges[b.id] ? { ...b, ...ranges[b.id] } : b,
    );
    const err = nextBlocks.reduce<string | null>((message, b) => {
      if (message || !ranges[b.id]) return message;
      return intervalError(b, nextBlocks, p.audio?.duration);
    }, null);
    if (err) {
      fail(err);
      return;
    }
    store.edit((d) => {
      for (const [id, range] of Object.entries(ranges)) {
        const target = d.blocks.find((b) => b.id === id);
        if (target) Object.assign(target, range);
      }
    });
  };
  if (!store.ready) return <main className="loading">正在打开编排工作台…</main>;
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Waves size={23} />
          </span>
          <span>
            Wota<span className="brand-dot">.</span>
            <small>编排工作台</small>
          </span>
        </a>
        <div className="header-divider" />
        <div className="project-heading">
          <Field
            label="歌曲名称"
            value={p.songName}
            disabled={readOnly}
            onCommit={(v) =>
              store.edit((d) => {
                d.songName = v || "未命名歌曲";
              })
            }
          />
          <span className="save-state" role="status">
            <span />
            {busy ? "处理中…" : store.status}
          </span>
        </div>
        <Field
          label="BPM"
          value={p.bpm}
          disabled={readOnly}
          onCommit={(v) =>
            store.edit((d) => {
              d.bpm = v;
            })
          }
        />
        <div className="header-history">
          {" "}
          <div className="toolbar">
            <button
              aria-label="撤销"
              disabled={!store.canUndo || readOnly}
              onClick={() => store.travel("undo")}
            >
              <Undo2 size={16} />
            </button>
            <button
              aria-label="重做"
              disabled={!store.canRedo || readOnly}
              onClick={() => store.travel("redo")}
            >
              <Redo2 size={16} />
            </button>
          </div>
        </div>
        <div className="source-status">
          <button disabled={readOnly} onClick={() => setModal("source")}>
            {p.lyricSource ? "编辑歌词" : "载入歌词"}
          </button>
          <button disabled={readOnly} onClick={() => setModal("lyrics")}>
            偏移 {p.lyricSource?.offset ?? 0}s
          </button>
        </div>
        <div className="header-actions">
          <button onClick={() => setModal("projects")}>
            <FolderOpen size={16} />
            项目
          </button>
          <button onClick={() => void attempt(() => store.create(project()))}>
            <Plus size={16} />
            新建
          </button>
          <label className="file-button">
            {" "}
            <Upload size={16} />
            打开
            <input
              aria-label="打开项目文件"
              type="file"
              accept=".xlsx,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importProject(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => setModal("preview")}
            disabled={!p.blocks.length}
          >
            <Eye size={16} />
            预览
          </button>
          <button className="primary" onClick={() => setModal("export")}>
            <Download size={16} />
            导出
          </button>
          {!sessionLoading && session.authenticated ? (
            <div className="account-actions">
              <Link to="/shares">我的分享</Link>
              {session.user?.isAdmin && <Link to="/admin">管理</Link>}
              <button onClick={logout}>退出</button>
            </div>
          ) : (
            !sessionLoading && <button onClick={() => login()}>登录</button>
          )}
        </div>
      </header>
      {(error || notice) && (
        <div
          className={"message toast " + (error ? "error" : "")}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
      {store.conflict && (
        <div className="conflict" role="alert">
          项目已在另一标签页更新。
          <button onClick={() => void attempt(store.copy)}>保留副本</button>
          <button onClick={() => void attempt(store.reload)}>重新载入</button>
        </div>
      )}
      <nav className="formation-tabs" aria-label="编辑视图">
        <button
          className={workspaceView === "blocks" ? "active" : ""}
          onClick={() => setWorkspaceView("blocks")}
        >
          段落
        </button>
        <button
          className={workspaceView === "formation" ? "active" : ""}
          onClick={() => setWorkspaceView("formation")}
        >
          队形
        </button>
      </nav>
      <main className="workbench">
        <div className={`upper-workspace view-${workspaceView}`}>
          <section className="editor-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">ARRANGEMENT</span>
                <h2>当前段落</h2>
              </div>
            </div>
            <fieldset disabled={readOnly}>
              <BlockEditor
                project={p}
                selected={currentBlock}
                edit={store.edit}
                onSeek={(t) => player.current?.seek(t, true)}
                onLoop={(id) => {
                  const b = p.blocks.find((x) => x.id === id);
                  if (b && b.start !== null)
                    player.current?.seek(b.start, true);
                  setLoop(id);
                }}
                onError={fail}
                looping={loop === currentBlock?.id}
                onLyricsImport={(rows) => {
                  if (rows.length)
                    store.edit((d) => {
                      const b = d.blocks.find(
                        (x) => x.id === primarySelectedId,
                      );
                      if (b)
                        b.lyrics = [
                          ...b.lyrics.filter(
                            (l) => l.jp || l.cn || l.time !== null,
                          ),
                          ...rows,
                        ];
                    });
                }}
                onOpenLyricsImport={() => setModal("lyrics")}
                activeLyricId={currentLyric?.id}
                audioReady={audioReady}
                time={time}
              />
            </fieldset>
          </section>
          <FormationCanvas
            key={p.id}
            project={p}
            edit={store.edit}
            readOnly={readOnly}
            getTime={() => (audioReady ? (player.current?.getTime() ?? 0) : 0)}
            pause={() => player.current?.pause()}
            onError={fail}
            onDancerSelect={setFormationDancer}
          />
        </div>
        <section className="timeline-panel">
          <Player
            key={p.id}
            ref={player}
            project={p}
            edit={store.edit}
            formationDancerId={formationDancer}
            loopId={loop}
            onLoop={setLoop}
            onTime={(position, playing) => {
              setTime(position);
              if (
                playing &&
                follow &&
                !document.querySelector("dialog[open]") &&
                !document.activeElement?.matches(
                  "input:not([type=range]):not([type=checkbox]),textarea,select",
                )
              ) {
                const active = activeBlock(
                  store.latest.current.blocks,
                  position,
                );
                selectSingle(active?.id ?? null);
              }
            }}
            onPersist={(position) => {
              if (Math.abs(store.latest.current.position - position) > 0.05)
                store.edit((d) => {
                  d.position = position;
                }, false);
            }}
            onError={fail}
            onNotice={setNotice}
            onUpload={(file) => void uploadAudio(file)}
            follow={follow}
            onFollow={setFollow}
            readOnly={readOnly}
            onReady={setAudioReady}
            selectedIds={selectedIds}
            primarySelectedId={primarySelectedId}
            multiSelectMode={multiSelectMode}
            onMultiSelectModeChange={setMultiSelectMode}
            onSelect={selectBlock}
            onInsert={(t) => {
              setPendingTime(t);
              setModal("create");
            }}
            onUpdateRange={updateRange}
            onUpdateRanges={updateRanges}
            onDelete={(id) => deleteBlocks([id])}
            onDeleteSelected={deleteBlocks}
            onCreate={() => {
              setPendingTime(null);
              setModal("create");
            }}
          />
        </section>
      </main>
      {(modal === "lyrics" || modal === "source") && (
        <LyricsImport
          source={p.lyricSource}
          startInLoader={modal === "source"}
          canImport={!!currentBlock && !readOnly}
          onSource={(source) =>
            store.edit((d) => {
              d.lyricSource = source;
            })
          }
          duration={p.audio?.duration}
          focusTime={currentBlock?.start}
          onClose={() => setModal(null)}
          onImport={(rows) => {
            if (currentBlock)
              store.edit((d) => {
                const b = d.blocks.find((x) => x.id === currentBlock.id);
                if (b)
                  b.lyrics = [
                    ...b.lyrics.filter(
                      (l) => (l.jp || l.cn) && l.jp !== "（纯动作/无歌词）",
                    ),
                    ...rows,
                  ];
              });
            setModal(null);
          }}
        />
      )}
      {modal === "preview" && (
        <Preview project={p} onClose={() => setModal(null)} />
      )}{" "}
      {modal === "export" && (
        <Modal title="导出" onClose={() => setModal(null)} wide>
          <div className="export-option online-share-option">
            <div className="export-option-heading">
              <div>
                <h3>在线分享</h3>
                <p>
                  {activeShare
                    ? `固定链接 · 版本 ${activeShare.revision} · ${
                        activeShare.audio
                          ? `云端音乐 ${formatBytes(activeShare.audio.sizeBytes)}`
                          : "未保存云端音乐"
                      }`
                    : "上传编排和歌曲，生成移动端可查看的只读链接。"}
                </p>
              </div>
              {activeShare && (
                <Link to="/shares" onClick={() => setModal(null)}>
                  管理分享
                </Link>
              )}
            </div>
            <div className="online-share-actions">
              <button
                className="primary"
                disabled={publishing || !p.blocks.length}
                onClick={() => void publishOnline()}
              >
                {publishing
                  ? `上传中 ${publishProgress}%`
                  : activeShare
                    ? "更新在线版本"
                    : session.authenticated
                      ? "发布并复制链接"
                      : "登录后发布并复制链接"}
              </button>
              {activeShare && (
                <button
                  disabled={publishing}
                  onClick={() => void copyShareUrl(activeShare.url)}
                >
                  复制共享链接
                </button>
              )}
            </div>
            {publishing && <progress max={100} value={publishProgress} />}
            {shareUrlFallback && (
              <input
                className="share-url-fallback"
                aria-label="共享链接"
                readOnly
                value={shareUrlFallback}
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
          </div>
          <div className="export-option">
            <h3>Excel 编排表</h3>
            <button
              className="primary"
              disabled={!p.blocks.length}
              onClick={() =>
                void attempt(async () => {
                  const { writeXlsx } = await import("./core/xlsx");
                  download(
                    await writeXlsx(p),
                    `${safeName(p.songName)}_编排表.xlsx`,
                    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
                  );
                  setModal(null);
                })
              }
            >
              下载 Excel
            </button>
          </div>
          <div className="export-option">
            <h3>项目 JSON</h3>
            <button
              onClick={() =>
                void attempt(() =>
                  download(
                    backup(store.latest.current),
                    `${safeName(p.songName)}.wota.json`,
                    `application/json`,
                  ),
                )
              }
            >
              下载 JSON 备份
            </button>
          </div>
          <BatonUsage project={p} />
        </Modal>
      )}
      {modal === "projects" && (
        <Modal title="项目" onClose={() => setModal(null)}>
          <div className="project-list">
            {store.projects.map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  void attempt(async () => {
                    await store.open(item.id);
                    setModal(null);
                  })
                }
              >
                <strong>{item.document.songName}</strong>
                <span>{item.document.blocks.length} 段</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "create" && (
        <CreateBlockModal
          time={pendingTime}
          bpm={p.bpm}
          blocks={p.blocks}
          duration={p.audio?.duration}
          onClose={() => setModal(null)}
          onCreate={(b, t) => {
            store.edit((d) => insertAt(d, b, t));
            selectSingle(b.id);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}
function CreateBlockModal({
  time,
  bpm,
  blocks,
  duration,
  onClose,
  onCreate,
}: {
  time: number | null;
  bpm: string;
  blocks: Block[];
  duration?: number;
  onClose: () => void;
  onCreate: (b: Block, t: number | null) => void;
}) {
  const [type, setType] = useState("副歌"),
    [beats, setBeats] = useState("8");
  let range = { start: time, end: null as number | null };
  let error = "";
  try {
    if (!/^\d+$/.test(beats) || Number(beats) <= 0)
      throw new Error("拍数必须是正整数。");
    range = insertionRange(time, beats, bpm, blocks, duration);
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <Modal title="新建段落" onClose={onClose}>
      <label className="field">
        <span>类型</span>
        <input
          list="section-types"
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
        <datalist id="section-types">
          {sectionTypes.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </label>
      <Field label="拍数" value={beats} onCommit={setBeats} />
      <p className="muted">
        起点 {formatTime(range.start)} · 出点 {formatTime(range.end)}
      </p>
      {time !== null &&
        range.end !== null &&
        range.end < time + (Number(beats) * 60) / Number(bpm) && (
          <p className="muted">空隙不足，出点取空隙末尾；拍数保持不变。</p>
        )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={!!error}
        onClick={() => {
          if (!/^\d+$/.test(beats) || Number(beats) <= 0) return;
          onCreate({ ...block(type, beats, true), ...range }, time);
        }}
      >
        创建
      </button>
    </Modal>
  );
}
