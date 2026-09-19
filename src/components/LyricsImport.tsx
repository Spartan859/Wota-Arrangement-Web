import { useState } from "react";
import { lyric, type Lyric } from "../core/model";
import { parseLyrics, shifted, type ImportPreview } from "../core/lyrics";
import { Modal } from "./Fields";
export function LyricsImport({
  onClose,
  onImport,
  duration,
}: {
  onClose: () => void;
  onImport: (rows: Lyric[]) => void;
  duration?: number;
}) {
  const [raw, setRaw] = useState(""),
    [lrc, setLrc] = useState(false),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [offset, setOffset] = useState("0"),
    [ack, setAck] = useState(false),
    [error, setError] = useState("");
  const change = (index: number, patch: Partial<Lyric>) =>
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
          }
        : p,
    );
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title="导入歌词 · 检查配对与时间" onClose={onClose} wide>
      <p className="muted">
        TXT 按日中交替配对；LRC
        同一时间的两行配对，其余保留单语。导入会追加到歌词池。
      </p>
      <label className="file-picker">
        选择 TXT / LRC
        <input
          aria-label="歌词文件"
          type="file"
          accept=".txt,.lrc"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const text = await f.text();
              const isLrc = /\.lrc$/i.test(f.name);
              setRaw(text);
              setLrc(isLrc);
              setPreview(parseLyrics(text, isLrc));
              setAck(false);
              setError("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </label>
      {!preview ? (
        <>
          <label className="field">
            <span>或粘贴歌词</span>
            <textarea
              aria-label="歌词文本"
              rows={8}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"日文歌词\n中文歌词"}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={lrc}
              onChange={(e) => setLrc(e.target.checked)}
            />
            按 LRC 解析
          </label>
          <button
            className="primary"
            onClick={() =>
              attempt(() => {
                setPreview(parseLyrics(raw, lrc));
                setAck(false);
              })
            }
          >
            预览配对
          </button>
        </>
      ) : (
        <>
          {preview.warnings.map((w) => (
            <p className="notice" key={w}>
              {w}
            </p>
          ))}
          <div className="import-rows">
            {preview.rows.map((r, i) => (
              <div className="import-row" key={r.id}>
                <span className="number">{i + 1}</span>
                <input
                  aria-label={`第${i + 1}行日文`}
                  value={r.jp}
                  onChange={(e) => change(i, { jp: e.target.value })}
                />
                <input
                  aria-label={`第${i + 1}行中文`}
                  placeholder="中文译文（可留空）"
                  value={r.cn}
                  onChange={(e) => change(i, { cn: e.target.value })}
                />
                <input
                  aria-label={`第${i + 1}行时间`}
                  type="number"
                  step="0.01"
                  placeholder="秒"
                  value={r.time ?? ""}
                  onChange={(e) =>
                    change(i, {
                      time:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <button
                  title="交换日中"
                  aria-label={`交换第${i + 1}行日中`}
                  onClick={() => change(i, { jp: r.cn, cn: r.jp })}
                >
                  ⇄
                </button>
                <button
                  aria-label={`删除导入第${i + 1}行`}
                  onClick={() =>
                    setPreview({
                      ...preview,
                      rows: preview.rows.filter((x) => x.id !== r.id),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="toolbar">
            <button
              onClick={() =>
                setPreview({ ...preview, rows: [...preview.rows, lyric()] })
              }
            >
              ＋ 添加一行
            </button>
            <button onClick={() => setPreview(null)}>重新解析</button>
            <label>
              整体偏移（秒）{" "}
              <input
                className="short"
                aria-label="导入时间偏移"
                type="number"
                step="0.1"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
            </label>
          </div>
          {preview.needsAcknowledgement && (
            <label className="check">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              已检查未配对末行，确认补全或保留为空译文
            </label>
          )}
          <footer className="modal-footer">
            <span className="muted">
              {preview.rows.length} 行 · 导入不会替换已有段落
            </span>
            <button
              className="primary"
              disabled={
                !preview.rows.length || (preview.needsAcknowledgement && !ack)
              }
              onClick={() =>
                attempt(() =>
                  onImport(shifted(preview.rows, Number(offset), duration)),
                )
              }
            >
              确认导入
            </button>
          </footer>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
