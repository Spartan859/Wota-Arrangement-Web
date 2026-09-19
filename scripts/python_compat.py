"""Exercise the original CLI without changing its source or using personal data."""
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from wota_tool.models import ArrangementState, Block
from wota_tool.xlsx_io import XlsxIO

command, path = sys.argv[2], Path(sys.argv[3])
if command == 'generate':
    fixture = XlsxIO()
    fixture.song_name = 'Synthetic compatibility'
    fixture.bpm = '128'
    fixture.state = ArrangementState(blocks=[
        Block('副歌', '8', [('日文一', '中文一'), ('日文二', '中文二')], '动作一\n动作二', '合成备注'),
        Block('副歌', '4', [('日文三', '中文三')], '动作三', ''),
        Block('尾奏', '2', [('（纯动作/无歌词）', '（纯动作/无歌词）')], '', '结束'),
    ])
    fixture._build_workbook().save(path)
elif command == 'read':
    song, bpm, state = XlsxIO._read_state_from_xlsx(path)
    from openpyxl import load_workbook
    ws = load_workbook(path).active
    print(json.dumps({'song': song, 'bpm': bpm, 'blocks': [vars(b) for b in state.blocks], 'merges': sorted(str(r) for r in ws.merged_cells.ranges)}, ensure_ascii=False))
