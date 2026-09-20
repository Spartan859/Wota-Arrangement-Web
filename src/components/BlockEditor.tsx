import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import {
  lyric,
  pureText,
  sectionTypes,
  type Block,
  type Lyric,
  type Project,
} from "../core/model";
import {
  formatTime,
  intervalError,
  playable,
  suggestedDuration,
} from "../core/timing";
import { Field, Modal } from "./Fields";

type Props = {
  project: Project;
  selected?: Block;
  edit: (fn: (p: Project) => void) => void;
  onSeek: (t: number) => void;
  onLoop: (id: string) => void;
  onError: (s: string) => void;
  onLyricsImport: (rows: Lyric[]) => void;
  onOpenLyricsImport?: () => void;
  activeLyricId?: string;
  audioReady: boolean;
  time: number;
};
export function BlockEditor({
  project: p,
  selected: b,
  edit,
  onSeek,
  onLoop,
  onError,
  onLyricsImport,
  onOpenLyricsImport,
  activeLyricId,
  audioReady,
  time,
}: Props) {
  const [modal, setModal] = useState<
    "type" | "lyrics" | "arrangement" | "remarks" | null
  >(null);
  const update = (patch: Partial<Block>) =>
    edit((draft) =>
      Object.assign(
        draft.blocks.find((x) => x.id === b?.id)!,
        patch,
      ),
    );
  const rangeError = b ? intervalError(b, p.blocks, p.audio?.duration) : null;
  const beatCount = Math.max(1, Number.parseInt(b?.beats ?? "0", 10) || 1);
  const beatDuration = Number(p.bpm) > 0 ? 60 / Number(p.bpm) : 0;
  const currentBeat =
    b?.start !== null && b?.start !== undefined && time >= b.start
      ? Math.floor((time - b.start) / beatDuration)
      : -1;
  const rows = useMemo(
    () => b?.lyrics.filter((l) => l.jp || l.cn || l.time !== null) ?? [],
    [b],
  );
  if (!b)
    return (
      <div className="editor-card empty">
        <h2>选择或新建段落</h2>
        <p>在下方时间轴点击空白处开始。</p>
      </div>
    );
  return (
    <div className="editor-card" data-testid="editor-card">
      <div className="editor-card-head">
        <div>
          <span className="eyebrow">CURRENT BLOCK</span>
          <div className="block-title-row">
            <h2>{b.type || "未命名"}</h2>
            <span className="block-beat-count">{b.beats} 拍</span>
            <button
              aria-label="编辑类型与拍数"
              title="编辑类型与拍数"
              onClick={() => setModal("type")}
            >
              <Pencil size={19} />
            </button>
          </div>
        </div>
        <div className="beat-grid" aria-label={`${b.beats} 拍`}>
          {Array.from({ length: Math.ceil(beatCount / 8) }, (_, row) => (
            <div className="beat-row" key={row}>
              {Array.from(
                { length: Math.min(8, beatCount - row * 8) },
                (_, col) => {
                  const index = row * 8 + col;
                  return (
                    <i
                      key={index}
                      className={index === currentBeat ? "lit" : ""}
                      aria-label={`第${index + 1}拍`}
                    />
                  );
                },
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="editor-card-main">
        <button
          className="edit-surface arrangement-surface"
          onClick={() => setModal("arrangement")}
        >
          <span>技 / 动作编排</span>
          <strong>{b.arrangement || "点击填写动作编排"}</strong>
        </button>
        <div className="editor-summary-grid">
          <button className="edit-surface" onClick={() => setModal("lyrics")}>
            <span>双语歌词</span>
            <strong>
              {rows.length
                ? rows.map((l) => l.jp || l.cn).join(" / ")
                : "点击添加歌词"}
            </strong>
          </button>
          <button className="edit-surface" onClick={() => setModal("remarks")}>
            <span>备注</span>
            <strong>{b.remarks || "点击添加备注"}</strong>
          </button>
        </div>
        <div className="editor-time-row">
          <button
            onClick={() => b.start !== null && onSeek(b.start)}
            disabled={!audioReady || !playable(b, p.blocks, p.audio?.duration)}
          >
            {b.start === null
              ? "未排时"
              : `${formatTime(b.start)} — ${formatTime(b.end)}`}
          </button>
          <button
            disabled={!audioReady || !playable(b, p.blocks, p.audio?.duration)}
            onClick={() => onLoop(b.id)}
          >
            循环
          </button>
          {rangeError && <span className="error">{rangeError}</span>}
        </div>
      </div>
      {modal === "type" && (
        <Modal title="段落类型与拍数" onClose={() => setModal(null)}>
          <Field
            label="段落类型"
            value={b.type}
            onCommit={(v) => update({ type: v })}
          />
          <div className="preset-row">
            {sectionTypes.map((name) => (
              <button key={name} onClick={() => update({ type: name })}>
                {name}
              </button>
            ))}
          </div>
          <Field
            label="拍数"
            value={b.beats}
            onCommit={(v) => {
              if (!/^\d+$/.test(v) || Number(v) <= 0) {
                onError("拍数必须是正整数。");
                return;
              }
              update({ beats: v });
            }}
          />
          <p className="muted">
            BPM 建议时长：{suggestedDuration(p.bpm, b.beats)?.toFixed(2) ?? "—"}{" "}
            秒
          </p>
          <button className="primary" onClick={() => setModal(null)}>
            完成
          </button>
        </Modal>
      )}
      {modal === "arrangement" && (
        <Modal title="技 / 动作编排" onClose={() => setModal(null)}>
          <Field
            label="技 / 动作编排"
            multiline
            value={b.arrangement}
            onCommit={(v) => update({ arrangement: v })}
            placeholder="动作、衔接、变化"
          />
          <button className="primary" onClick={() => setModal(null)}>
            完成
          </button>
        </Modal>
      )}
      {modal === "remarks" && (
        <Modal title="备注" onClose={() => setModal(null)}>
          <Field
            label="备注"
            multiline
            value={b.remarks}
            onCommit={(v) => update({ remarks: v })}
          />
          <button className="primary" onClick={() => setModal(null)}>
            完成
          </button>
        </Modal>
      )}
      {modal === "lyrics" && (
        <LyricsEditor
          block={b}
          activeLyricId={activeLyricId}
          edit={update}
          onClose={() => setModal(null)}
          onImport={(rows) => {
            onLyricsImport(rows);
            setModal(null);
          }}
          onOpenLrc={onOpenLyricsImport}
        />
      )}
    </div>
  );
}
function LyricsEditor({
  block: b,
  edit,
  onClose,
  onImport,
  onOpenLrc,
  activeLyricId,
}: {
  block: Block;
  edit: (patch: Partial<Block>) => void;
  onClose: () => void;
  onImport: (rows: Lyric[]) => void;
  onOpenLrc?: () => void;
  activeLyricId?: string;
}) {
  const initial = b.lyrics.filter((l) => l.jp !== pureText);
  const [jp, setJp] = useState(initial.map((l) => l.jp).join("\n"));
  const [cn, setCn] = useState(initial.map((l) => l.cn).join("\n"));
  const commit = () => {
    if (
      jp !== initial.map((l) => l.jp).join("\n") ||
      cn !== initial.map((l) => l.cn).join("\n")
    ) {
      const splitField = (text: string, field: "jp" | "cn") => {
        const lines = text.split("\n");
        if (
          lines.length !==
          initial
            .map((l) => l[field])
            .join("\n")
            .split("\n").length
        )
          return lines;
        let cursor = 0;
        return initial.map((l) => {
          const count = l[field].split("\n").length;
          const value = lines.slice(cursor, cursor + count).join("\n");
          cursor += count;
          return value;
        });
      };
      const japanese = splitField(jp, "jp"),
        chinese = splitField(cn, "cn");
      const rows = Array.from(
        { length: Math.max(1, japanese.length, chinese.length) },
        (_, i) => ({
          ...(initial[i] ?? lyric()),
          jp: japanese[i] ?? "",
          cn: chinese[i] ?? "",
        }),
      );
      edit({ lyrics: rows });
    }
    onClose();
  };
  return (
    <Modal title="双语歌词" onClose={commit} wide>
      <div className="bilingual-inputs">
        <label className="field">
          <span>日文</span>
          <textarea
            aria-label="日文歌词"
            rows={10}
            value={jp}
            onChange={(e) => setJp(e.target.value)}
          />
        </label>
        <label className="field">
          <span>中文</span>
          <textarea
            aria-label="中文歌词"
            rows={10}
            value={cn}
            onChange={(e) => setCn(e.target.value)}
          />
        </label>
      </div>
      <div className="toolbar">
        <button
          onClick={() => {
            commit();
            onOpenLrc?.();
          }}
        >
          打开 LRC
        </button>
        <button className="primary" onClick={commit}>
          完成
        </button>
      </div>
    </Modal>
  );
}
