import { ArrowLeft, CloudOff, FileAudio, Link2, Music2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPublicShare } from "../api/client";
import {
  audioDurationWarningSeconds,
  maxSyncOffsetSeconds,
  type PublicShare,
  type ShareSnapshot,
} from "../core/share";
import { activeBlock, activeLyric, formatTime } from "../core/timing";
import type { Project } from "../core/model";
import { FormationCanvas } from "./FormationCanvas";
import { Player, type PlayerHandle } from "./Player";

type LocalAudio = { url: string; name: string; duration: number };

function projectFromSnapshot(snapshot: ShareSnapshot): Project {
  return {
    schemaVersion: 2,
    id: `public-${snapshot.songName}`,
    songName: snapshot.songName,
    bpm: snapshot.bpm,
    blocks: snapshot.blocks,
    choreography: snapshot.choreography,
    audio: snapshot.audio
      ? {
          id: null,
          name: snapshot.audio.name,
          duration: snapshot.audio.duration,
        }
      : null,
    position: 0,
    updatedAt: 0,
  };
}

function offsetStorageKey(token: string) {
  return `wota-share-offset:${token}`;
}

function readOffset(token: string) {
  try {
    const value = Number(localStorage.getItem(offsetStorageKey(token)));
    return Number.isFinite(value)
      ? Math.max(-maxSyncOffsetSeconds, Math.min(maxSyncOffsetSeconds, value))
      : 0;
  } catch {
    return 0;
  }
}

