import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/model";
import {
  addVideoRemoval,
  emptyChoreography,
  getDancerVideoFrames,
  moveVideoFrame,
  removeVideoFrame,
  type DancerTrack,
} from "../core/choreography";
import { formatTime } from "../core/timing";
import { usePointerDrag } from "./usePointerDrag";

type Props = {
  project: Project;
  edit: (fn: (p: Project) => void) => void;
  selectedDancerId?: string | null;
  selectedClipId?: string | null;
  readOnly: boolean;
  duration: number;
  loaded: boolean;
  getTime: () => number;
  pause: () => void;
  seek: (time: number) => void;
  onSelectClip: (id: string | null) => void;
  onError: (message: string) => void;
};

type MarkerTrack = {
  dancerId: string | null;
  track: Pick<DancerTrack, "videoFrames" | "videoClips">;
  clips: DancerTrack["videoClips"];
};

export function VideoTimelineMarkers({
  project: p,
  edit,
  selectedDancerId,
  selectedClipId,
  readOnly,
  duration,
  loaded,
  getTime,
  pause,
  seek,
  onSelectClip,
  onError,
}: Props) {
  const c = p.choreography;
  const lane = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{
    frameId: string | null;
    clipId: string;
    time: number;
  } | null>(null);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const beginDrag = usePointerDrag(
    `${p.id}:${p.audio?.id}`,
    readOnly || !loaded,
  );
  useEffect(() => {
    setSelectedMarker(null);
    setDraft(null);
  }, [selectedDancerId, selectedClipId]);
  if (!c) return null;
  const selectedTrack = findSelectedTrack(c, selectedDancerId, selectedClipId);
  if (!selectedTrack?.clips.length) return null;
  const times = selectedTrack.track.videoFrames.flatMap((frame) =>
    selectedTrack.clips.some((clip) => clip.id === frame.clipId)
      ? [frame.time]
      : [],
  );
  const scale = duration || Math.max(1, ...times);
  const seekOrSelect = (clipId: string, time: number) => {
    onSelectClip(clipId);
    pause();
    if (!duration || time <= duration) seek(time);
  };
  const moveMarker = (
    event: React.PointerEvent<HTMLButtonElement>,
    clipId: string,
    frameId: string | null,
    startTime: number,
  ) => {
    if (readOnly || !loaded || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = lane.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const origin = event.clientX;
    let time = startTime;
    let moved = false;
    beginDrag(
      event,
      (pointer) => {
        const delta = ((pointer.clientX - origin) / rect.width) * scale;
        if (Math.abs(pointer.clientX - origin) >= 4) {
          moved = true;
          suppressClick.current = true;
        }
        time = Math.max(0, Math.min(duration || scale, startTime + delta));
        setDraft({ frameId, clipId, time });
      },
      (cancelled) => {
        setDraft(null);
        if (cancelled) return;
        if (!moved) {
          seekOrSelect(clipId, startTime);
          return;
        }
        try {
          edit((project) => {
            project.choreography ??= emptyChoreography();
            let targetFrameId = frameId;
            if (!targetFrameId) {
              targetFrameId = addVideoRemoval(
                project.choreography,
                selectedTrack.dancerId,
                clipId,
                duration,
              );
            }
            moveVideoFrame(
              project.choreography,
              selectedTrack.dancerId,
              targetFrameId,
              time,
              duration,
            );
          });
        } catch (error) {
          onError((error as Error).message);
        }
      },
    );
  };
  return (
    <div className="video-marker-lane" ref={lane} aria-label="视频入点和出点">
      {selectedTrack.clips.map((clip, index) => {
        const frames = selectedTrack.track.videoFrames.filter(
          (frame) => frame.clipId === clip.id,
        );
        const insert = frames.find((frame) => frame.kind === "insert");
        const removal = frames.find((frame) => frame.kind === "remove");
        if (!insert) return null;
        const insertTime =
          draft?.frameId === insert.id ? draft.time : insert.time;
        const outTime =
          draft && draft.frameId === removal?.id
            ? draft.time
            : (removal?.time ?? (duration || scale));
        const visibleEnd = Math.max(outTime, insertTime);
        const showOut = removal || duration > insertTime;
        const selected = selectedClipId === clip.id;
        const asset = c.videoAssets.find((item) => item.id === clip.assetId);
        return (
          <div
            key={clip.id}
            className={`timeline-block video-marker-range tone-${index % 4} ${selected ? "selected" : ""}`}
            style={{
              left: `${Math.min(100, (insertTime / scale) * 100)}%`,
              width: `${Math.min(100, Math.max(0, ((visibleEnd - insertTime) / scale) * 100))}%`,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              seekOrSelect(clip.id, insertTime);
            }}
          >
            <span className="timeline-label">视频</span>
            <span className="timeline-arrangement">
              {asset?.name ?? "视频片段"}
            </span>
            <button
              className="timeline-edge video-marker-handle video-marker-in"
              aria-label={`视频入点 ${formatTime(insertTime)}`}
              title={`入点 ${formatTime(insertTime)}`}
              onPointerDown={(event) =>
                moveMarker(event, clip.id, insert.id, insertTime)
              }
              onClick={(event) => {
                event.stopPropagation();
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                setSelectedMarker(`${clip.id}:in`);
                seekOrSelect(clip.id, insertTime);
              }}
            ></button>
            {showOut && (
              <button
                className={`timeline-edge video-marker-handle video-marker-out ${removal ? "" : "open"}`}
                aria-label={`视频出点 ${formatTime(outTime)}`}
                title={`${removal ? "出点" : "歌曲结束（拖动可设置出点）"} ${formatTime(outTime)}`}
                onPointerDown={(event) =>
                  moveMarker(event, clip.id, removal?.id ?? null, outTime)
                }
                onClick={(event) => {
                  event.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  setSelectedMarker(`${clip.id}:out`);
                  seekOrSelect(clip.id, outTime);
                }}
              ></button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function findSelectedTrack(
  c: NonNullable<Project["choreography"]>,
  selectedDancerId: string | null | undefined,
  selectedClipId: string | null | undefined,
): MarkerTrack | null {
  if (selectedClipId) {
    const free = c.freeVideoTrack.videoClips.find(
      (clip) => clip.id === selectedClipId,
    );
    if (free)
      return {
        dancerId: null,
        track: c.freeVideoTrack,
        clips: [free],
      };
    for (const track of c.tracks) {
      const clip = track.videoClips.find((item) => item.id === selectedClipId);
      if (clip)
        return {
          dancerId: track.dancerId,
          track,
          clips: [clip],
        };
    }
  }
  if (selectedDancerId) {
    const track = c.tracks.find((item) => item.dancerId === selectedDancerId);
    if (track)
      return { dancerId: track.dancerId, track, clips: track.videoClips };
  }
  return null;
}
