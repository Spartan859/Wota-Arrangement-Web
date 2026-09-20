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
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "add" | "rename" | "delete" | "color" | null
  >(null);
  const [name, setName] = useState("");
  const [hand, setHand] = useState<"left" | "right">("left");
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
  const live = useRef({ c, getTime, readOnly });
  live.current = { c, getTime, readOnly };
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
    return { x: p.x / 800, y: p.y / 600 };
  };
  useEffect(() => {
    let frame = 0;
    const draw = () => {
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
          `translate(${shown.x * 800} ${shown.y * 600})`,
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
        changePose(c, selected, frozenTime.current, { [hand]: color }),
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
          viewBox="0 0 800 600"
          aria-label="舞台俯视图"
        >
          <rect
            width="800"
            height="600"
            rx="12"
            fill="#f5f8fc"
            stroke="#c5cfdf"
            strokeWidth="3"
          />
          {[1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M ${i * 200} 0 V600 M0 ${i * 150} H800`}
              stroke="#dfe5ef"
              strokeDasharray="6 8"
            />
          ))}
          <text x="400" y="30" textAnchor="middle" fill="#6b7d94" fontSize="16">
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
                transform={`translate(${pose.x * 800} ${pose.y * 600})`}
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
      {modal === "color" && (
        <Modal
          title={`${selectedDancer?.name ?? "舞者"} · ${hand === "left" ? "左手" : "右手"}光棒`}
          onClose={() => setModal(null)}
        >
          <div className="toolbar">
            <button onClick={() => setHand("left")}>左手</button>
            <button onClick={() => setHand("right")}>右手</button>
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
