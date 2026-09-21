import { headers, type Project } from "../core/model";
import { Modal } from "./Fields";
export function Preview({
  project: p,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  return (
    <Modal title="编排表预览" onClose={onClose} wide>
      <h3 className="sheet-title">
        {p.songName} (BPM: {p.bpm})
      </h3>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.blocks.flatMap((b, i) =>
              b.lyrics.map((l, j) => {
                const firstOfType = i === 0 || p.blocks[i - 1].type !== b.type;
                let span = b.lyrics.length;
                if (firstOfType) {
                  for (
                    let n = i + 1;
                    n < p.blocks.length && p.blocks[n].type === b.type;
                    n++
                  )
                    span += p.blocks[n].lyrics.length;
                }
                const group = p.blocks
                  .slice(0, i + 1)
                  .filter(
                    (x, n, all) => n === 0 || x.type !== all[n - 1].type,
                  ).length;
                return (
                  <tr key={l.id} className={group % 2 ? "odd" : "even"}>
                    {j === 0 && firstOfType && <th rowSpan={span}>{b.type}</th>}
                    {j === 0 && <td rowSpan={b.lyrics.length}>{b.beats}</td>}
                    <td>{l.jp}</td>
                    <td>{l.cn}</td>
                    {j === 0 && (
                      <>
                        <td rowSpan={b.lyrics.length}>{b.arrangement}</td>
                        <td rowSpan={b.lyrics.length}>{b.remarks}</td>
                      </>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Excel
        首张表为段落编排，最后一张表为光棒用量与切换顺序。歌曲、走位坐标及完整关键帧请另存
        JSON 备份。
      </p>
    </Modal>
  );
}
