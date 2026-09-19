import {
  lyric,
  pureText,
  sections,
  type Block,
  type Project,
} from "../core/model";
import {
  formatTime,
  intervalError,
  playable,
  suggestedDuration,
} from "../core/timing";
import { Field } from "./Fields";
export function BlockEditor({
  project: p,
  selected: b,
  edit,
  time,
  onSeek,
  onLoop,
  onError,
  activeLyricId,
  audioReady,
}: {
  project: Project;
  selected?: Block;
  edit: (fn: (p: Project) => void) => void;
  time: () => number;
  onSeek: (t: number) => void;
  onLoop: (id: string) => void;
  onError: (s: string) => void;
  activeLyricId?: string;
  audioReady: boolean;
}) {
  if (!b)
    return (
      <div className="empty editor-empty">
        <span className="empty-symbol">✎</span>
        <h3>把每一拍写清楚</h3>
        <p>
          选择一个段落，编辑歌词、动作和时间。
          <br />
          还没有段落？从左侧歌词开始。
        </p>
      </div>
    );
  const update = (patch: Partial<Block>) =>
    edit((draft) => {
      Object.assign(
        draft.blocks.find((x) => x.id === b.id)!,
        patch,
      );
    });
  const setRange = (patch: Partial<Block>) => {
    const next = { ...b, ...patch };
    const error = intervalError(next, p.blocks, p.audio?.duration);
    if (error) onError(error);
    else update(patch);
  };
  const setLyricTime = (id: string, value: number | null) => {
    if (
      value !== null &&
      (!Number.isFinite(value) ||
        value < 0 ||
        (p.audio && value > p.audio.duration))
    ) {
      onError("歌词时间必须在歌曲范围内。");
      return;
    }
    update({
      lyrics: b.lyrics.map((l) => (l.id === id ? { ...l, time: value } : l)),
    });
  };
  const bpmDuration = suggestedDuration(p.bpm, b.beats);
  const rangeError = intervalError(b, p.blocks, p.audio?.duration);
  return (
    <>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DETAIL</span>
          <h2>段落编辑</h2>
        </div>
        <span className="badge">{b.type || "未命名"}</span>
      </div>
      <div className="editor-body" key={b.id}>
        <div className="two-fields">
          <Field
            label="段落类型"
            value={b.type}
            onCommit={(v) => update({ type: sections[v.toLowerCase()] ?? v })}
          />
          <Field
            label="拍数（八拍）"
            value={b.beats}
            onCommit={(v) => update({ beats: v })}
          />
        </div>
        <div className="preset-row">
          {Object.entries(sections).map(([code, name]) => (
            <button key={code} onClick={() => update({ type: name })}>
              {name}
            </button>
          ))}
        </div>
        <Field
          label="技 / 动作编排"
          multiline
          value={b.arrangement}
          onCommit={(v) => update({ arrangement: v })}
          placeholder="写下这一段的动作、衔接与变化…"
        />
        <Field
          label="备注"
          multiline
          value={b.remarks}
          onCommit={(v) => update({ remarks: v })}
          placeholder="队形、站位或需要留意的地方"
        />
        <section className="timing-section">
          <div className="section-title">
            <h3>歌曲对时</h3>
            <span className="muted">秒 · 手动优先</span>
          </div>
          <div className="two-fields">
            <Field
              label="开始时间（秒）"
              value={b.start === null ? "" : String(b.start)}
              onCommit={(v) => setRange({ start: v.trim() ? Number(v) : null })}
              placeholder="未设置"
            />
            <Field
              label="结束时间（秒）"
              value={b.end === null ? "" : String(b.end)}
              onCommit={(v) => setRange({ end: v.trim() ? Number(v) : null })}
              placeholder="未设置"
            />
          </div>
          <div className="toolbar">
            <button
              disabled={!audioReady}
              onClick={() => setRange({ start: time() })}
            >
              当前设为起点 [
            </button>
            <button
              disabled={!audioReady}
              onClick={() => setRange({ end: time() })}
            >
              当前设为终点 ]
            </button>
          </div>
          <div className="toolbar">
            <button
              disabled={b.start === null || bpmDuration === null}
              onClick={() =>
                setRange({
                  end: Math.round((b.start! + bpmDuration!) * 1000) / 1000,
                })
              }
            >
              采用 BPM 建议
              {bpmDuration !== null ? ` · ${bpmDuration.toFixed(2)}s` : ""}
            </button>
            <button
              onClick={() => {
                const index = p.blocks.findIndex((x) => x.id === b.id);
                const start = b.lyrics.find((l) => l.time !== null)?.time;
                const end = p.blocks[index + 1]?.lyrics.find(
                  (l) => l.time !== null,
                )?.time;
                if (start === undefined || start === null) {
                  onError("本段歌词没有时间戳，请手动设置起点。");
                  return;
                }
                setRange({
                  start,
                  ...(end !== undefined && end !== null ? { end } : {}),
                });
              }}
            >
              采用歌词时间
            </button>
          </div>
          {rangeError && <p className="error">{rangeError}</p>}
          <div className="toolbar">
            <button
              disabled={
                !audioReady || !playable(b, p.blocks, p.audio?.duration)
              }
              onClick={() => onSeek(b.start!)}
            >
              定位此段
            </button>
            <button
              disabled={
                !audioReady || !playable(b, p.blocks, p.audio?.duration)
              }
              onClick={() => onLoop(b.id)}
            >
              循环此段
            </button>
            <button onClick={() => update({ start: null, end: null })}>
              清除对时
            </button>
          </div>
        </section>
        <section>
          <div className="section-title">
            <h3>双语歌词</h3>
            <button
              onClick={() =>
                update({
                  lyrics:
                    b.lyrics.length === 1 && b.lyrics[0].jp === pureText
                      ? [lyric()]
                      : [...b.lyrics, lyric()],
                })
              }
            >
              ＋ 歌词行
            </button>
          </div>
          {b.lyrics.map((l, i) => (
            <div
              className={
                "lyric-edit " + (activeLyricId === l.id ? "is-playing" : "")
              }
              key={l.id}
            >
              <div className="lyric-meta">
                <span className="number">{String(i + 1).padStart(2, "0")}</span>
                <button
                  disabled={
                    !audioReady ||
                    l.time === null ||
                    !p.audio ||
                    l.time < 0 ||
                    l.time > p.audio.duration
                  }
                  onClick={() => onSeek(l.time!)}
                >
                  {formatTime(l.time)}
                </button>
                <button
                  aria-label={`在歌词${i + 1}前插入`}
                  onClick={() => {
                    const rows = [...b.lyrics];
                    rows.splice(i, 0, lyric());
                    update({ lyrics: rows });
                  }}
                >
                  插入
                </button>
                <button
                  aria-label={`删除歌词${i + 1}`}
                  onClick={() => {
                    const rest = b.lyrics.filter((x) => x.id !== l.id);
                    update({
                      lyrics: rest.length ? rest : [lyric(pureText, pureText)],
                    });
                  }}
                >
                  删除
                </button>
              </div>
              <Field
                label={`日文 ${i + 1}`}
                value={l.jp}
                onCommit={(v) =>
                  update({
                    lyrics: b.lyrics.map((x) =>
                      x.id === l.id ? { ...x, jp: v } : x,
                    ),
                  })
                }
              />
              <Field
                label={`中文 ${i + 1}`}
                value={l.cn}
                onCommit={(v) =>
                  update({
                    lyrics: b.lyrics.map((x) =>
                      x.id === l.id ? { ...x, cn: v } : x,
                    ),
                  })
                }
              />
              <div className="two-fields">
                <Field
                  label={`歌词起点 ${i + 1}（秒）`}
                  value={l.time === null ? "" : String(l.time)}
                  onCommit={(v) =>
                    setLyricTime(l.id, v.trim() ? Number(v) : null)
                  }
                />
                <button
                  className="align-bottom"
                  disabled={!audioReady}
                  onClick={() => setLyricTime(l.id, time())}
                >
                  当前打点
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
