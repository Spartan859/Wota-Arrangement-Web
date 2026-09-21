import { useMemo } from "react";
import type { Project } from "../core/model";
import {
  batonUsage,
  batonLabel,
  usageRule,
  usageTime,
} from "../core/batonUsage";
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
      <div className="section-title">
        <h3>光棒用量</h3>
        <strong>共 {stats.total} 根</strong>
      </div>
      <p className="muted">{usageRule}</p>
      {stats.outOfRange > 0 && (
        <p className="notice">
          统计包含 {stats.outOfRange} 个超出歌曲时长的关键帧，请检查对时。
        </p>
      )}
      {stats.colors.length ? (
        <table>
          <thead>
            <tr>
              <th>颜色</th>
              <th>累计消耗（根）</th>
            </tr>
          </thead>
          <tbody>
            {stats.colors.map((row) => (
              <tr key={row.color}>
                <td>{row.color}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-small">暂无光棒消耗记录</p>
      )}
      <h3>舞者切换顺序</h3>
      {stats.dancers.map((d, i) => (
        <details key={d.id} className="baton-dancer">
          <summary>
            {i + 1}. {d.name} · {d.total} 根
          </summary>
          <p className="muted">
            {d.colors.map((c) => `${c.color} ${c.count} 根`).join(" · ") ||
              "无消耗"}
          </p>
          {d.changes.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>状态</th>
                    <th>左手</th>
                    <th>右手</th>
                    <th>新增（根）</th>
                  </tr>
                </thead>
                <tbody>
                  {d.changes.map((change) => (
                    <tr key={change.time}>
                      <td>{usageTime(change.time)}</td>
                      <td>{change.kind}</td>
                      <td>{batonLabel(change.left)}</td>
                      <td>{batonLabel(change.right)}</td>
                      <td>{change.added}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">无入场记录</p>
          )}
        </details>
      ))}
      <p className="muted">
        Excel 最后一张工作表包含用量及完整切换顺序；舞者坐标和关键帧仍需另存
        JSON。
      </p>
    </section>
  );
}
