import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Music2, Pause, Play, Repeat2, Volume2 } from "lucide-react";
import type { Project } from "../core/model";
import { Field } from "./Fields";
import { db } from "../core/storage";
import { formatTime, playable } from "../core/timing";
export type PlayerHandle = {
  seek: (time: number, play?: boolean) => void;
  getTime: () => number;
  pause: () => void;
};
type Props = {
  project: Project;
  loopId: string | null;
  onLoop: (id: string | null) => void;
  onTime: (time: number, playing: boolean) => void;
  onPersist: (time: number) => void;
  onError: (message: string) => void;
  onUpload: (file: File) => void;
  follow: boolean;
  onFollow: (follow: boolean) => void;
  readOnly: boolean;
  onReady: (ready: boolean) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onInsert?: (time: number | null) => void;
  onUpdateRange?: (
    id: string,
    patch: { start?: number | null; end?: number | null },
  ) => void;
  onDelete?: (id: string) => void;
  onCreate?: () => void;
};
export const Player = forwardRef<PlayerHandle, Props>(function Player(
  {
    project: p,
    loopId,
    onLoop,
    onTime,
    onPersist,
    onError,
    onUpload,
    follow,
    onFollow,
    readOnly,
    onReady,
    selectedId,
    onSelect,
    onInsert,
    onUpdateRange,
    onDelete,
    onCreate,
  },
  ref,
) {
  const audio = useRef<HTMLAudioElement>(null),
    [source, setSource] = useState(""),
    [loaded, setLoaded] = useState(false),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [zoom, setZoom] = useState(1),
    [rate, setRate] = useState(1),
    [volume, setVolume] = useState(0.8);
  const callbacks = useRef({ onTime, onPersist, onError });
  callbacks.current = { onTime, onPersist, onError };
  const restoredPosition = useRef(p.position);
  const readyRef = useRef(false);
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const [abEnabled, setAbEnabled] = useState(false);
  const [draftRanges, setDraftRanges] = useState<
    Record<string, { start: number; end: number }>
  >({});
  const segmentLoop = p.blocks.find(
    (b) => b.id === loopId && playable(b, p.blocks, p.audio?.duration),
  );
  const loop =
    segmentLoop ??
    (abEnabled && pointA !== null && pointB !== null
      ? { start: pointA, end: pointB }
      : undefined);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useEffect(() => {
    if (loopId) {
      setAbEnabled(false);
    }
  }, [loopId]);
  useEffect(() => {
    setPointA(null);
    setPointB(null);
    setAbEnabled(false);
    let disposed = false;
    let url = "";
    readyRef.current = false;
    onReady(false);
    setLoaded(false);
    setPlaying(false);
    setSource("");
    restoredPosition.current = p.position;
    setTime(p.position);
    callbacks.current.onTime(p.position, false);
    if (p.audio?.id)
      db.audio
        .get(p.audio.id)
        .then((record) => {
          if (disposed) return;
          if (record) {
            url = URL.createObjectURL(record.blob);
            setSource(url);
          } else
            callbacks.current.onError(
              "找不到本地音频，请重新选择歌曲以恢复同步播放。",
            );
        })
        .catch(() =>
          callbacks.current.onError("无法读取本地音频，请重新选择歌曲。"),
        );
    return () => {
      disposed = true;
      audio.current?.pause();
      if (url) URL.revokeObjectURL(url);
    };
  }, [p.id, p.audio?.id]);
  const seek = (t: number, play = false) => {
    const a = audio.current;
    if (
      !a ||
      !readyRef.current ||
      !Number.isFinite(t) ||
      t < 0 ||
      t > a.duration
    )
      return;
    const l = loopRef.current;
    if (l && (t < l.start! || t >= l.end!)) {
      onLoop(null);
      setAbEnabled(false);
    }
    a.currentTime = t;
    setTime(t);
    callbacks.current.onTime(t, !a.paused);
    callbacks.current.onPersist(t);
    if (play)
      void a
        .play()
        .catch(() =>
          callbacks.current.onError("播放失败，请检查音频格式并重新点击播放。"),
        );
  };
  useImperativeHandle(ref, () => ({
    seek,
    getTime: () => audio.current?.currentTime ?? 0,
    pause: () => audio.current?.pause(),
  }));
  useEffect(() => {
    let frame = 0,
      lastDraw = 0,
      lastSave = 0;
    const sync = (stamp: number) => {
      const a = audio.current;
      if (a && readyRef.current) {
        const l = loopRef.current;
        if (
          l &&
          !a.paused &&
          (a.currentTime >= l.end! || a.currentTime < l.start!)
        )
          a.currentTime = l.start!;
        if (stamp - lastDraw > 80) {
          setTime(a.currentTime);
          callbacks.current.onTime(a.currentTime, !a.paused);
          lastDraw = stamp;
        }
        if (!a.paused && stamp - lastSave > 5000) {
          callbacks.current.onPersist(a.currentTime);
          lastSave = stamp;
        }
      }
      frame = requestAnimationFrame(sync);
    };
    frame = requestAnimationFrame(sync);
    const visible = () => {
      const a = audio.current;
      if (!a || !readyRef.current) return;
      const l = loopRef.current;
      if (l && !a.paused && a.currentTime >= l.end!) a.currentTime = l.start!;
      setTime(a.currentTime);
      callbacks.current.onTime(a.currentTime, !a.paused);
      callbacks.current.onPersist(a.currentTime);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const duration = p.audio?.duration ?? 0;
  const choosePoint = (point: "a" | "b") => {
    if (!loaded) return;
    const t = audio.current!.currentTime;
    if (point === "a") {
      if (t >= duration) {
        onError("A 入点必须早于歌曲结束。");
        return;
      }
      setPointA(t);
      if (pointB !== null && pointB <= t) setPointB(null);
    } else {
      if (pointA === null || t <= pointA) {
        onError("B 出点必须晚于 A 入点。");
        return;
      }
      setPointB(t);
    }
    onLoop(null);
    setAbEnabled(false);
  };
  const selectedBlock = p.blocks.find((b) => b.id === selectedId);
  const startAbLoop = () => {
    if (!loaded || pointA === null || pointB === null || pointB <= pointA)
      return;
    onLoop(null);
    seek(pointA, true);
    setAbEnabled(true);
  };
  return (
    <footer className="player" aria-label="歌曲播放器">
      <audio
        ref={audio}
        src={source || undefined}
        preload="metadata"
        onLoadedMetadata={() => {
          const a = audio.current!;
          if (!Number.isFinite(a.duration) || a.duration <= 0) {
            onError("歌曲时长无效，请选择其他音频。");
            return;
          }
          a.currentTime = Math.min(restoredPosition.current, a.duration);
          a.volume = volume;
          a.playbackRate = rate;
          readyRef.current = true;
          setLoaded(true);
          onReady(true);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          if (readyRef.current) onPersist(audio.current!.currentTime);
        }}
        onEnded={() => {
          if (loopRef.current) {
            audio.current!.currentTime = loopRef.current.start!;
            void audio
              .current!.play()
              .catch(() => onError("循环播放被中断，请点击播放。"));
          } else {
            setPlaying(false);
            onPersist(audio.current!.currentTime);
          }
        }}
        onError={() => {
          if (source) {
            readyRef.current = false;
            setLoaded(false);
            onReady(false);
            onError(
              "无法解码歌曲，请重新选择浏览器支持的 MP3、WAV 或 AAC 文件。",
            );
          }
        }}
      />
      <div className="player-controls">
        <div className="song-badge">
          <Music2 size={20} />
          <div>
            <strong>{p.audio?.name || "把歌曲带进编排"}</strong>
            <small>
              {loaded
                ? "音频已在此浏览器就绪"
                : p.audio
                  ? "重新关联歌曲即可恢复播放"
                  : "导入本地歌曲，边听边打点"}
            </small>
          </div>
        </div>
        <label className={"file-button " + (readOnly ? "disabled" : "")}>
          {p.audio ? "更换歌曲" : "导入歌曲"}
          <input
            aria-label="音频文件"
            disabled={readOnly}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="play-button"
          aria-label={playing ? "暂停" : "播放"}
          disabled={!loaded}
          onClick={() => {
            const a = audio.current!;
            if (a.paused) {
              if (
                loop &&
                (a.currentTime < loop.start! || a.currentTime >= loop.end!)
              )
                a.currentTime = loop.start!;
              void a
                .play()
                .catch(() => onError("无法播放，请重新点击或选择其他歌曲。"));
            } else a.pause();
          }}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <span className="clock" data-testid="playback-time">
          {formatTime(time)} <span>/ {formatTime(duration)}</span>
        </span>
        <label className="compact">
          速度
          <select
            aria-label="播放速度"
            value={rate}
            onChange={(e) => {
              const n = Number(e.target.value);
              setRate(n);
              if (audio.current) audio.current.playbackRate = n;
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <label className="volume">
          <Volume2 size={16} />
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => {
              const n = Number(e.target.value);
              setVolume(n);
              if (audio.current) audio.current.volume = n;
            }}
          />
        </label>
        <button
          className={loop ? "active" : ""}
          disabled={!loop}
          onClick={() => {
            onLoop(null);
            setAbEnabled(false);
          }}
        >
          <Repeat2 size={15} />
          {loop ? "退出循环" : "未循环"}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => onFollow(e.target.checked)}
          />
          跟随播放
        </label>
      </div>
      <input
        className="seek"
        aria-label="播放进度"
        type="range"
        min="0"
        max={duration || 1}
        step="0.01"
        value={Math.min(time, duration || 1)}
        disabled={!loaded}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <div className="ab-controls" aria-label="AB 点循环">
        <button disabled={!loaded} onClick={() => choosePoint("a")}>
          选 A
        </button>
        <button
          disabled={!loaded || pointA === null}
          onClick={() => choosePoint("b")}
        >
          选 B
        </button>
        <span className="ab-status" role="status">
          A {formatTime(pointA)} · B {formatTime(pointB)}
        </span>
        <button
          disabled={!loaded || pointA === null || pointB === null}
          onClick={() => (abEnabled ? setAbEnabled(false) : startAbLoop())}
        >
          {abEnabled ? "退出 A/B 循环" : "开始 A/B 循环"}
        </button>
      </div>
      {selectedBlock && (
        <fieldset
          disabled={readOnly}
          className="range-controls"
          aria-label="片段出入点"
        >
          <strong>{selectedBlock.type}</strong>
          <Field
            label="入点（秒）"
            value={
              selectedBlock.start === null ? "" : String(selectedBlock.start)
            }
            onCommit={(v) =>
              onUpdateRange?.(selectedBlock.id, {
                start: v.trim() ? Number(v) : null,
              })
            }
          />
          <Field
            label="出点（秒）"
            value={selectedBlock.end === null ? "" : String(selectedBlock.end)}
            onCommit={(v) =>
              onUpdateRange?.(selectedBlock.id, {
                end: v.trim() ? Number(v) : null,
              })
            }
          />
          <button
            disabled={!loaded}
            onClick={() =>
              onUpdateRange?.(selectedBlock.id, {
                start: audio.current!.currentTime,
              })
            }
          >
            当前设为入点
          </button>
          <button
            disabled={!loaded}
            onClick={() =>
              onUpdateRange?.(selectedBlock.id, {
                end: audio.current!.currentTime,
              })
            }
          >
            当前设为出点
          </button>
        </fieldset>
      )}
      <div className="timeline-top">
        <span>
          歌曲时间轴 <span className="muted">· 选中编辑，拖动边缘对时</span>
        </span>
        <label>
          缩放{" "}
          <input
            aria-label="时间轴缩放"
            type="range"
            min="1"
            max="8"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline"
          style={{ width: `${zoom * 100}%` }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            if (!duration) {
              onInsert?.(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            onInsert?.(
              Math.round(
                Math.max(
                  0,
                  Math.min(
                    duration,
                    ((e.clientX - rect.left) / rect.width) * duration,
                  ),
                ) * 100,
              ) / 100,
            );
          }}
        >
          {pointA !== null && pointB !== null && duration > 0 && (
            <div
              className="ab-region"
              style={{
                left: `${(pointA / duration) * 100}%`,
                width: `${((pointB - pointA) / duration) * 100}%`,
              }}
            />
          )}
          {duration > 0 &&
            (
              [
                ["A", pointA],
                ["B", pointB],
              ] as const
            ).map(
              ([label, point]) =>
                point !== null && (
                  <span
                    key={label}
                    className={"ab-marker ab-marker-" + label.toLowerCase()}
                    style={{ left: `${(point / duration) * 100}%` }}
                  >
                    <b>{label}</b>
                  </span>
                ),
            )}
          {Array.from({ length: 11 }, (_, i) => (
            <span className="tick" key={i} style={{ left: `${i * 10}%` }}>
              {formatTime((duration * i) / 10).slice(0, 5)}
            </span>
          ))}
          {duration > 0 &&
            p.blocks
              .filter((b) => b.start !== null && b.end !== null)
              .map((b, i) => {
                const range = draftRanges[b.id] ?? {
                  start: b.start!,
                  end: b.end!,
                };
                return (
                  <button
                    key={b.id}
                    disabled={readOnly}
                    className={`timeline-block tone-${i % 4} ${selectedId === b.id ? "selected" : ""}`}
                    style={{
                      left: `${Math.min(100, (range.start / duration) * 100)}%`,
                      width: `${(Math.max(0, Math.min(duration, range.end) - range.start) / duration) * 100}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect?.(b.id);
                    }}
                    onDoubleClick={() => seek(range.start, true)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (
                        (e.target as HTMLElement).closest(".timeline-delete") ||
                        e.button !== 0
                      )
                        return;
                      const element = e.currentTarget;
                      const rect = element.getBoundingClientRect();
                      const width =
                        element.parentElement!.getBoundingClientRect().width;
                      const startX = e.clientX;
                      const mode =
                        e.clientX - rect.left < 8
                          ? "start"
                          : rect.right - e.clientX < 8
                            ? "end"
                            : "move";
                      let next = range;
                      let moved = false;
                      const move = (ev: PointerEvent) => {
                        if (Math.abs(ev.clientX - startX) < 3 && !moved) return;
                        moved = true;
                        const delta =
                          ((ev.clientX - startX) / width) * duration;
                        const shift = Math.max(
                          -range.start,
                          Math.min(duration - range.end, delta),
                        );
                        next =
                          mode === "move"
                            ? {
                                start: range.start + shift,
                                end: range.end + shift,
                              }
                            : mode === "start"
                              ? {
                                  start: Math.max(
                                    0,
                                    Math.min(
                                      range.end - 0.01,
                                      range.start + delta,
                                    ),
                                  ),
                                  end: range.end,
                                }
                              : {
                                  start: range.start,
                                  end: Math.min(
                                    duration,
                                    Math.max(
                                      range.start + 0.01,
                                      range.end + delta,
                                    ),
                                  ),
                                };
                        setDraftRanges({ [b.id]: next });
                      };
                      const finish = (cancelled: boolean) => {
                        if (moved && !cancelled)
                          onUpdateRange?.(b.id, {
                            start: Math.round(next.start * 1000) / 1000,
                            end: Math.round(next.end * 1000) / 1000,
                          });
                        setDraftRanges({});
                        element.removeEventListener("pointermove", move);
                        element.removeEventListener("pointerup", up);
                        element.removeEventListener("pointercancel", cancel);
                      };
                      const up = () => finish(false);
                      const cancel = () => finish(true);
                      element.setPointerCapture(e.pointerId);
                      element.addEventListener("pointermove", move);
                      element.addEventListener("pointerup", up);
                      element.addEventListener("pointercancel", cancel);
                    }}
                    title={`${b.type} ${formatTime(range.start)} — ${formatTime(range.end)}`}
                  >
                    {b.type}
                    <span className="timeline-edge timeline-edge-start" />
                    <span className="timeline-edge timeline-edge-end" />
                    <span
                      className="timeline-delete"
                      role="button"
                      aria-label={`删除${b.type}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(b.id);
                      }}
                    >
                      ×
                    </span>
                  </button>
                );
              })}
          {p.blocks.filter((b) => b.start === null || b.end === null).length >
            0 && (
            <div className="untimed-strip">
              {p.blocks
                .filter((b) => b.start === null || b.end === null)
                .map((b) => (
                  <span
                    key={b.id}
                    className={selectedId === b.id ? "selected" : ""}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect?.(b.id);
                      }}
                    >
                      {b.type}
                    </button>
                    <button
                      className="untimed-delete"
                      aria-label={`删除${b.type}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(b.id);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          )}
          <span
            className="playhead"
            style={{
              left: `${duration ? Math.min(100, (time / duration) * 100) : 0}%`,
            }}
          />
          {!duration && (
            <span className="timeline-empty">
              歌曲就绪后，在这里查看段落与播放位置
            </span>
          )}
        </div>
      </div>
    </footer>
  );
});
