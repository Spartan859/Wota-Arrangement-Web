import { usePointerDrag } from "./usePointerDrag";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/model";
import {
  cleanupRedundantKeyframes,
  emptyChoreography,
  frameTime,
  getDancerFrames,
  moveDancerFrame,
  removeDancerFrame,
  saveDancerFrame,
  type TrackKind,
} from "../core/choreography";
import { formatTime } from "../core/timing";
import { Modal } from "./Fields";

type Props = {
  project: Project;
  edit: (fn: (p: Project) => void) => void;
  readOnly: boolean;
  duration: number;
  loaded: boolean;
  getTime: () => number;
  pause: () => void;
  seek: (t: number) => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  selectedDancerId?: string | null;
};

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
  onNotice,
  selectedDancerId,
}: Props) {
  const beginDrag = usePointerDrag(
    `${p.id}:${p.audio?.id}`,
    readOnly || !loaded,
  );
  const c = p.choreography;
  const dancer = c?.dancers.find((item) => item.id === selectedDancerId);
  const dancerId = dancer?.id;
  const [editing, setEditing] = useState<{
    kind: TrackKind;
    id: string;
  } | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [selectedFrames, setSelectedFrames] = useState<
    Record<TrackKind, string | null>
  >({ position: null, color: null });
  const suppressClick = useRef(false);
  const current = loaded ? getTime() : 0;
  useEffect(() => {
    setSelectedFrames({ position: null, color: null });
  }, [dancerId]);
  const positionFrames = dancerId
    ? getDancerFrames(c!, dancerId, "position")
    : [];
  const colorFrames = dancerId ? getDancerFrames(c!, dancerId, "color") : [];
  const scale =
    duration ||
    Math.max(
      1,
      ...positionFrames.map((frame) => frame.time),
      ...colorFrames.map((frame) => frame.time),
    );
  const showError = (fn: () => void) => {
    try {
      fn();
      setError("");
      return true;
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      onError(message);
      return false;
    }
  };
  const framesFor = (kind: TrackKind) =>
    kind === "position" ? positionFrames : colorFrames;
  const currentFrame = (kind: TrackKind) =>
    framesFor(kind).find(
      (frame) => Math.round(frame.time * 1000) === Math.round(current * 1000),
    );
  const moveFrameBy = (kind: TrackKind, direction: -1 | 1) => {
    const frames = framesFor(kind);
    if (!frames.length) return;
    const nextIndex = frames.findIndex((frame) => frame.time > current);
    const target =
      direction < 0
        ? [...frames].reverse().find((frame) => frame.time < current)
        : frames[nextIndex];
    if (target) {
      setSelectedFrames((selected) => ({ ...selected, [kind]: target.id }));
      pause();
      seek(target.time);
    }
  };
  const deleteFrame = (kind: TrackKind, id: string) => {
    if (readOnly || !dancerId) return;
    setSelectedFrames((selected) =>
      selected[kind] === id ? { ...selected, [kind]: null } : selected,
    );
    pause();
    showError(() =>
      edit((draft) => {
        if (draft.choreography)
          removeDancerFrame(draft.choreography, dancerId, kind, id);
      }),
    );
  };
  const toggleCurrentFrame = (kind: TrackKind) => {
    if (readOnly || !dancerId) return;
    pause();
    const frame = currentFrame(kind);
    showError(() =>
      edit((draft) => {
        draft.choreography ??= emptyChoreography();
        if (frame)
          removeDancerFrame(draft.choreography, dancerId, kind, frame.id);
        else
          saveDancerFrame(
            draft.choreography,
            dancerId,
            kind,
            loaded ? frameTime(current, duration) : 0,
          );
      }),
    );
  };
  const trackControls = (kind: TrackKind) => {
    const frames = framesFor(kind);
    const atCurrent = currentFrame(kind);
    const label = kind === "position" ? "位置" : "颜色";
    return (
      <div className={`formation-track-row-tools formation-track-${kind}`}>
        <strong>{label}</strong>
        <button
          aria-label={`${label}上一个关键帧`}
          disabled={!frames.some((frame) => frame.time < current)}
          onClick={() => moveFrameBy(kind, -1)}
        >
          &lt;
        </button>
        <button
          aria-label={`${label}切换当前关键帧`}
          className={atCurrent ? "active" : ""}
          disabled={readOnly}
          onClick={() => toggleCurrentFrame(kind)}
        >
          {atCurrent ? "◆" : "◇"}
        </button>
        <button
          aria-label={`${label}下一个关键帧`}
          disabled={!frames.some((frame) => frame.time > current)}
          onClick={() => moveFrameBy(kind, 1)}
        >
          &gt;
        </button>
        <button
          aria-label={`${label}关键帧时间`}
          disabled={!atCurrent}
          onClick={() => {
            if (!atCurrent) return;
            setValue(String(atCurrent.time));
            setError("");
            setEditing({ kind, id: atCurrent.id });
          }}
        >
          时间
        </button>
      </div>
    );
  };
  const track = (kind: TrackKind) => {
    const frames = framesFor(kind);
    const atCurrent = currentFrame(kind);
    const label = kind === "position" ? "位置" : "颜色";
    return (
      <div
        className={`formation-subtrack formation-subtrack-${kind}`}
        aria-label={`${label}关键帧`}
      >
        <div className="formation-key-lane">
          {frames.map((frame) => {
            const outOfRange = duration > 0 && frame.time > duration;
            return (
              <button
                key={frame.id}
                className={`formation-key formation-key-${kind} ${selectedFrames[kind] === frame.id ? "selected" : ""} ${outOfRange ? "out-of-range" : ""}`}
                aria-label={`${label}关键帧 ${formatTime(frame.time)}`}
                title={`${formatTime(frame.time)}${outOfRange ? " · 超出歌曲时长" : ""}`}
                style={{
                  left: `${Math.min(100, Math.max(0, (frame.time / scale) * 100))}%`,
                }}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  setSelectedFrames((selected) => ({
                    ...selected,
                    [kind]: frame.id,
                  }));
                  pause();
                  if (!outOfRange) seek(frame.time);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Backspace" && event.key !== "Delete")
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  deleteFrame(kind, frame.id);
                }}
                onPointerDown={(event) => {
                  if (
                    readOnly ||
                    !loaded ||
                    event.button !== 0 ||
                    !event.isPrimary
                  )
                    return;
                  const element = event.currentTarget;
                  const lane = element.parentElement!.getBoundingClientRect();
                  const origin = event.clientX;
                  let time = frame.time;
                  let moved = false;
                  beginDrag(
                    event,
                    (pointer) => {
                      if (Math.abs(pointer.clientX - origin) < 4 && !moved)
                        return;
                      moved = true;
                      suppressClick.current = true;
                      time = Math.max(
                        0,
                        Math.min(
                          duration,
                          frame.time +
                            ((pointer.clientX - origin) / lane.width) * scale,
                        ),
                      );
                      element.style.left = `${(time / scale) * 100}%`;
                    },
                    (cancelled) => {
                      element.style.left = `${Math.min(100, Math.max(0, (frame.time / scale) * 100))}%`;
                      if (moved && !cancelled)
                        showError(() =>
                          edit((draft) => {
                            if (draft.choreography)
                              moveDancerFrame(
                                draft.choreography,
                                dancerId!,
                                kind,
                                frame.id,
                                time,
                                duration,
                              );
                          }),
                        );
                    },
                  );
                }}
              >
                ◆
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  const editedFrame = editing
    ? framesFor(editing.kind).find((frame) => frame.id === editing.id)
    : undefined;
  return (
    <div
      className={`formation-track ${dancer ? "has-dancer" : ""}`}
      aria-label="队形关键帧轨道"
      onClick={(event) => event.stopPropagation()}
    >
      {dancer ? (
        <>
          <div
            className="formation-track-header"
            role="group"
            aria-label="关键帧操作"
          >
            <div className="formation-track-name">{dancer.name} 关键帧</div>
            {trackControls("position")}
            {trackControls("color")}
            <button
              className="formation-cleanup"
              disabled={readOnly}
              title="删除不会改变队形渲染结果的关键帧"
              onClick={() => {
                pause();
                let removed = { position: 0, color: 0, total: 0 };
                edit((draft) => {
                  if (draft.choreography)
                    removed = cleanupRedundantKeyframes(draft.choreography);
                });
                onNotice(
                  removed.total
                    ? `已清理 ${removed.total} 个多余关键帧（位置 ${removed.position}，颜色 ${removed.color}）。`
                    : "没有可清理的多余关键帧。",
                );
              }}
            >
              清理关键帧
            </button>
          </div>
          {track("position")}
          {track("color")}
        </>
      ) : (
        <div className="formation-track-empty">
          选择舞者后显示位置和颜色关键帧
        </div>
      )}
      {editing && editedFrame && dancerId && (
        <Modal
          title={`${editing.kind === "position" ? "位置" : "颜色"}关键帧时间`}
          onClose={() => setEditing(null)}
        >
          <label className="field">
            <span>时间（秒）</span>
            <input
              aria-label="关键帧秒数"
              type="number"
              step="0.001"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            onClick={() => {
              const saved = showError(() =>
                edit((draft) => {
                  if (draft.choreography)
                    moveDancerFrame(
                      draft.choreography,
                      dancerId,
                      editing.kind,
                      editedFrame.id,
                      Number(value),
                      duration,
                    );
                }),
              );
              if (saved) setEditing(null);
            }}
          >
            保存关键帧时间
          </button>
        </Modal>
      )}
    </div>
  );
}
