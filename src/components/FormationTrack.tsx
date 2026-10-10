import { usePointerDrag } from "./usePointerDrag";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/model";
import {
  activeVideoForDancer,
  addVideoRemoval,
  cleanupRedundantKeyframes,
  emptyChoreography,
  frameTime,
  getDancerFrames,
  getDancerVideoFrames,
  moveDancerFrame,
  moveVideoFrame,
  removeDancerFrame,
  removeVideoFrame,
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
  selectedVideoClipId?: string | null;
  onVideoClipSelect?: (id: string | null) => void;
  onRequestVideoInsert?: (time: number) => void;
};

type EditorTrackKind = TrackKind | "video";

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
  selectedVideoClipId,
  onVideoClipSelect,
  onRequestVideoInsert,
}: Props) {
  const beginDrag = usePointerDrag(
    `${p.id}:${p.audio?.id}`,
    readOnly || !loaded,
  );
  const c = p.choreography;
  const dancer = c?.dancers.find((item) => item.id === selectedDancerId);
  const dancerId = dancer?.id ?? null;
  const [editing, setEditing] = useState<{
    kind: EditorTrackKind;
    id: string;
  } | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [selectedFrames, setSelectedFrames] = useState<
    Record<EditorTrackKind, string | null>
  >({ position: null, color: null, video: null });
  const suppressClick = useRef(false);
  const current = loaded ? getTime() : 0;
  useEffect(() => {
    setSelectedFrames({ position: null, color: null, video: null });
  }, [dancerId]);
  useEffect(() => {
    if (!selectedVideoClipId) return;
    const frame = (
      dancerId
        ? p.choreography?.tracks.find((track) => track.dancerId === dancerId)
            ?.videoFrames
        : p.choreography?.freeVideoTrack.videoFrames
    )?.find((item) => item.clipId === selectedVideoClipId);
    if (frame)
      setSelectedFrames((selected) => ({ ...selected, video: frame.id }));
  }, [dancerId, p.choreography, selectedVideoClipId]);
  const positionFrames = dancerId
    ? getDancerFrames(c!, dancerId, "position")
    : [];
  const colorFrames = dancerId ? getDancerFrames(c!, dancerId, "color") : [];
  const videoFrames = c ? getDancerVideoFrames(c, dancerId) : [];
  const scale =
    duration ||
    Math.max(
      1,
      ...positionFrames.map((frame) => frame.time),
      ...colorFrames.map((frame) => frame.time),
      ...videoFrames.map((frame) => frame.time),
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
  const framesFor = (kind: EditorTrackKind) =>
    kind === "position"
      ? positionFrames
      : kind === "color"
        ? colorFrames
        : videoFrames;
  const currentFrame = (kind: EditorTrackKind) =>
    framesFor(kind).find(
      (frame) => Math.round(frame.time * 1000) === Math.round(current * 1000),
    );
  const moveFrameBy = (kind: EditorTrackKind, direction: -1 | 1) => {
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
  const deleteFrame = (kind: EditorTrackKind, id: string) => {
    if (readOnly) return;
    setSelectedFrames((selected) =>
      selected[kind] === id ? { ...selected, [kind]: null } : selected,
    );
    pause();
    showError(() =>
      edit((draft) => {
        if (!draft.choreography) return;
        if (kind === "video")
          removeVideoFrame(draft.choreography, dancerId, id);
        else if (dancerId)
          removeDancerFrame(draft.choreography, dancerId, kind, id);
      }),
    );
  };
  const toggleCurrentFrame = (kind: EditorTrackKind) => {
    if (readOnly) return;
    pause();
    const frame = currentFrame(kind);
    if (kind === "video" && !frame) {
      const active = c
        ? activeVideoForDancer(c, dancerId, loaded ? current : 0)
        : undefined;
      if (active) {
        showError(() =>
          edit((draft) => {
            draft.choreography ??= emptyChoreography();
            addVideoRemoval(
              draft.choreography,
              dancerId,
              active.clip.id,
              current,
            );
          }),
        );
      } else onRequestVideoInsert?.(current);
      return;
    }
    showError(() =>
      edit((draft) => {
        draft.choreography ??= emptyChoreography();
        if (frame && kind === "video") {
          removeVideoFrame(draft.choreography, dancerId, frame.id);
        } else if (kind !== "video" && dancerId) {
          if (frame)
            removeDancerFrame(draft.choreography, dancerId, kind, frame.id);
          else
            saveDancerFrame(
              draft.choreography,
              dancerId,
              kind,
              loaded ? frameTime(current, duration) : 0,
            );
        }
      }),
    );
  };
  const trackControls = (kind: EditorTrackKind) => {
    const frames = framesFor(kind);
    const atCurrent = currentFrame(kind);
    const label =
      kind === "position" ? "位置" : kind === "color" ? "颜色" : "视频";
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
  const track = (kind: EditorTrackKind) => {
    const frames = framesFor(kind);
    const atCurrent = currentFrame(kind);
    const label =
      kind === "position" ? "位置" : kind === "color" ? "颜色" : "视频";
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
                  if (kind === "video" && "clipId" in frame)
                    onVideoClipSelect?.(frame.clipId);
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
                            if (!draft.choreography) return;
                            if (kind === "video")
                              moveVideoFrame(
                                draft.choreography,
                                dancerId,
                                frame.id,
                                time,
                                duration,
                              );
                            else if (dancerId)
                              moveDancerFrame(
                                draft.choreography,
                                dancerId,
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
      className={`formation-track ${dancer ? "has-dancer" : videoFrames.length ? "has-free-video" : ""}`}
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
            {trackControls("video")}
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
          {track("video")}
        </>
      ) : selectedDancerId || !videoFrames.length ? (
        <div className="formation-track-empty">
          {selectedDancerId
            ? "选择舞者后显示位置和颜色关键帧"
            : "在队形画布中可插入不绑定舞者的视频"}
        </div>
      ) : (
        <>
          <div
            className="formation-track-header"
            role="group"
            aria-label="舞台视频关键帧操作"
          >
            <div className="formation-track-name">舞台视频 关键帧</div>
            {trackControls("video")}
          </div>
          {track("video")}
        </>
      )}
      {editing && editedFrame && (dancerId || editing.kind === "video") && (
        <Modal
          title={`${editing.kind === "position" ? "位置" : editing.kind === "color" ? "颜色" : "视频"}关键帧时间`}
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
                  if (!draft.choreography) return;
                  if (editing.kind === "video")
                    moveVideoFrame(
                      draft.choreography,
                      dancerId,
                      editedFrame.id,
                      Number(value),
                      duration,
                    );
                  else if (dancerId)
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
