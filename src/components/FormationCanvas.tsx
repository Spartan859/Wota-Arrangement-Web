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
  const [sizeError, setSizeError] = useState("");
  const [name, setName] = useState("");
  const [hand, setHand] = useState<"left" | "right">("left");
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
  const nodes = useRef(new Map<string, SVGGElement>());
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
        <button
          disabled={readOnly}
          onClick={() => {
            freeze();
            setName("");
            setModal("add");
          }}
        >
          添加舞者
        </button>
        <button
          disabled={readOnly}
          onClick={() => {
            freeze();
            setSizeError("");
            setCanvasWidth(String(stageWidth));
            setCanvasHeight(String(stageHeight));
            setModal("size");
          }}
        >
          画布尺寸
        </button>
      </div>
      <div className="formation-tools">
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
          disabled={!selectedDancer || readOnly}
          onClick={() => setModal("delete")}
        >
          全曲删除
        </button>
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
                  if (readOnly || e.button !== 0) return;
                  e.preventDefault();
                  setSelected(d.id);
                  const t = freeze();
                  const current = sampleFormation(c, t).find(
                    (p) => p.dancerId === d.id,
                  )!;
                  const p = point(e.clientX, e.clientY);
                  drag.current = {
                    id: d.id,
                    time: t,
                    x: e.clientX,
                    y: e.clientY,
                    moved: false,
                    pose: current,
                    dx: current.x - p.x,
                    dy: current.y - p.y,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setHand(
                    (e.target as Element).getAttribute("data-hand") === "right"
                      ? "right"
                      : "left",
                  );
                }}
                onPointerMove={(e) => {
                  const state = drag.current;
                  if (!state || state.id !== d.id || readOnly) return;
                  if (
                    Math.hypot(e.clientX - state.x, e.clientY - state.y) < 4 &&
                    !state.moved
                  )
                    return;
                  state.moved = true;
                  const p = point(e.clientX, e.clientY);
                  state.pose = {
                    ...state.pose,
                    x: Math.max(0.03, Math.min(0.97, p.x + state.dx)),
                    y: Math.max(0.04, Math.min(0.96, p.y + state.dy)),
                  };
                }}
                onPointerUp={(e) => {
                  const state = drag.current;
                  drag.current = null;
                  if (!state || state.id !== d.id || readOnly) return;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  if (state.moved)
                    run((c) =>
                      changePose(c, d.id, state.time, {
                        x: state.pose.x,
                        y: state.pose.y,
                      }),
                    );
                  else setModal("color");
                }}
                onPointerCancel={() => {
                  drag.current = null;
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
          <p className="muted">舞者位置按比例保存，修改尺寸不会改变走位。</p>
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
                c.canvas = { width, height };
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
