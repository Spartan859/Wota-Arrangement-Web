import { useEffect, useMemo, useRef, useState } from "react";
import { lyric, type Lyric } from "../core/model";
import { parseLyrics, shifted, type ImportPreview } from "../core/lyrics";
import { formatTime } from "../core/timing";
import { Modal } from "./Fields";

type Props = {
  onClose: () => void;
  onImport: (rows: Lyric[]) => void;
  duration?: number;
  focusTime?: number | null;
};
export function LyricsImport({
  onClose,
  onImport,
  duration,
  focusTime,
}: Props) {
  const [raw, setRaw] = useState(""),
    [lrc, setLrc] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [offset, setOffset] = useState("0"),
    [ack, setAck] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    if (!preview || !lrc) return [];
    const map = new Map<string, Lyric[]>();
    for (const row of preview.rows) {
      const key = row.time === null ? `none-${row.id}` : String(row.time);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [preview, lrc]);
  useEffect(() => {
    if (
      !preview ||
      focusTime === null ||
      focusTime === undefined ||
      !scroller.current
    )
      return;
    const target = [
      ...scroller.current.querySelectorAll<HTMLElement>("[data-time]"),
    ].find((el) => Number(el.dataset.time) >= focusTime);
    target?.scrollIntoView({ block: "center" });
  }, [preview, focusTime]);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const change = (index: number, patch: Partial<Lyric>) =>
    setPreview(
      (p) =>
        p && {
          ...p,
          rows: p.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
        },
    );
  const selectRow = (row: Lyric) => {
    if (row.time === null) return;
    const same = preview!.rows.filter((x) => x.time === row.time);
    const chosen = selected.find((id) => same.some((x) => x.id === id));
    setSelected(
      [
        ...selected.filter((id) => !same.some((x) => x.id === id)),
        row.id,
      ].filter(Boolean),
    );
    if (chosen === row.id) setSelected(selected.filter((id) => id !== row.id));
  };
  const confirmLrc = () => {
    const rows = groups.flatMap(([, items]) => {
      const jp = items.find((x) => selected.includes(x.id));
      if (!jp) return [];
      const cn = items
        .filter((x) => x.id !== jp.id)
        .map((x) => x.jp)
        .filter(Boolean)
        .join("\n");
      return [lyric(jp.jp, cn, jp.time)];
    });
    if (!rows.length) throw new Error("请至少选择一条日文歌词。");
    onImport(shifted(rows, Number(offset), duration));
  };
  return (
    <Modal title={lrc ? "选择 LRC 歌词" : "导入歌词"} onClose={onClose} wide>
      {!preview && (
        <>
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
                  setSelected([]);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
          <label className="field">
            <span>或粘贴歌词</span>
            <textarea
              aria-label="歌词文本"
              rows={8}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
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
                setSelected([]);
              })
            }
          >
            预览
          </button>
        </>
      )}
      {preview && !lrc && (
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
                  value={r.cn}
                  onChange={(e) => change(i, { cn: e.target.value })}
                />
                <input
                  aria-label={`第${i + 1}行时间`}
                  type="number"
                  step="0.01"
                  value={r.time ?? ""}
                  onChange={(e) =>
                    change(i, {
                      time:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            ))}
          </div>
          <label className="field">
            <span>整体偏移（秒）</span>
            <input
              aria-label="导入时间偏移"
              type="number"
              step="0.1"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
          {preview.needsAcknowledgement && (
            <label className="check">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              确认未配对末行
            </label>
          )}
          <button
            className="primary"
            disabled={preview.needsAcknowledgement && !ack}
            onClick={() =>
              attempt(() =>
                onImport(shifted(preview.rows, Number(offset), duration)),
              )
            }
          >
            确认导入
          </button>
        </>
      )}
      {preview && lrc && (
        <>
          <p className="muted">
            每个时间戳选择一条日文，其余同刻内容会成为中文。
          </p>
          <div className="lrc-picker" ref={scroller}>
            {groups.map(([time, items]) => (
              <section
                key={time}
                data-time={time === "none" ? undefined : time}
              >
                <header>
                  {time === "none" ? "无时间" : formatTime(Number(time))}
                </header>
                {items.map((row) => (
                  <label
                    className={
                      "lrc-option " +
                      (selected.includes(row.id) ? "chosen" : "")
                    }
                    key={row.id}
                  >
                    <input
                      type="radio"
                      name={`lrc-${time}`}
                      checked={selected.includes(row.id)}
                      onChange={() => selectRow(row)}
                    />
                    <span>{row.jp}</span>
                  </label>
                ))}
              </section>
            ))}
          </div>
          <label className="field">
            <span>整体偏移（秒）</span>
            <input
              type="number"
              step="0.1"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
          <div className="toolbar">
            <button onClick={() => setPreview(null)}>重新解析</button>
            <button className="primary" onClick={() => attempt(confirmLrc)}>
              加入当前段落
            </button>
          </div>
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
