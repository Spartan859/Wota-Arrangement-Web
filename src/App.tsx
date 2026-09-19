import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FolderOpen,
  GripVertical,
  Layers3,
  Plus,
  Redo2,
  Undo2,
  Upload,
  Waves,
} from "lucide-react";
import {
  backup,
  block,
  collect,
  insert,
  move,
  pack,
  parseProject,
  project,
  sections,
  uid,
  type Project,
} from "./core/model";
import { db, download, safeName } from "./core/storage";
import {
  activeBlock,
  activeLyric,
  formatTime,
  intervalError,
  orderConflict,
  playable,
} from "./core/timing";
import { shifted } from "./core/lyrics";
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
    drag = useRef<string | null>(null),
    audioRequest = useRef(0);
  const [audioReady, setAudioReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [chosen, setChosen] = useState<string[]>([]),
    [type, setType] = useState("副歌"),
    [beats, setBeats] = useState("8");
  const [modal, setModal] = useState<
      "lyrics" | "preview" | "export" | "projects" | "shift" | null
    >(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("blocks"),
    [follow, setFollow] = useState(true),
    [time, setTime] = useState(0),
    [loop, setLoop] = useState<string | null>(null),
    [offset, setOffset] = useState("0");
  const currentBlock = p.blocks.find((b) => b.id === selected),
    active = activeBlock(p.blocks, time),
    currentLyric = activeLyric(p.blocks, time, p.audio?.duration ?? 0);
  const pending = p.pool.filter((l) => l.status === "pending"),
    staged = p.staging.map((id) => p.pool.find((l) => l.id === id)!);
  const readOnly = store.conflict || busy;
  const fail = (message: string) => setError(message);
  async function attempt(fn: () => void | Promise<void>) {
    try {
      await fn();
    } catch (e) {
      fail(e instanceof Error ? e.message : "操作失败，请重试。");
    }
  }
  useEffect(() => {
    setSelected(null);
    setChosen([]);
    setLoop(null);
    setModal(null);
    audioRequest.current++;
  }, [p.id]);
  useEffect(() => {
    if (
      follow &&
      active &&
      !document.activeElement?.matches("input, textarea, select")
    ) {
      const card = document.getElementById(`block-${active.id}`);
      const container = card?.closest(".blocks-scroll");
      if (card && container) {
        const box = card.getBoundingClientRect(),
          viewport = container.getBoundingClientRect();
        if (box.top < viewport.top || box.bottom > viewport.bottom)
          container.scrollTop += box.top - viewport.top - 12;
      }
    }
  }, [active?.id, follow]);
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
        (e.key === "[" || e.key === "]") &&
        currentBlock &&
        p.audio &&
        audioReady
      ) {
        e.preventDefault();
        const patch =
          e.key === "["
            ? { start: player.current?.getTime() ?? 0 }
            : { end: player.current?.getTime() ?? 0 };
        const candidate = { ...currentBlock, ...patch };
        const err = intervalError(candidate, p.blocks, p.audio.duration);
        if (err) fail(err);
        else
          store.edit((draft) =>
            Object.assign(
              draft.blocks.find((b) => b.id === currentBlock.id)!,
              patch,
            ),
          );
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [p, selected, readOnly, audioReady]);
  async function uploadAudio(file: File) {
    const request = ++audioRequest.current,
      projectId = p.id;
    setBusy(true);
    setError("");
    const url = URL.createObjectURL(file),
      probe = new Audio();
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("读取歌曲超时，请换一个文件重试。")),
          15000,
        );
        probe.onloadedmetadata = () => {
          clearTimeout(timer);
          Number.isFinite(probe.duration) && probe.duration > 0
            ? resolve(probe.duration)
            : reject(new Error("歌曲时长无效。"));
        };
        probe.onerror = () => {
          clearTimeout(timer);
          reject(
            new Error(
              "无法读取歌曲，请选择浏览器支持的 MP3、WAV 或 AAC 文件。",
            ),
          );
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
      if (
        request !== audioRequest.current ||
        store.latest.current.id !== projectId
      )
        return;
      player.current?.pause();
      setLoop(null);
      const previous = store.latest.current.audio;
      if (previous && Math.abs(previous.duration - duration) > 0.5)
        setNotice(
          "新歌曲时长不同，时间标记已保留。请检查对时，越界段落不能定位或循环。",
        );
      store.edit((draft) => {
        draft.audio = { id, name: file.name, duration };
        draft.position = 0;
      }, false);
    } catch (e) {
      fail(
        (e as Error).message.includes("歌曲")
          ? (e as Error).message
          : "无法保存音频到浏览器，原项目仍然保留。请检查存储空间。",
      );
    } finally {
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  }
  async function importProject(file: File) {
    setBusy(true);
    setError("");
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
      if (next.audio) setNotice("项目时间标记已导入，请重新选择本地歌曲。");
    } catch (e) {
      fail("导入失败：" + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const addBlock = (pure = false) => {
    const b = block(type.trim() || "副歌", beats.trim() || "8", pure);
    store.edit((draft) => insert(draft, b));
    setSelected(b.id);
    setTab("edit");
  };
  const doPack = () => {
    let id = "";
    store.edit((draft) => {
      id = pack(draft, type.trim() || "副歌", beats.trim() || "8");
    });
    setSelected(id);
    setChosen([]);
    setTab("blocks");
  };
  const seek = (t: number) => player.current?.seek(t, true);
  if (!store.ready) return <main className="loading">正在打开编排工作台…</main>;
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Wota 编排工作台">
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
          <span
            className={
              "save-state " +
              (store.status.includes("失败") || store.conflict ? "warning" : "")
            }
            role="status"
          >
            <span /> {busy ? "正在处理文件…" : store.status}
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
        <div className="header-actions">
          <button onClick={() => setModal("projects")} disabled={busy}>
            <FolderOpen size={16} />
            项目
          </button>
          <button
            onClick={() => {
              player.current?.pause();
              void attempt(() => store.create(project()));
            }}
            disabled={readOnly}
          >
            <Plus size={16} />
            新建
          </button>
          <label className={"file-button " + (readOnly ? "disabled" : "")}>
            <Upload size={16} />
            打开
            <input
              aria-label="打开项目文件"
              type="file"
              accept=".xlsx,.json"
              disabled={readOnly}
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
      <div className="workspace-bar">
        <div>
          <span className="workspace-title">编排，让每一拍有迹可循。</span>
          <span className="muted desktop-only">
            从歌词开始，跟随歌曲完成动作。
          </span>
        </div>
        <div className="toolbar">
          <button
            aria-label="撤销"
            title="撤销 ⌘/Ctrl Z"
            disabled={!store.canUndo || readOnly}
            onClick={() => store.travel("undo")}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="重做"
            title="重做 ⌘/Ctrl Shift Z"
            disabled={!store.canRedo || readOnly}
            onClick={() => store.travel("redo")}
          >
            <Redo2 size={16} />
          </button>
          <button
            onClick={() => {
              setOffset("0");
              setModal("shift");
            }}
            disabled={readOnly}
          >
            歌词时间偏移
          </button>
        </div>
      </div>
      {(error || notice) && (
        <div
          className={"message " + (error ? "error" : "")}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            aria-label="关闭提示"
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
          <span>此项目已在另一标签页更新。编辑已暂停，避免覆盖。</span>
          <button onClick={() => void attempt(store.copy)}>保留为副本</button>
          <button
            onClick={() => {
              if (
                confirm(
                  "重新载入会放弃当前标签页尚未保存的修改。请先下载 JSON 或保留副本。继续？",
                )
              ) {
                player.current?.pause();
                void attempt(store.reload);
              }
            }}
          >
            重新载入
          </button>
        </div>
      )}
      <nav className="mobile-tabs" aria-label="工作区">
        <button
          className={tab === "lyrics" ? "active" : ""}
          onClick={() => setTab("lyrics")}
        >
          歌词
        </button>
        <button
          className={tab === "blocks" ? "active" : ""}
          onClick={() => setTab("blocks")}
        >
          段落
        </button>
        <button
          className={tab === "edit" ? "active" : ""}
          onClick={() => setTab("edit")}
        >
          编辑
        </button>
      </nav>
      <main className={"workspace tab-" + tab}>
        <section className="panel lyrics-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LYRICS</span>
              <h2>
                歌词池 <span className="count">{pending.length}</span>
              </h2>
            </div>
            <button
              aria-label="导入歌词"
              disabled={readOnly}
              onClick={() => setModal("lyrics")}
            >
              <Plus size={17} />
            </button>
          </div>
          <fieldset disabled={readOnly} className="panel-content">
            <div className="lyrics-scroll">
              {!p.pool.length ? (
                <div className="empty">
                  <span className="empty-symbol">あ</span>
                  <h3>从第一句开始</h3>
                  <p>
                    导入双语歌词，挑选句子，
                    <br />
                    把它们编成一个个段落。
                  </p>
                  <button
                    className="primary"
                    onClick={() => setModal("lyrics")}
                  >
                    导入 TXT / LRC
                  </button>
                  <small>歌词和歌曲始终留在此浏览器</small>
                </div>
              ) : (
                <>
                  <div className="section-title">
                    <span className="muted">
                      待处理 {pending.length} / {p.pool.length}
                    </span>
                    <button
                      disabled={!pending.length}
                      onClick={() =>
                        setChosen(
                          chosen.length === pending.length
                            ? []
                            : pending.map((l) => l.id),
                        )
                      }
                    >
                      全选
                    </button>
                  </div>
                  {pending.map((l, i) => (
                    <label
                      className={
                        "lyric-card " + (chosen.includes(l.id) ? "chosen" : "")
                      }
                      key={l.id}
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(l.id)}
                        onChange={(e) =>
                          setChosen(
                            e.target.checked
                              ? [...chosen, l.id]
                              : chosen.filter((id) => id !== l.id),
                          )
                        }
                      />
                      <div>
                        <div className="lyric-topline">
                          <span className="number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="timestamp">
                            {formatTime(l.time)}
                          </span>
                        </div>
                        <p lang="ja">{l.jp || "（无日文）"}</p>
                        <small>{l.cn || "（无译文）"}</small>
                      </div>
                    </label>
                  ))}
                  {!pending.length && (
                    <p className="empty-small">歌词已处理完，可以继续追加。</p>
                  )}
                </>
              )}
            </div>
            <div className="pool-actions">
              <button
                disabled={!pending.length}
                onClick={() => {
                  const ids = chosen.length ? chosen : [pending[0].id];
                  store.edit((d) => collect(d, ids));
                  setChosen([]);
                }}
              >
                收纳{chosen.length ? ` ${chosen.length} 句` : "当前句"}
              </button>
              <button
                disabled={!pending.length}
                onClick={() => {
                  const ids = chosen.length ? chosen : [pending[0].id];
                  store.edit((d) => {
                    for (const l of d.pool)
                      if (ids.includes(l.id) && l.status === "pending")
                        l.status = "skipped";
                  });
                  setChosen([]);
                }}
              >
                跳过
              </button>
              <button
                disabled={!p.pool.some((l) => l.status === "skipped")}
                onClick={() =>
                  store.edit((d) => {
                    for (const l of d.pool)
                      if (l.status === "skipped") l.status = "pending";
                  })
                }
              >
                恢复跳过
              </button>
            </div>
            <div className="staging">
              <div className="section-title">
                <h3>暂存区</h3>
                <span className="badge">{staged.length} 句</span>
              </div>
              <div className="staged-list">
                {staged.length ? (
                  staged.map((l) => (
                    <div key={l.id}>
                      <span>{l.jp || l.cn}</span>
                      <button
                        aria-label={`移出暂存 ${l.jp}`}
                        onClick={() =>
                          store.edit((d) => {
                            d.pool.find((x) => x.id === l.id)!.status =
                              "pending";
                            d.staging = d.staging.filter((id) => id !== l.id);
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="muted">收纳歌词后打包，也可创建空段落。</p>
                )}
              </div>
              <div className="two-fields">
                <label className="field">
                  <span>类型</span>
                  <input
                    aria-label="打包类型"
                    list="section-types"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  />
                  <datalist id="section-types">
                    {Object.values(sections).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </label>
                <label className="field">
                  <span>八拍数</span>
                  <input
                    aria-label="打包拍数"
                    value={beats}
                    onChange={(e) => setBeats(e.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                <span>插入位置</span>
                <select
                  aria-label="插入位置"
                  value={p.insertionAfter ?? ""}
                  onChange={(e) =>
                    store.edit((d) => {
                      d.insertionAfter = e.target.value || null;
                    })
                  }
                >
                  <option value="">末尾</option>
                  <option value="start">最前面</option>
                  {p.blocks.map((b, i) => (
                    <option key={b.id} value={b.id}>
                      {i + 1}. {b.type} 之后
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary full" onClick={doPack}>
                打包为段落 <span>→</span>
              </button>
            </div>
          </fieldset>
        </section>
        <section className="panel blocks-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ARRANGEMENT</span>
              <h2>
                段落编排 <span className="count">{p.blocks.length}</span>
              </h2>
            </div>
            <Layers3 size={19} className="muted" />
          </div>
          <fieldset disabled={readOnly} className="panel-content">
            <div className="block-tools">
              <button onClick={() => addBlock(false)}>
                <Plus size={14} />
                空段落
              </button>
              <button onClick={() => addBlock(true)}>＋ 纯动作</button>
            </div>
            {orderConflict(p.blocks) && (
              <p className="notice">
                段落顺序与歌曲时间不同，请检查对时；拖动排序不会改变时间。
              </p>
            )}
            <div className="blocks-scroll">
              {!p.blocks.length ? (
                <div className="empty arrangement-empty">
                  <div className="empty-bars">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <h3>你的编排，从这里展开</h3>
                  <p>
                    把左侧歌词收纳并打包，
                    <br />
                    或添加一段前奏、间奏与纯动作。
                  </p>
                  <button onClick={() => addBlock(true)}>
                    ＋ 添加纯动作段落
                  </button>
                </div>
              ) : (
                p.blocks.map((b, i) => (
                  <article
                    id={`block-${b.id}`}
                    data-testid="block-card"
                    key={b.id}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      drag.current = b.id;
                      e.dataTransfer.setData("text/plain", b.id);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (readOnly) return;
                      const from = p.blocks.findIndex(
                        (x) => x.id === drag.current,
                      );
                      store.edit((d) => move(d, from, i));
                      drag.current = null;
                    }}
                    className={`block-card tone-${i % 4} ${selected === b.id ? "selected" : ""} ${active?.id === b.id ? "is-playing" : ""}`}
                  >
                    <button
                      className="block-select"
                      aria-label={`编辑段落 ${i + 1} ${b.type}`}
                      onClick={() => {
                        setSelected(b.id);
                        setTab("edit");
                      }}
                    >
                      <div className="block-top">
                        <span className="block-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <strong>{b.type || "未命名"}</strong>
                        <span className="beats">
                          {b.beats || "—"} <small>× 8 拍</small>
                        </span>
                      </div>
                      <p className="block-lyric" lang="ja">
                        {b.lyrics[0]?.jp || "歌词留空"}
                      </p>
                      <p className="muted block-cn">
                        {b.lyrics[0]?.cn || "添加歌词与动作，让编排更完整"}
                      </p>
                      {b.arrangement && (
                        <p className="arrangement-summary">{b.arrangement}</p>
                      )}
                    </button>
                    <div className="block-bottom">
                      <button
                        className="time-button"
                        disabled={
                          !audioReady ||
                          !playable(b, p.blocks, p.audio?.duration)
                        }
                        onClick={() => seek(b.start!)}
                      >
                        {b.start !== null
                          ? `${formatTime(b.start)} — ${formatTime(b.end)}`
                          : "尚未对时"}
                      </button>
                      <span className="muted">{b.lyrics.length} 句</span>
                      <div className="block-actions">
                        <GripVertical size={14} />
                        <button
                          aria-label={`上移段落${i + 1}`}
                          disabled={i === 0}
                          onClick={() => store.edit((d) => move(d, i, i - 1))}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          aria-label={`下移段落${i + 1}`}
                          disabled={i === p.blocks.length - 1}
                          onClick={() => store.edit((d) => move(d, i, i + 1))}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          aria-label={`删除段落${i + 1}`}
                          onClick={() => {
                            store.edit((d) => {
                              d.blocks = d.blocks.filter((x) => x.id !== b.id);
                              if (d.insertionAfter === b.id)
                                d.insertionAfter = null;
                            });
                            if (loop === b.id) setLoop(null);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {intervalError(b, p.blocks, p.audio?.duration) && (
                      <p className="error block-warning">
                        时间无效，请在编辑面板修正
                      </p>
                    )}
                  </article>
                ))
              )}
            </div>
            <div className="blocks-footer">
              <span>{p.blocks.length} 个段落</span>
              <span>
                {
                  p.blocks.filter(
                    (b) =>
                      b.start !== null &&
                      b.end !== null &&
                      !intervalError(b, p.blocks, p.audio?.duration),
                  ).length
                }{" "}
                个已对时
              </span>
            </div>
          </fieldset>
        </section>
        <section className="panel editor-panel">
          <fieldset disabled={readOnly} className="panel-content">
            <BlockEditor
              project={p}
              selected={currentBlock}
              edit={store.edit}
              time={() => player.current?.getTime() ?? 0}
              onSeek={seek}
              onLoop={(id) => {
                const b = p.blocks.find((b) => b.id === id)!;
                player.current?.seek(b.start!, true);
                setLoop(id);
              }}
              onError={fail}
              activeLyricId={currentLyric?.id}
              audioReady={audioReady}
            />
          </fieldset>
        </section>
      </main>
      <Player
        key={p.id}
        ref={player}
        project={p}
        loopId={loop}
        onLoop={setLoop}
        onTime={setTime}
        onPersist={(position) => {
          if (
            store.latest.current.id !== p.id ||
            store.latest.current.audio?.id !== p.audio?.id
          )
            return;
          if (Math.abs(store.latest.current.position - position) > 0.05) {
            store.edit((d) => {
              d.position = position;
            }, false);
            if (document.visibilityState === "hidden") void store.flush();
          }
        }}
        onError={fail}
        onUpload={(file) => void uploadAudio(file)}
        follow={follow}
        onFollow={setFollow}
        readOnly={readOnly}
        onReady={setAudioReady}
      />
      {modal === "lyrics" && (
        <LyricsImport
          duration={p.audio?.duration}
          onClose={() => setModal(null)}
          onImport={(rows) => {
            store.edit((d) => {
              d.pool.push(
                ...rows.map((l) => ({ ...l, status: "pending" as const })),
              );
            });
            setModal(null);
            setTab("lyrics");
          }}
        />
      )}
      {modal === "preview" && (
        <Preview project={p} onClose={() => setModal(null)} />
      )}
      {modal === "export" && (
        <Modal title="保存你的编排" onClose={() => setModal(null)}>
          <p>Excel 适合排练与分享；JSON 用于继续编辑和保留歌曲对时。</p>
          <div className="export-option">
            <h3>Excel 编排表</h3>
            <p className="muted">
              仅导出已编排的 {p.blocks.length} 个段落。暂存 {staged.length}{" "}
              句、未处理 {pending.length} 句和所有时间标记不会包含在内。
            </p>
            <button
              className="primary"
              disabled={!p.blocks.length || busy}
              onClick={() =>
                void attempt(async () => {
                  setBusy(true);
                  try {
                    const { writeXlsx } = await import("./core/xlsx");
                    download(
                      await writeXlsx(store.latest.current),
                      `${safeName(p.songName)}_编排表.xlsx`,
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    );
                    setModal(null);
                  } finally {
                    setBusy(false);
                  }
                })
              }
            >
              下载 Excel
            </button>
          </div>
          <div className="export-option">
            <h3>完整项目 JSON</h3>
            <p className="muted">
              包含歌词池、段落和同步信息，不包含歌曲文件。换浏览器后需要重新选择本地歌曲。
            </p>
            <button
              onClick={() =>
                download(
                  backup(store.latest.current),
                  `${safeName(p.songName)}.wota.json`,
                  "application/json",
                )
              }
            >
              下载 JSON 备份
            </button>
          </div>
        </Modal>
      )}
      {modal === "projects" && (
        <Modal title="此浏览器中的项目" onClose={() => setModal(null)}>
          <p className="muted">
            草稿和音频保存在当前站点，请定期下载 JSON 备份。
          </p>
          <div className="project-list">
            {store.projects.map((item) => (
              <button
                key={item.id}
                disabled={store.conflict}
                onClick={() => {
                  player.current?.pause();
                  void attempt(async () => {
                    await store.open(item.id);
                    setModal(null);
                  });
                }}
              >
                <strong>{item.document.songName}</strong>
                <span>
                  {item.document.blocks.length} 段 ·{" "}
                  {new Date(item.document.updatedAt).toLocaleString("zh-CN")}
                </span>
                {item.id === p.id && <small>当前</small>}
              </button>
            ))}
          </div>
          <button
            onClick={() =>
              void attempt(async () => {
                await store.copy();
                setModal(null);
              })
            }
          >
            将当前项目保存为副本
          </button>
        </Modal>
      )}
      {modal === "shift" && (
        <Modal title="整体调整歌词时间" onClose={() => setModal(null)}>
          <p>
            调整歌词池与已编排歌词的起点，段落起止时间保持原值。正数延后，负数提前。
          </p>
          <label className="field">
            <span>偏移秒数</span>
            <input
              aria-label="整体偏移秒数"
              type="number"
              step="0.1"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
          <div className="shift-preview">
            {p.blocks
              .flatMap((b) => b.lyrics)
              .filter((l) => l.time !== null)
              .slice(0, 4)
              .map((l) => (
                <p key={l.id}>
                  {formatTime(l.time)} → {formatTime(l.time! + Number(offset))}{" "}
                  <span>{l.jp}</span>
                </p>
              ))}
          </div>
          <button
            className="primary"
            onClick={() =>
              void attempt(() => {
                const delta = Number(offset);
                const blocks = p.blocks.map((b) => ({
                  ...b,
                  lyrics: shifted(b.lyrics, delta, p.audio?.duration),
                }));
                const pool = shifted(p.pool, delta, p.audio?.duration);
                store.edit((d) => {
                  d.blocks = blocks;
                  d.pool = d.pool.map((l, i) => ({ ...l, time: pool[i].time }));
                });
                setModal(null);
              })
            }
          >
            确认应用偏移
          </button>
        </Modal>
      )}
    </div>
  );
}
