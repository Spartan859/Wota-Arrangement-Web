import { FormationCanvas } from "./components/FormationCanvas";
import { useEffect, useRef, useState } from "react";
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
  removeBlock,
  sectionTypes,
  uid,
  type Block,
  type Lyric,
  type Project,
} from "./core/model";
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

export default function App() {
  const store = useProject(),
    p = store.document;
  const player = useRef<PlayerHandle>(null),
    audioRequest = useRef(0);
  const [selected, setSelected] = useState<string | null>(null),
    [time, setTime] = useState(0),
    [pendingTime, setPendingTime] = useState<number | null>(null);
  const [workspaceView, setWorkspaceView] = useState("blocks");
  const [follow, setFollow] = useState(true);
  const [audioReady, setAudioReady] = useState(false),
    [loop, setLoop] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "lyrics" | "preview" | "export" | "projects" | "source" | "create" | null
  >(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const currentBlock =
    p.blocks.find((b) => b.id === selected) ?? activeBlock(p.blocks, time);
  const currentLyric = activeLyric(p.blocks, time, p.audio?.duration ?? 0);
  const readOnly = store.conflict || busy;
  const fail = (message: string) => setError(message);
  useEffect(() => {
    if (!error && !notice) return;
    const timer = setTimeout(() => {
      setError("");
      setNotice("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [error, notice]);
  async function attempt(fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (e) {
      fail(e instanceof Error ? e.message : "操作失败，请重试。");
    }
  }
  useEffect(() => {
    setSelected(null);
    setLoop(null);
    setModal(null);
    audioRequest.current++;
  }, [p.id]);
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
        e.key === "Delete" &&
        selected &&
        !(e.target as HTMLElement)?.closest(".formation-panel,.formation-track")
      ) {
        e.preventDefault();
        store.edit((d) => removeBlock(d, selected));
        setSelected(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [readOnly, selected, p]);
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
    setSelected(id);
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
            {p.lyricSource?.name || "载入 LRC"}
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
                onLyricsImport={(rows) => {
                  if (rows.length)
                    store.edit((d) => {
                      const b = d.blocks.find((x) => x.id === selected);
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
          />
        </div>
        <section className="timeline-panel">
          <Player
            key={p.id}
            ref={player}
            project={p}
            edit={store.edit}
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
                setSelected(active?.id ?? null);
              }
            }}
            onPersist={(position) => {
              if (Math.abs(store.latest.current.position - position) > 0.05)
                store.edit((d) => {
                  d.position = position;
                }, false);
            }}
            onError={fail}
            onUpload={(file) => void uploadAudio(file)}
            follow={follow}
            onFollow={setFollow}
            readOnly={readOnly}
            onReady={setAudioReady}
            selectedId={selected}
            onSelect={(id) => setSelected(id)}
            onInsert={(t) => {
              setPendingTime(t);
              setModal("create");
            }}
            onUpdateRange={updateRange}
            onDelete={(id) => {
              store.edit((d) => removeBlock(d, id));
              if (selected === id) setSelected(null);
            }}
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
        <Modal title="导出" onClose={() => setModal(null)}>
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
                download(
                  backup(p),
                  `${safeName(p.songName)}.wota.json`,
                  `application/json`,
                )
              }
            >
              下载 JSON 备份
            </button>
          </div>
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
            setSelected(b.id);
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
