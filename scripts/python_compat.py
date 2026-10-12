"""Exercise the original CLI without changing its source or using personal data."""
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from wota_tool.xlsx_io import XlsxIO

path = Path(sys.argv[2])
song, bpm, state = XlsxIO._read_state_from_xlsx(path)
from openpyxl import load_workbook

ws = load_workbook(path).active
print(json.dumps({'song': song, 'bpm': bpm, 'blocks': [vars(b) for b in state.blocks], 'merges': sorted(str(r) for r in ws.merged_cells.ranges)}, ensure_ascii=False))