export function PublicSharePage() {
  const { token = "" } = useParams();
  const player = useRef<PlayerHandle>(null);
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [localAudio, setLocalAudio] = useState<LocalAudio | null>(null);
  const [syncOffset, setSyncOffset] = useState(() => readOffset(token));
  const [mobileView, setMobileView] = useState<"arrangement" | "formation">(
    "arrangement",
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPublicShare(token)
      .then((value) => {
        if (active) setShare(value);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "无法打开分享。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  useEffect(() => {
    try {
      localStorage.setItem(offsetStorageKey(token), String(syncOffset));
    } catch {
      // Calibration remains available for the current page when storage is blocked.
    }
  }, [syncOffset, token]);
  useEffect(() => {
    if (!error && !notice) return;
    const timer = setTimeout(() => {
      setError("");
      setNotice("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [error, notice]);
  const project = useMemo(
    () => (share ? projectFromSnapshot(share.snapshot) : null),
    [share],
  );
  if (loading) return <main className="public-loading">正在打开在线编排…</main>;
  if (!share || !project)
    return (
      <main className="public-error">
        <CloudOff size={36} />
        <h1>分享不可用</h1>
        <p>{error || "分享不存在或已被取消。"}</p>
        <Link to="/">返回编排工作台</Link>
      </main>
    );
  const currentBlock =
    project.blocks.find((block) => block.id === selectedId) ??
    activeBlock(project.blocks, time);
  const currentLyric = activeLyric(
    project.blocks,
    time,
    project.audio?.duration ?? 0,
  );
  const externalSource = localAudio
    ? { ...localAudio, duration: localAudio.duration }
    : share.audioAvailable
      ? {
          url: share.audioUrl,
          name: share.snapshot.audio?.name ?? project.songName,
          duration:
            share.snapshot.audio?.duration ?? project.audio?.duration ?? 0,
        }
      : null;
  const chooseLocalAudio = async (file: File) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("读取音频超时。")),
          15000,
        );
        probe.onloadedmetadata = () => {
          clearTimeout(timer);
          probe.duration > 0
            ? resolve(probe.duration)
            : reject(new Error("音频时长无效。"));
        };
        probe.onerror = () => {
          clearTimeout(timer);
          reject(new Error("浏览器无法读取该音频。"));
        };
        probe.src = url;
      });
      const expected = share.snapshot.audio?.duration;
      if (
        expected &&
        Math.abs(duration - expected) > audioDurationWarningSeconds
      )
        setNotice(
          `本地音频时长与在线版本相差 ${Math.abs(duration - expected).toFixed(2)} 秒，可使用同步偏移校准。`,
        );
      else setNotice("本地音乐仅保存在当前设备，不会上传服务器。");
      setLocalAudio((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url, name: file.name, duration };
      });
    } catch (cause) {
      URL.revokeObjectURL(url);
      setError(cause instanceof Error ? cause.message : "无法读取本地音乐。");
    } finally {
      probe.removeAttribute("src");
      probe.load();
    }
  };
  return (
    <div className="public-share-page">
      <header className="public-share-header">
        <Link className="public-back" to="/">
          <ArrowLeft size={17} /> 工作台
        </Link>
        <div>
          <span>Wota 在线编排</span>
          <h1>{project.songName}</h1>
          <p>
            BPM {project.bpm} · 更新于{" "}
            {new Date(share.updatedAt).toLocaleString()}
          </p>
        </div>
        <span className="readonly-badge">只读分享</span>
      </header>
      {(error || notice) && (
        <div
          className={"message toast " + (error ? "error" : "")}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
        </div>
      )}
      {!share.audioAvailable && (
        <div className="local-audio-banner">
          <CloudOff size={18} />
          <div>
            <strong>云端音乐已被删除</strong>
            <span>选择同一首歌后即可在本机播放，音频不会上传。</span>
          </div>
          <label className="file-button">
            <FileAudio size={15} /> 选择本地音乐
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void chooseLocalAudio(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      )}
      <nav className="public-mobile-tabs" aria-label="查看视图">
        <button
          className={mobileView === "arrangement" ? "active" : ""}
          onClick={() => setMobileView("arrangement")}
        >
          编排
        </button>
        <button
          className={mobileView === "formation" ? "active" : ""}
          onClick={() => setMobileView("formation")}
        >
          队形
        </button>
      </nav>
      <main className={`public-stage view-${mobileView}`}>
        <section className="public-arrangement" aria-label="当前编排">
          <div className="public-section-heading">
            <span>当前编排</span>
            {currentBlock && <strong>{currentBlock.type}</strong>}
          </div>
          {currentBlock ? (
            <>
              <div className="public-block-meta">
                <span>{currentBlock.beats} 拍</span>
                <span>
                  {formatTime(currentBlock.start)} -{" "}
                  {formatTime(currentBlock.end)}
                </span>
                <button
                  className={loopId === currentBlock.id ? "active" : ""}
                  disabled={
                    currentBlock.start === null || currentBlock.end === null
                  }
                  onClick={() => {
                    if (loopId === currentBlock.id) {
                      setLoopId(null);
                      return;
                    }
                    setLoopId(currentBlock.id);
                    if (currentBlock.start !== null)
                      player.current?.seek(currentBlock.start, true);
                  }}
                >
                  {loopId === currentBlock.id ? "退出段落循环" : "循环当前段"}
                </button>
              </div>
              <div className="public-lyrics">
                {currentBlock.lyrics.map((lyric) => (
                  <div
                    key={lyric.id}
                    className={currentLyric?.id === lyric.id ? "active" : ""}
                  >
                    <p>{lyric.jp || " "}</p>
                    <p>{lyric.cn || " "}</p>
                  </div>
                ))}
              </div>
              <div className="public-detail">
                <span>技 / 动作编排</span>
                <p>{currentBlock.arrangement || "无"}</p>
              </div>
              <div className="public-detail">
                <span>备注</span>
                <p>{currentBlock.remarks || "无"}</p>
              </div>
            </>
          ) : (
            <p className="muted">播放后自动显示当前段落。</p>
          )}
          <div className="sync-offset">
            <div>
              <strong>同步偏移</strong>
              <span>
                {syncOffset > 0 ? "+" : ""}
                {syncOffset.toFixed(2)} 秒
              </span>
            </div>
            <input
              aria-label="同步偏移"
              type="range"
              min={-maxSyncOffsetSeconds}
              max={maxSyncOffsetSeconds}
              step="0.01"
              value={syncOffset}
              onChange={(event) => setSyncOffset(Number(event.target.value))}
            />
            <button onClick={() => setSyncOffset(0)}>归零</button>
          </div>
        </section>
        <FormationCanvas
          key={share.token}
          project={project}
          edit={() => undefined}
          readOnly
          getTime={() => player.current?.getTime() ?? 0}
          pause={() => player.current?.pause()}
          onError={setError}
        />
      </main>
      <Player
        key={`${share.token}:${externalSource?.url ?? "none"}`}
        ref={player}
        project={project}
        edit={() => undefined}
        formationDancerId={null}
        loopId={loopId}
        onLoop={setLoopId}
        onTime={(position, playing) => {
          setTime(position);
          if (playing && follow)
            setSelectedId(activeBlock(project.blocks, position)?.id ?? null);
        }}
        onPersist={() => undefined}
        onError={setError}
        onNotice={setNotice}
        onUpload={(file) => void chooseLocalAudio(file)}
        externalSource={externalSource}
        timelineOffset={syncOffset}
        audioReplaceable
        follow={follow}
        onFollow={setFollow}
        readOnly
        onReady={setAudioReady}
        selectedIds={selectedId ? [selectedId] : []}
        primarySelectedId={selectedId}
        onSelect={setSelectedId}
      />
      {!audioReady && (
        <div className="audio-gate" role="status">
          <Music2 size={19} />
          <span>
            {share.audioAvailable
              ? "正在加载云端音乐…"
              : "请选择本地音乐以开始跟练。"}
          </span>
        </div>
      )}
      <div className="public-share-footer">
        <Link2 size={14} /> 此页面只读，云端音乐仅用于流式播放。
      </div>
    </div>
  );
}
