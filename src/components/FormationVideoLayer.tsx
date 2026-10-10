import { Maximize2, Minimize2, Scissors } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../core/model";
import {
  activeVideoForDancer,
  changeVideoGeometry,
  emptyChoreography,
  normalizeChoreography,
  sampleFormation,
  setVideoInPoint,
  videoFrameRect,
  type Choreography,
  type VideoClip,
} from "../core/choreography";
import { usePointerDrag } from "./usePointerDrag";
import { Modal } from "./Fields";

type Props = {
  project: Project;
  edit: (fn: (p: Project) => void) => void;
  readOnly: boolean;
  getTime: () => number;
  isPlaying: () => boolean;
  getPlaybackRate: () => number;
  getDancerClientPoint?: (x: number, y: number) => { x: number; y: number };
  pause: () => void;
  sources: Record<string, string>;
  selectedClipId?: string | null;
  onSelectClip?: (id: string | null) => void;
  onError: (message: string) => void;
  onRelinkVideo?: (assetId: string) => void;
  storageKey: string;
  selectionResetKey?: number;
};

type DragState = {
  clipId: string;
  mode: "move" | CropHandle;
  startX: number;
  startY: number;
  original: VideoClip;
  next: VideoClip;
  moved: boolean;
};

type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const cropHandles: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minCrop = 0.02;

