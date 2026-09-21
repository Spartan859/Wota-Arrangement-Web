import { Plus, Trash2 } from "lucide-react";
import { usePointerDrag } from "./usePointerDrag";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/model";
import {
  addDancer,
  changePose,
  colorHex,
  colors,
  deleteDancer,
  emptyChoreography,
  sampleFormation,
  resizeCanvas,
  setVisibility,
  type Choreography,
  type Pose,
  type StickColor,
} from "../core/choreography";
import { Modal } from "./Fields";

type Props = {
  project: Project;
  edit: (fn: (p: Project) => void) => void;
  readOnly: boolean;
  getTime: () => number;
  pause: () => void;
  onError: (message: string) => void;
};
export function FormationCanvas({
  project,
  edit,
  readOnly,
  getTime,
  pause,
  onError,
}: Props) {
  const c = project.choreography ?? emptyChoreography();
  const stageWidth = c.canvas?.width ?? 800,
    stageHeight = c.canvas?.height ?? 600;
  const scale = Math.min(stageWidth / 800, stageHeight / 600);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "add" | "rename" | "delete" | "color" | "size" | null
  >(null);
  const [canvasWidth, setCanvasWidth] = useState(String(stageWidth));
  const [canvasHeight, setCanvasHeight] = useState(String(stageHeight));
  const [scalePositions, setScalePositions] = useState(false);
  const [sizeError, setSizeError] = useState("");
  const [name, setName] = useState("");
  const [hand, setHand] = useState<"left" | "right">("left");
  const [showNames, setShowNames] = useState(false);
  const [bothHands, setBothHands] = useState(false);
  const frozenTime = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    id: string;
    time: number;
    x: number;
    y: number;
    moved: boolean;
    pose: Pose;
    dx: number;
    dy: number;
  } | null>(null);
  const bubbles = useRef(new Map<string, SVGGElement>());
  const nodes = useRef(new Map<string, SVGGElement>());
  const beginDrag = usePointerDrag(
    `${project.id}:${project.audio?.id}`,
    readOnly,
  );
  const live = useRef({ c, getTime, readOnly, stageWidth, stageHeight, scale });
  live.current = { c, getTime, readOnly, stageWidth, stageHeight, scale };
  const run = (operation: (c: Choreography) => void) => {
    if (readOnly) return;
    try {
      edit((p) => {
        p.choreography ??= emptyChoreography();
        operation(p.choreography);
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const freeze = () => {
    pause();
    frozenTime.current = getTime();
    return frozenTime.current;
  };
  const point = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0.5, y: 0.5 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: p.x / stageWidth, y: p.y / stageHeight };
  };
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const { stageWidth, stageHeight, scale } = live.current;
      for (const pose of sampleFormation(
        live.current.c,
        live.current.getTime(),
      )) {
        const node = nodes.current.get(pose.dancerId);
        if (!node) continue;
        const shown =
          drag.current?.id === pose.dancerId ? drag.current.pose : pose;
        node.style.display = shown.visible ? "" : "none";
        node.setAttribute(
          "transform",
          `translate(${shown.x * stageWidth} ${shown.y * stageHeight}) scale(${scale})`,
        );
        const bubble = bubbles.current.get(pose.dancerId);
        if (bubble) {
          const half = Number(bubble.dataset.bubbleWidth) / 2;
          const x = (shown.x * stageWidth) / scale;
          const y = (shown.y * stageHeight) / scale;
          const dx =
            Math.max(half + 2, Math.min(stageWidth / scale - half - 2, x)) - x;
          const dy = Math.max(0, 64 - y);
          bubble.style.display = shown.visible ? "" : "none";
          bubble.setAttribute(
            "transform",
            `translate(${(x + dx) * scale} ${(y + dy) * scale}) scale(${scale})`,
          );
        }
        node
          .querySelector("[data-hand=left]")
          ?.setAttribute("fill", colorHex(shown.left));
        node
          .querySelector("[data-hand=right]")
          ?.setAttribute("fill", colorHex(shown.right));
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    drag.current = null;
    if (readOnly) setModal(null);
  }, [readOnly]);
  const selectedDancer = c.dancers.find((d) => d.id === selected);
  const chooseColor = (color: StickColor) => {
    if (selected)
      run((c) =>
        changePose(
          c,
          selected,
          frozenTime.current,
          bothHands ? { left: color, right: color } : { [hand]: color },
        ),
      );
    setModal(null);
  };
  return (
    <section className="formation-panel" aria-label="队形画布">
      <div className="panel-heading">
        <h2>队形画布</h2>
        <div className="formation-tools" role="group" aria-label="舞者操作">
          <select
            aria-label="选择舞者"
            value={selectedDancer?.id ?? ""}
            onChange={(e) => setSelected(e.target.value || null)}
          >
            <option value="">选择舞者</option>
            {c.dancers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            className="dancer-add"
            aria-label="添加舞者"
            title="添加舞者"
            disabled={readOnly}
            onClick={() => {
              freeze();
              setName("");
              setModal("add");
            }}
          >
            <Plus size={16} />
          </button>
          <button
            className="dancer-delete"
            aria-label="全曲删除"
            title="全曲删除舞者"
            disabled={!selectedDancer || readOnly}
            onClick={() => setModal("delete")}
          >
            <Trash2 size={15} />
          </button>
          <button
            disabled={!selectedDancer || readOnly}
            onClick={() => {
              setName(selectedDancer!.name);
              setModal("rename");
            }}
          >
            重命名
          </button>
          <button
            title="从当前时刻起入场"
            disabled={!selectedDancer || readOnly}
            onClick={() => {
              const t = freeze();
              run((c) => setVisibility(c, selected!, t, true));
            }}
          >
            入场
          </button>
          <button
            title="从当前时刻起退场"
            disabled={!selectedDancer || readOnly}
            onClick={() => {
              const t = freeze();
              run((c) => setVisibility(c, selected!, t, false));
            }}
          >
            退场
          </button>
          <button
            disabled={readOnly}
            onClick={() => {
              freeze();
              setSizeError("");
              setScalePositions(false);
              setCanvasWidth(String(stageWidth));
              setCanvasHeight(String(stageHeight));
              setModal("size");
            }}
          >
            画布尺寸
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={showNames}
              onChange={(e) => setShowNames(e.target.checked)}
            />
            显示名字
          </label>
        </div>
      </div>
      <div className="stage-container">
        <svg
          ref={svg}
          className="formation-stage"
          viewBox={`0 0 ${stageWidth} ${stageHeight}`}
          aria-label="舞台俯视图"
        >
          <rect
            width={stageWidth}
            height={stageHeight}
            rx="12"
            fill="#f5f8fc"
            stroke="#c5cfdf"
            strokeWidth="3"
          />
          {[1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M ${(i * stageWidth) / 4} 0 V${stageHeight} M0 ${(i * stageHeight) / 4} H${stageWidth}`}
              stroke="#dfe5ef"
              strokeDasharray="6 8"
            />
          ))}
          <text
            x={stageWidth / 2}
            y={stageHeight * 0.06}
            textAnchor="middle"
            fill="#6b7d94"
            fontSize={Math.max(12, stageHeight * 0.027)}
          >
            ↑ 面朝方向
          </text>
          {c.dancers.map((d) => {
            const pose = sampleFormation(c, getTime()).find(
              (p) => p.dancerId === d.id,
            ) ?? {
              x: 0.5,
              y: 0.5,
              visible: false,
              left: "蓝" as StickColor,
              right: "蓝" as StickColor,
            };
            return (
              <g
                key={d.id}
                ref={(node) => {
                  if (node) nodes.current.set(d.id, node);
                  else nodes.current.delete(d.id);
                }}
                role="button"
                tabIndex={0}
                aria-label={`舞者 ${d.name}`}
                data-dancer={d.id}
                transform={`translate(${pose.x * stageWidth} ${pose.y * stageHeight}) scale(${scale})`}
                style={{
                  display: pose.visible ? "" : "none",
                  cursor: readOnly ? "default" : "grab",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !readOnly) {
                    setSelected(d.id);
                    freeze();
                    setHand("left");
                    setModal("color");
                  }
                }}
                onPointerDown={(e) => {
                  if (readOnly || e.button !== 0 || !e.isPrimary) return;
                  e.preventDefault();
                  const wasSelected = selected === d.id;
                  setSelected(d.id);
                  const t = freeze();
                  const current = sampleFormation(c, t).find(
                    (p) => p.dancerId === d.id,
                  )!;
                  const startPoint = point(e.clientX, e.clientY);
                  const state = {
                    id: d.id,
                    time: t,
                    x: e.clientX,
                    y: e.clientY,
                    moved: false,
                    pose: current,
                    dx: current.x - startPoint.x,
                    dy: current.y - startPoint.y,
                  };
                  drag.current = state;
                  setHand(
                    (e.target as Element).getAttribute("data-hand") === "right"
                      ? "right"
                      : "left",
                  );
                  beginDrag(
                    e,
                    (event) => {
                      if (!drag.current || drag.current.id !== d.id) return;
                      if (
                        Math.hypot(
                          event.clientX - drag.current.x,
                          event.clientY - drag.current.y,
                        ) < 4 &&
                        !drag.current.moved
                      )
                        return;
                      drag.current.moved = true;
                      const next = point(event.clientX, event.clientY);
                      drag.current.pose = {
                        ...drag.current.pose,
                        x: Math.max(
                          0.03,
                          Math.min(0.97, next.x + drag.current.dx),
                        ),
                        y: Math.max(
                          0.04,
                          Math.min(0.96, next.y + drag.current.dy),
                        ),
                      };
                    },
                    (cancelled) => {
                      const final = drag.current;
                      drag.current = null;
                      if (!cancelled && final?.moved)
                        run((c) =>
                          changePose(c, d.id, final.time, {
                            x: final.pose.x,
                            y: final.pose.y,
                          }),
                        );
                      else if (
                        !cancelled &&
                        final &&
                        wasSelected &&
                        !final.moved
                      )
                        setModal("color");
                    },
                  );
                }}
              >
                <title>{d.name}</title>
                <path
                  data-hand="left"
                  d="M0 -22 A22 22 0 0 0 0 22 Z"
                  fill={colorHex(pose.left)}
                  stroke="#536277"
                  strokeWidth="1.5"
                />
                <path
                  data-hand="right"
                  d="M0 -22 A22 22 0 0 1 0 22 Z"
                  fill={colorHex(pose.right)}
                  stroke="#536277"
                  strokeWidth="1.5"
                />
                <circle
                  r="26"
                  fill="none"
                  stroke={selected === d.id ? "#4568d4" : "transparent"}
                  strokeWidth="3"
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {showNames && (
            <g
              className="dancer-names-layer"
              pointerEvents="none"
              aria-hidden="true"
            >
              {c.dancers.map((d) => {
                const pose = sampleFormation(c, getTime()).find(
                  (p) => p.dancerId === d.id,
                )!;
                return (
                  <g
                    key={d.id}
                    ref={(node) => {
                      if (node) bubbles.current.set(d.id, node);
                      else bubbles.current.delete(d.id);
                    }}
                    data-name-for={d.id}
                    transform={`translate(${pose.x * stageWidth} ${pose.y * stageHeight}) scale(${scale})`}
                    style={{ display: pose.visible ? "" : "none" }}
                    className="dancer-name-bubble"
                    data-bubble-width={Math.min(
                      260,
                      Math.max(52, Array.from(d.name).length * 18 + 20),
                    )}
                    pointerEvents="none"
                    aria-hidden="true"
                  >
                    <rect
                      x={
                        -Math.min(
                          260,
                          Math.max(52, Array.from(d.name).length * 18 + 20),
                        ) / 2
                      }
                      y={-62}
                      width={Math.min(
                        260,
                        Math.max(52, Array.from(d.name).length * 18 + 20),
                      )}
                      height={28}
                      rx={9}
                      fill="#ffffff"
                      stroke="#bac8dc"
                    />
                    <path
                      d="M -4 -34 L 0 -29 L 4 -34"
                      fill="#ffffff"
                      stroke="#bac8dc"
                    />
                    <text
                      x={0}
                      y={-43}
                      textAnchor="middle"
                      fontSize={18}
                      fill="#34445e"
                    >
                      {Array.from(d.name).length > 13
                        ? Array.from(d.name).slice(0, 12).join("") + "…"
                        : d.name}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      </div>
      <small className="stage-help">
        左半圆：左手 · 右半圆：右手 · 登退场从当前时刻起
      </small>
      {(modal === "add" || modal === "rename") && (
        <Modal
          title={modal === "add" ? "添加舞者" : "重命名舞者"}
          onClose={() => setModal(null)}
        >
          <label className="field">
            <span>姓名</span>
            <input
              aria-label="舞者姓名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={!name.trim() || readOnly}
            onClick={() => {
              if (modal === "add")
                run((c) => {
                  setSelected(addDancer(c, name, frozenTime.current));
                });
              else
                run((c) => {
                  const d = c.dancers.find((d) => d.id === selected);
                  if (d) d.name = name.trim();
                });
              setModal(null);
            }}
          >
            保存舞者
          </button>
        </Modal>
      )}
      {modal === "delete" && (
        <Modal title="全曲删除舞者" onClose={() => setModal(null)}>
          <p>删除 {selectedDancer?.name} 及全曲关键帧中的记录，可撤销。</p>
          <button
            disabled={readOnly}
            onClick={() => {
              run((c) => deleteDancer(c, selected!));
              setSelected(null);
              setModal(null);
            }}
          >
            确认删除舞者
          </button>
        </Modal>
      )}
      {modal === "size" && (
        <Modal title="画布尺寸" onClose={() => setModal(null)}>
          <div className="two-fields">
            <label className="field">
              <span>宽度</span>
              <input
                aria-label="画布宽度"
                type="number"
                min="320"
                max="4000"
                step="1"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(e.target.value)}
              />
            </label>
            <label className="field">
              <span>高度</span>
              <input
                aria-label="画布高度"
                type="number"
                min="240"
                max="3000"
                step="1"
                value={canvasHeight}
                onChange={(e) => setCanvasHeight(e.target.value)}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={scalePositions}
              onChange={(e) => setScalePositions(e.target.checked)}
            />
            按比例缩放舞者站位
          </label>
          <p className="muted">
            {scalePositions
              ? "所有关键帧按新画布比例缩放站位。"
              : "所有关键帧保留相对画布正中心的坐标；越界舞者移至最近边界。"}
          </p>
          {sizeError && (
            <p className="error" role="alert">
              {sizeError}
            </p>
          )}
          <button
            className="primary"
            disabled={readOnly}
            onClick={() => {
              const width = Number(canvasWidth),
                height = Number(canvasHeight);
              if (
                !Number.isInteger(width) ||
                !Number.isInteger(height) ||
                width < 320 ||
                height < 240 ||
                width > 4000 ||
                height > 3000
              ) {
                setSizeError(
                  "画布尺寸范围：宽 320–4000，高 240–3000，须为整数。",
                );
                return;
              }
              run((c) => {
                resizeCanvas(c, width, height, scalePositions);
              });
              setModal(null);
            }}
          >
            保存尺寸
          </button>
        </Modal>
      )}
      {modal === "color" && (
        <Modal
          title={`${selectedDancer?.name ?? "舞者"} · ${bothHands ? "左右手同时" : hand === "left" ? "左手" : "右手"}光棒`}
          onClose={() => setModal(null)}
        >
          <div className="toolbar">
            <button
              disabled={readOnly}
              onClick={() => {
                setName(selectedDancer?.name ?? "");
                setModal("rename");
              }}
            >
              重命名舞者
            </button>
            <button
              className={hand === "left" && !bothHands ? "active" : ""}
              onClick={() => {
                setBothHands(false);
                setHand("left");
              }}
            >
              左手
            </button>
            <button
              className={hand === "right" && !bothHands ? "active" : ""}
              onClick={() => {
                setBothHands(false);
                setHand("right");
              }}
            >
              右手
            </button>
            <button
              className={bothHands ? "active" : ""}
              onClick={() => setBothHands(true)}
            >
              左右手同时
            </button>
          </div>
          <div className="stick-palette">
            {colors.map(([name, hex]) => (
              <button
                disabled={readOnly}
                key={name}
                onClick={() => chooseColor(name)}
              >
                <i style={{ background: hex }} />
                {name}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}
