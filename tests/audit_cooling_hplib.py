"""Confronta catalogCooling (TypeScript) con hplib.simulate in modalità 2 sulla stessa riga del CSV.

Uso: python tests/audit_cooling_hplib.py <griglia.json>
La griglia è prodotta dal test Vitest: [{id, csvRow, air, flow, eer, pThC_W}].
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data" / "sources" / "keymark"))
import pandas as pd  # noqa: E402
import hplib  # noqa: E402

grid = json.loads(Path(sys.argv[1]).read_text("utf-8"))
db = pd.read_csv(ROOT / "data" / "sources" / "keymark" / "hplib_database.csv")
bad = []
for g in grid:
    row = db.iloc[[g["csvRow"] - 2]]
    r = hplib.simulate(t_in_primary=g["air"], t_in_secondary=g["flow"] + 5, parameters=row, t_amb=g["air"], mode=2)
    eer, p_th = float(r["EER"]), -float(r["P_th"])
    if abs(eer - g["eer"]) > 1e-6 or abs(p_th - g["pThC_W"]) > 1e-3:
        bad.append((g["id"], g["air"], g["flow"], eer, g["eer"], p_th, g["pThC_W"]))
if bad:
    print("DIFFERENZE", bad)
    sys.exit(1)
print(f"OK {len(grid)} punti")
