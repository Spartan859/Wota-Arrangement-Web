import { usePointerDrag } from "./usePointerDrag";
import { useRef, useState } from "react";
import type { Project } from "../core/model";
import {
  emptyChoreography,
  frameTime,
  moveFrame,
  saveFrame,
} from "../core/choreography";
import { formatTime } from "../core/timing";
import { Modal } from "./Fields";
export function FormationTrack({
  project: p,
  edit,
  readOnly,
  duration,
  loaded,
  getTime,
  pause,
  seek,
  onError,
}: {
  project: Project;
  edit: (fn: (p: Project) => void) => void;
  readOnly: boolean;
  duration: number;
  loaded: boolean;
  getTime: () => number;
  pause: () => void;
  seek: (time: number) => void;
  onError: (message: string) => void;
}) {
  const beginDrag = usePointerDrag(
    `${p.id}:${p.audio?.id}`,
    readOnly || !loaded,
  );
  const [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [value, setValue] = useState("");
  const [preview, setPreview] = useState<{ id: string; time: number } | null>(
    null,
  );
  const [localError, setLocalError] = useState("");
  const suppressClick = useRef(false);
  const frames = p.choreography?.frames ?? [];
  const frame = frames.find((f) => f.id === selected);
  const scale = duration || Math.max(1, ...frames.map((f) => f.time));
  const attempt = (fn: () => void) => {
    try {
      fn();
      return true;
    } catch (e) {
      const message = (e as Error).message;
      setLocalError(message);
      onError(message);
      return false;
    }
  };
  return (
    <div
      className="formation-track"
      aria-label="队形关键帧轨道"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="formation-track-tools">
        <strong>队形</strong>
        {frames.some((f) => duration > 0 && f.time > duration) && (
          <select
            aria-label="越界队形关键帧"
            value={frame && frame.time > duration ? frame.id : ""}
            onChange={(e) => {
              setSelected(e.target.value || null);
              pause();
            }}
          >
            <option value="">越界帧</option>
            {frames
              .filter((f) => f.time > duration)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {formatTime(f.time)}
                </option>
              ))}
          </select>
        )}
        <button
          disabled={readOnly}
          onClick={() => {
            pause();
            attempt(() =>
              edit((d) => {
                d.choreography ??= emptyChoreography();
                saveFrame(
                  d.choreography,
                  loaded ? frameTime(getTime(), duration) : 0,
                );
              }),
            );
          }}
        >
          记录队形
        </button>
        <button
          disabled={readOnly || !frame}
          onClick={() => {
            pause();
            setValue(String(frame!.time));
            setLocalError("");
            setEditing(true);
          }}
        >
          关键帧时间
        </button>
        <button
          disabled={readOnly || !frame}
          onClick={() => {
            edit((d) => {
              if (d.choreography)
                d.choreography.frames = d.choreography.frames.filter(
                  (f) => f.id !== selected,
                );
            });
            setSelected(null);
          }}
        >
          删除关键帧
        </button>
      </div>
      <div className="formation-key-lane">
        {frames.map((f) => (
          <button
            key={f.id}
            className={`formation-key ${selected === f.id ? "selected" : ""} ${duration && f.time > duration ? "out-of-range" : ""}`}
            aria-label={`队形关键帧 ${formatTime(f.time)}`}
            title={`${formatTime(f.time)}${duration && f.time > duration ? " · 超出歌曲时长" : ""}`}
            style={{
              left: `${Math.min(100, ((preview?.id === f.id ? preview.time : f.time) / scale) * 100)}%`,
            }}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setSelected(f.id);
              pause();
              if (loaded && f.time <= duration) seek(f.time);
            }}
            onPointerDown={(e) => {
              if (readOnly || !loaded || e.button !== 0 || !e.isPrimary) return;
              suppressClick.current = false;
              pause();
              setSelected(f.id);
              const element = e.currentTarget,
                lane = element.parentElement!.getBoundingClientRect(),
                origin = e.clientX;
              let time = f.time,
                moved = false;
              const move = (event: PointerEvent) => {
                if (Math.abs(event.clientX - origin) < 4 && !moved) return;
                moved = true;
                time = Math.max(
                  0,
                  Math.min(
                    duration,
                    f.time + ((event.clientX - origin) / lane.width) * scale,
                  ),
                );
                setPreview({ id: f.id, time });
              };
              beginDrag(e, move, (cancel) => {
                suppressClick.current = moved;
                setPreview(null);
                if (moved && !cancel)
                  attempt(() =>
                    edit((d) => {
                      if (d.choreography)
                        moveFrame(d.choreography, f.id, time, duration);
                    }),
                  );
              });
            }}
          >
            ◆
          </button>
        ))}
      </div>
      {editing && frame && (
        <Modal title="关键帧时间" onClose={() => setEditing(false)}>
          <label className="field">
            <span>时间（秒）</span>
            <input
              aria-label="关键帧秒数"
              type="number"
              step="0.001"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {localError && (
            <p role="alert" className="error">
              {localError}
            </p>
          )}
          <button
            disabled={readOnly}
            onClick={() => {
              if (
                attempt(() => {
                  if (!value.trim()) throw new Error("请输入时间。");
                  edit((d) => {
                    if (d.choreography)
                      moveFrame(
                        d.choreography,
                        frame.id,
                        Number(value),
                        loaded ? duration : 0,
                      );
                  });
                })
              )
                setEditing(false);
            }}
          >
            保存关键帧时间
          </button>
        </Modal>
      )}
    </div>
  );
}
