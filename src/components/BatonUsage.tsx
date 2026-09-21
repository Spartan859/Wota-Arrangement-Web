import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../core/model";
import { colorHex } from "../core/choreography";
import {
  batonUsage,
  replacementChanges,
  batonLabel,
  usageRule,
  usageTime,
  type BatonChange,
} from "../core/batonUsage";

function UsageStep({ change, name }: { change: BatonChange; name: string }) {
  const button = useRef<HTMLButtonElement>(null),
    id = useId();
  const [tip, setTip] = useState<{
    left: number;
    top: number;
    host: HTMLDialogElement;
  } | null>(null);
  const left = change.left === "黑" ? "未持棒" : batonLabel(change.left);
  const right = change.right === "黑" ? "未持棒" : batonLabel(change.right);
  const label = `${name} ${usageTime(change.time)} ${change.kind}，左手：${left}；右手：${right}；新增 ${change.added} 根`;
  const show = () => {
    const node = button.current,
      host = node?.closest("dialog");
    if (!node || !host) return;
    const box = node.getBoundingClientRect();
    setTip({
      host,
      left: Math.max(
        12,
        Math.min(window.innerWidth - 292, box.left + box.width / 2 - 140),
      ),
      top:
        box.bottom + 68 < window.innerHeight
          ? box.bottom + 6
          : Math.max(8, box.top - 68),
    });
  };
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const outside = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [tip]);
  return (
    <li className="baton-step">
      <time>{usageTime(change.time)}</time>
      <button
        ref={button}
        className="baton-dot"
        aria-label={label}
        aria-describedby={tip ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") setTip(null);
        }}
        onFocus={show}
        onBlur={() => setTip(null)}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setTip(null);
          }
        }}
      >
        <svg width="28" height="28" viewBox="-24 -24 48 48" aria-hidden="true">
          {change.left !== "黑" && (
            <path
              data-hand="left"
              d="M0 -22 A22 22 0 0 0 0 22 Z"
              fill={colorHex(change.left)}
              stroke="#536277"
              strokeWidth="1.5"
            />
          )}
          {change.right !== "黑" && (
            <path
              data-hand="right"
              d="M0 -22 A22 22 0 0 1 0 22 Z"
              fill={colorHex(change.right)}
              stroke="#536277"
              strokeWidth="1.5"
            />
          )}
        </svg>
      </button>
      {tip &&
        createPortal(
          <div
            id={id}
            className="baton-tooltip"
            role="tooltip"
            style={{ left: tip.left, top: tip.top }}
          >
            <span>
              左手：{left} · 右手：{right}
            </span>
            <small>
              {change.kind} · 新增 {change.added} 根
            </small>
          </div>,
          tip.host,
        )}
    </li>
  );
}
export function BatonUsage({ project }: { project: Project }) {
  const result = useMemo(() => {
    try {
      return { stats: batonUsage(project), error: "" };
    } catch {
      return {
        stats: null,
        error: "队形数据无效，无法统计光棒用量，请检查关键帧。",
      };
    }
  }, [project.choreography, project.audio]);
  if (!result.stats)
    return (
      <section className="baton-usage">
        <h3>光棒用量</h3>
        <p role="alert" className="error">
          {result.error}
        </p>
      </section>
    );
  const stats = result.stats;
  return (
    <section className="baton-usage" aria-label="光棒用量统计">
      <div className="baton-totals" title={usageRule}>
        <h3>光棒用量</h3>
        <strong>共 {stats.total} 根</strong>
        <span>
          {stats.colors
            .map((row) => `${row.color} ${row.count} 根`)
            .join(" · ") || "暂无光棒消耗记录"}
        </span>
      </div>
      {stats.outOfRange > 0 && (
        <p className="notice">
          统计包含 {stats.outOfRange} 个超出歌曲时长的关键帧，请检查对时。
        </p>
      )}
      <h3>换棒列表</h3>
      {stats.dancers.map((d, i) => (
        <div key={d.id} className="baton-dancer">
          <strong
            className="baton-dancer-name"
            title={`${d.name} · ${d.total} 根`}
          >
            {i + 1}. {d.name}
            <small> · {d.total} 根</small>
          </strong>
          {replacementChanges(d.changes).length ? (
            <ol className="baton-sequence" aria-label={`${d.name}换棒列表`}>
              {replacementChanges(d.changes).map((change) => (
                <UsageStep key={change.time} change={change} name={d.name} />
              ))}
            </ol>
          ) : (
            <span className="muted">无换棒记录</span>
          )}
        </div>
      ))}
    </section>
  );
}