function minimizedFromStorage(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function resizeCrop(
  clip: VideoClip,
  handle: CropHandle,
  dx: number,
  dy: number,
  fullWidth: number,
  fullHeight: number,
) {
  let { x, y, width, height } = clip.crop;
  const sourceDx = dx / fullWidth;
  const sourceDy = dy / fullHeight;
  if (handle.includes("w")) {
    const nextX = Math.max(0, Math.min(x + width - minCrop, x + sourceDx));
    width += x - nextX;
    x = nextX;
  }
  if (handle.includes("e"))
    width = Math.max(minCrop, Math.min(1 - x, width + sourceDx));
  if (handle.includes("n")) {
    const nextY = Math.max(0, Math.min(y + height - minCrop, y + sourceDy));
    height += y - nextY;
    y = nextY;
  }
  if (handle.includes("s"))
    height = Math.max(minCrop, Math.min(1 - y, height + sourceDy));
  return { ...clip.crop, x, y, width, height };
}

export function FormationVideoLayer({
  project: p,
  edit,
  readOnly,
  getTime,
  isPlaying,
  getPlaybackRate,
  getDancerClientPoint,
  pause,
  sources,
  selectedClipId,
  onSelectClip,
  onError,
  onRelinkVideo,
  storageKey,
  selectionResetKey = 0,
}: Props) {
  const c = useMemo(
    () => normalizeChoreography(p.choreography ?? emptyChoreography()),
    [p.choreography],
  );
  const beginDrag = usePointerDrag(`${p.id}:${p.audio?.id}`, readOnly);
  const layer = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const previewVideo = useRef<HTMLVideoElement>(null);
  const drag = useRef<DragState | null>(null);
  const [minimized, setMinimized] = useState(() =>
    minimizedFromStorage(storageKey),
  );
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [localSelectedClipId, setLocalSelectedClipId] = useState<string | null>(
    selectedClipId ?? null,
  );
  const [previewInPoint, setPreviewInPoint] = useState("0");
  const [previewRate, setPreviewRate] = useState("30");
  const [previewError, setPreviewError] = useState("");
  const clips = useMemo(
    () =>
      [
        ...c.tracks.map((track) => ({
          dancerId: track.dancerId as string | null,
          dancerName:
            c.dancers.find((dancer) => dancer.id === track.dancerId)?.name ??
            "舞者",
          videoClips: track.videoClips,
        })),
        {
          dancerId: null,
          dancerName: "舞台",
          videoClips: c.freeVideoTrack.videoClips,
        },
      ].flatMap((track) =>
        track.videoClips.map((clip) => ({
          clip,
          dancerId: track.dancerId,
          dancerName: track.dancerName,
          asset: c.videoAssets.find((asset) => asset.id === clip.assetId),
        })),
      ),
    [c],
  );
  const live = useRef({
    c,
    getTime,
    isPlaying,
    getPlaybackRate,
    getDancerClientPoint,
    sources,
    minimized,
    selectedClipId,
  });
  live.current = {
    c,
    getTime,
    isPlaying,
    getPlaybackRate,
    getDancerClientPoint,
    sources,
    minimized,
    selectedClipId,
  };
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...minimized]));
    } catch {
      // The current page still retains the temporary state.
    }
  }, [minimized, storageKey]);
  useEffect(() => {
    drag.current = null;
    setPreviewClipId(null);
    setLocalSelectedClipId(null);
    setMinimized(minimizedFromStorage(storageKey));
  }, [storageKey]);
  useEffect(() => {
    setLocalSelectedClipId(null);
    setPreviewClipId(null);
  }, [selectionResetKey]);
  useEffect(() => {
    if (selectedClipId) {
      setLocalSelectedClipId(selectedClipId);
      return;
    }
    setLocalSelectedClipId((current) =>
      current && !clips.some((item) => item.clip.id === current)
        ? null
        : current,
    );
  }, [clips, selectedClipId]);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      const current = live.current;
      const bounds = layer.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) {
        frame = requestAnimationFrame(sync);
        return;
      }
      const poses = new Map(
        sampleFormation(current.c, current.getTime()).map((pose) => [
          pose.dancerId,
          pose,
        ]),
      );
      const activeDrag = drag.current;
      for (const item of clips) {
        const node = nodes.current.get(item.clip.id);
        const video = videos.current.get(item.clip.id);
        if (!node || !item.asset) continue;
        const active = activeVideoForDancer(
          current.c,
          item.dancerId,
          current.getTime(),
        );
        const bound = item.dancerId !== null;
        const pose = bound ? poses.get(item.dancerId!) : undefined;
        const source = current.sources[item.asset.id];
        const dancerPoint = bound
          ? current.getDancerClientPoint?.(pose?.x ?? 0.5, pose?.y ?? 0.5)
          : undefined;
        const hasDancerPoint =
          dancerPoint &&
          Number.isFinite(dancerPoint.x) &&
          Number.isFinite(dancerPoint.y);
        const dancerX =
          bound && hasDancerPoint
            ? (dancerPoint.x - bounds.left) / bounds.width
            : bound
              ? (pose?.x ?? 0.5)
              : 0;
        const dancerY =
          bound && hasDancerPoint
            ? (dancerPoint.y - bounds.top) / bounds.height
            : bound
              ? (pose?.y ?? 0.5)
              : 0;
        const isActive =
          active?.clip.id === item.clip.id && (!bound || pose?.visible);
        if (!isActive) {
          node.style.display = "none";
          video?.pause();
          continue;
        }
        const clip =
          activeDrag?.clipId === item.clip.id ? activeDrag.next : item.clip;
        const frameRect = videoFrameRect(clip, item.asset, {
          width: bounds.width,
          height: bounds.height,
        });
        node.style.display = "";
        node.style.left = `${(dancerX + frameRect.x) * 100}%`;
        node.style.top = `${(dancerY + frameRect.y) * 100}%`;
        node.style.width = `${frameRect.width * 100}%`;
        node.style.height = `${frameRect.height * 100}%`;
        if (current.minimized.has(item.clip.id)) {
          video?.pause();
          continue;
        }
        if (!video || !source) continue;
        video.style.width = `${100 / clip.crop.width}%`;
        video.style.height = `${100 / clip.crop.height}%`;
        video.style.left = `${(-clip.crop.x / clip.crop.width) * 100}%`;
        video.style.top = `${(-clip.crop.y / clip.crop.height) * 100}%`;
        if (video.getAttribute("src") !== source) {
          video.src = source;
          video.load();
        }
        const desiredTime = active.sourceTime;
        const shouldPlay = current.isPlaying() && !active.frozen;
        const drift = Math.abs(video.currentTime - desiredTime);
        if (!shouldPlay || drift > 0.08) {
          try {
            video.currentTime = desiredTime;
          } catch {
            // Metadata may not be ready yet; the next frame retries.
          }
        }
        video.playbackRate = current.getPlaybackRate();
        if (shouldPlay && video.paused)
          void video.play().catch(() => undefined);
        else if (!shouldPlay && !video.paused) video.pause();
      }
      frame = requestAnimationFrame(sync);
    };
    sync();
    return () => cancelAnimationFrame(frame);
  }, [clips]);
  const previewClip = previewClipId
    ? clips.find((item) => item.clip.id === previewClipId)
    : undefined;
  const previewSource = previewClip?.asset
    ? sources[previewClip.asset.id]
    : undefined;

  const selectClip = (id: string | null) => {
    setLocalSelectedClipId(id);
    onSelectClip?.(id);
  };
  const openPreview = (id: string) => {
    const item = clips.find((entry) => entry.clip.id === id);
    if (!item) return;
    pause();
    selectClip(id);
    setPreviewInPoint(String(item.clip.inPoint));
    setPreviewRate(String(item.asset?.frameRate ?? 30));
    setPreviewError("");
    setPreviewClipId(id);
  };
  const beginMutation = (
    event: React.PointerEvent,
    item: (typeof clips)[number],
    mode: DragState["mode"],
  ) => {
    if (readOnly || !item.asset || event.button !== 0 || !event.isPrimary)
      return;
    event.preventDefault();
    event.stopPropagation();
    pause();
    selectClip(item.clip.id);
    drag.current = {
      clipId: item.clip.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      original: structuredClone(item.clip),
      next: structuredClone(item.clip),
      moved: false,
    };
    const bounds = layer.current?.getBoundingClientRect();
    if (!bounds) return;
    beginDrag(
      event,
      (pointer) => {
        const state = drag.current;
        if (
          !state ||
          state.clipId !== item.clip.id ||
          !bounds.width ||
          !bounds.height
        )
          return;
        const dx = (pointer.clientX - state.startX) / bounds.width;
        const dy = (pointer.clientY - state.startY) / bounds.height;
        if (
          Math.hypot(
            pointer.clientX - state.startX,
            pointer.clientY - state.startY,
          ) >= 3
        )
          state.moved = true;
        const fullWidth = state.original.scale;
        const fullHeight =
          state.original.scale *
          (item.asset!.height / item.asset!.width) *
          (bounds.width / bounds.height);
        state.next =
          state.mode === "move"
            ? {
                ...state.original,
                offset: {
                  x: state.original.offset.x + dx,
                  y: state.original.offset.y + dy,
                },
              }
            : {
                ...state.original,
                crop: resizeCrop(
                  state.original,
                  state.mode,
                  dx,
                  dy,
                  fullWidth,
                  fullHeight,
                ),
              };
      },
      (cancelled) => {
        const state = drag.current;
        drag.current = null;
        if (!state || cancelled || !state.moved) return;
        try {
          edit((draft) => {
            draft.choreography ??= emptyChoreography();
            changeVideoGeometry(
              draft.choreography,
              item.dancerId,
              item.clip.id,
              state.mode === "move"
                ? { offset: state.next.offset }
                : { crop: state.next.crop },
            );
          });
        } catch (error) {
          onError((error as Error).message);
        }
      },
    );
  };
  const nudgeInPoint = (item: (typeof clips)[number], direction: -1 | 1) => {
    if (readOnly || !item.asset) return;
    const step = 1 / item.asset.frameRate;
    const next = Math.max(
      0,
      Math.min(item.asset.duration, item.clip.inPoint + direction * step),
    );
    try {
      edit((draft) => {
        draft.choreography ??= emptyChoreography();
        setVideoInPoint(
          draft.choreography,
          item.dancerId,
          item.clip.id,
          Math.round(next * 1_000_000) / 1_000_000,
        );
      });
    } catch (error) {
      onError((error as Error).message);
    }
  };
  return (
    <div className="formation-video-layer" ref={layer}>
      {clips.map((item) => {
        const asset = item.asset;
        const source = asset ? sources[asset.id] : undefined;
        const selected = localSelectedClipId === item.clip.id;
        const isMinimized = minimized.has(item.clip.id);
        return (
          <div
            key={item.clip.id}
            ref={(node) => {
              if (node) nodes.current.set(item.clip.id, node);
              else nodes.current.delete(item.clip.id);
            }}
            className={`formation-video ${selected ? "selected" : ""} ${source ? "" : "missing"} ${isMinimized ? "minimized" : ""}`}
            style={{ display: "none" }}
            data-video-clip={item.clip.id}
            onPointerDown={(event) => {
              if (!isMinimized) beginMutation(event, item, "move");
            }}
          >
            <div className="formation-video-crop">
              {source ? (
                <video
                  ref={(node) => {
                    if (node) videos.current.set(item.clip.id, node);
                    else videos.current.delete(item.clip.id);
                  }}
                  muted
                  playsInline
                  preload="auto"
                  aria-label={`视频 ${asset?.name ?? ""}`}
                />
              ) : (
                <div className="formation-video-missing">
                  <span>缺少视频</span>
                  <strong>{asset?.name ?? "未知资源"}</strong>
                  {!readOnly && asset && (
                    <button
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRelinkVideo?.(asset.id);
                      }}
                    >
                      重新关联
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="formation-video-actions">
              {!readOnly && selected && !isMinimized && (
                <>
                  <button
                    aria-label="视频入点前移一帧"
                    title="入点前移一帧"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      nudgeInPoint(item, -1);
                    }}
                  >
                    −1帧
                  </button>
                  <button
                    aria-label="视频入点后移一帧"
                    title="入点后移一帧"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      nudgeInPoint(item, 1);
                    }}
                  >
                    +1帧
                  </button>
                  <button
                    aria-label="粗略选择视频入点"
                    title="粗略选择入点"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      openPreview(item.clip.id);
                    }}
                  >
                    <Scissors size={13} />
                  </button>
                </>
              )}
              <button
                aria-label={`${isMinimized ? "最大化" : "最小化"}视频 ${asset?.name ?? ""}`}
                title={isMinimized ? "最大化视频" : "最小化视频"}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setMinimized((current) => {
                    const next = new Set(current);
                    if (next.has(item.clip.id)) next.delete(item.clip.id);
                    else next.add(item.clip.id);
                    return next;
                  });
                }}
              >
                {isMinimized ? (
                  <Maximize2 size={13} />
                ) : (
                  <Minimize2 size={13} />
                )}
              </button>
            </div>
            {!readOnly &&
              selected &&
              !isMinimized &&
              cropHandles.map((handle) => (
                <button
                  key={handle}
                  className={`formation-crop-handle crop-${handle}`}
                  aria-label={`裁切视频 ${handle}`}
                  onPointerDown={(event) => beginMutation(event, item, handle)}
                />
              ))}
          </div>
        );
      })}
      {previewClip && previewClip.asset && previewSource && (
        <Modal
          title={`${previewClip.asset.name} · 选择视频入点`}
          onClose={() => setPreviewClipId(null)}
          wide
        >
          <video
            ref={previewVideo}
            className="video-inpoint-preview"
            src={previewSource}
            controls
            muted
            playsInline
            onLoadedMetadata={(event) => {
              const start = Number(previewInPoint) || 0;
              event.currentTarget.currentTime = Math.max(
                0,
                Math.min(previewClip.asset!.duration, start),
              );
            }}
          />
          <label className="field">
            <span>入点（秒）</span>
            <input
              aria-label="视频入点秒数"
              type="range"
              min="0"
              max={previewClip.asset.duration}
              step="0.01"
              value={previewInPoint}
              onChange={(event) => {
                setPreviewInPoint(event.target.value);
                if (previewVideo.current)
                  previewVideo.current.currentTime = Number(event.target.value);
              }}
            />
          </label>
          <div className="video-inpoint-controls">
            <label className="field">
              <span>精确秒数</span>
              <input
                type="number"
                min="0"
                max={previewClip.asset.duration}
                step="0.001"
                value={previewInPoint}
                onChange={(event) => setPreviewInPoint(event.target.value)}
              />
            </label>
            <button
              onClick={() =>
                setPreviewInPoint((value) =>
                  String(
                    Math.max(
                      0,
                      Number(value) - 1 / Math.max(0.001, Number(previewRate)),
                    ),
                  ),
                )
              }
            >
              −1 帧
            </button>
            <button
              onClick={() =>
                setPreviewInPoint((value) =>
                  String(
                    Math.min(
                      previewClip.asset!.duration,
                      Number(value) + 1 / Math.max(0.001, Number(previewRate)),
                    ),
                  ),
                )
              }
            >
              +1 帧
            </button>
          </div>
          <label className="field">
            <span>帧率</span>
            <input
              aria-label="视频帧率"
              type="number"
              min="1"
              max="240"
              step="0.001"
              value={previewRate}
              onChange={(event) => setPreviewRate(event.target.value)}
            />
          </label>
          {previewError && (
            <p className="error" role="alert">
              {previewError}
            </p>
          )}
          <button
            className="primary"
            onClick={() => {
              const inPoint = Number(previewInPoint);
              const frameRate = Number(previewRate);
              if (
                !Number.isFinite(inPoint) ||
                inPoint < 0 ||
                inPoint > previewClip.asset!.duration
              ) {
                setPreviewError("入点必须在原视频时长范围内。");
                return;
              }
              if (
                !Number.isFinite(frameRate) ||
                frameRate <= 0 ||
                frameRate > 240
              ) {
                setPreviewError("帧率必须在 0.001–240 之间。");
                return;
              }
              try {
                edit((draft) => {
                  draft.choreography ??= emptyChoreography();
                  const asset = draft.choreography.videoAssets.find(
                    (entry) => entry.id === previewClip.asset!.id,
                  );
                  if (asset) asset.frameRate = frameRate;
                  setVideoInPoint(
                    draft.choreography,
                    previewClip.dancerId,
                    previewClip.clip.id,
                    inPoint,
                  );
                });
                setPreviewClipId(null);
              } catch (error) {
                setPreviewError((error as Error).message);
              }
            }}
          >
            保存入点
          </button>
        </Modal>
      )}
    </div>
  );
}
