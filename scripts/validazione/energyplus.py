"""Confronto con EnergyPlus (livello B): lato EnergyPlus.

Comandi (dalla radice del repository, Python del progetto):
  .venv/Scripts/python scripts/validazione/energyplus.py epw        clima EPW dagli stessi TMY PVGIS dei pacchetti (con e senza sole)
  .venv/Scripts/python scripts/validazione/energyplus.py idf        un IDF per clima × sopra × involucro × serramenti
  .venv/Scripts/python scripts/validazione/energyplus.py lancia     lancia EnergyPlus e scrive riferimento.csv
  .venv/Scripts/python scripts/validazione/energyplus.py confronta  confronta con motore.json e scrive docs/validazione/RISULTATI-B.md

Prima di «idf» va lanciato il lato motore (npx vite-node scripts/validazione/motore.ts), che scrive le maschere della stagione.
Unica fonte dei dati: validazione/energyplus/casi.json. Convenzioni dichiarate lì.
"""

import csv
import gzip
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "validazione" / "energyplus"
DIR = Path(__import__("os").environ.get("CASA_VALIDATION_DIR", str(DATA_DIR)))
GEN = DIR / "generati"
OUT = DIR / "uscite"
CASI = json.loads((DATA_DIR / "casi.json").read_text(encoding="utf-8"))
HOURS = 8760
MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
SETPOINT_OFF = -60.0


def suffix(sopra):
    """I casi con la copertura piana tengono gli id dei primi giri."""
    return "" if sopra["id"] == "piana" else f"_{sopra['id']}"


def case_ids(sopre=None):
    for c in CASI["climi"]:
        for sopra in sopre or CASI["sopra"]:
            for inv in CASI["involucri"]:
                for serr in ("oggi", "nuovi"):
                    for sole in ("sole", "senzasole"):
                        yield c, sopra, inv, serr, sole, f"{c['id']}_{inv['id']}_{serr}_{sole}{suffix(sopra)}"


def idf_name(c, sopra, inv, serr):
    return f"{c['id']}_{inv['id']}_{serr}{suffix(sopra)}.idf"


# ---------------------------------------------------------------- EPW

def dew_point(t, rh):
    """Magnus (Alduchov e Eskridge 1996)."""
    rh = min(max(rh, 1.0), 100.0)
    a, b = 17.625, 243.04
    g = math.log(rh / 100.0) + a * t / (b + t)
    return b * g / (a - g)


def write_epw(code, name, senza_sole):
    raw = json.loads(gzip.open(ROOT / "data" / "raw" / f"{code}_pvgis53_tmy.json.gz").read())
    loc = raw["inputs"]["location"]
    rows = raw["outputs"]["tmy_hourly"]
    if len(rows) != HOURS:
        raise SystemExit(f"{code}: {len(rows)} righe invece di {HOURS}")
    ir_med = sorted(r["IR(h)"] for r in rows)[HOURS // 2]
    if ir_med < 150:
        raise SystemExit(f"{code}: infrarosso del cielo non plausibile (mediana {ir_med} W/m²): EnergyPlus vedrebbe un cielo a decine di gradi sotto zero")
    lines = [
        f"LOCATION,{name},-,ITA,PVGIS TMY (SARAH3/ERA5),{code},{loc['latitude']:.4f},{loc['longitude']:.4f},1.0,{loc['elevation']:.1f}",
        "DESIGN CONDITIONS,0",
        "TYPICAL/EXTREME PERIODS,0",
        "GROUND TEMPERATURES,0",
        "HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0",
        "COMMENTS 1,Generato da scripts/validazione/energyplus.py dal TMY PVGIS dei pacchetti clima; riga UTC i nell'ora solare locale [i+1, i+2)",
        "COMMENTS 2," + ("Variante senza sole: irraggiamento a zero" if senza_sole else "Con sole"),
        "DATA PERIODS,1,1,Data,Wednesday, 1/ 1,12/31",
    ]
    k = 0
    for m, days in enumerate(MONTH_DAYS):
        for d in range(days):
            for h in range(24):
                r = rows[(k - 1) % HOURS]
                t = r["T2m"]
                ghi, dni, dhi = (0.0, 0.0, 0.0) if senza_sole else (r["G(h)"], r["Gb(n)"], r["Gd(h)"])
                f = [2025, m + 1, d + 1, h + 1, 60, "?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9",
                     f"{t:.1f}", f"{dew_point(t, r['RH']):.1f}", f"{r['RH']:.0f}", f"{r['SP']:.0f}",
                     9999, 9999, f"{r['IR(h)']:.0f}", f"{ghi:.0f}", f"{dni:.0f}", f"{dhi:.0f}",
                     999999, 999999, 999999, 9999, f"{r['WD10m']:.0f}", f"{r['WS10m']:.1f}",
                     5, 5, 9999, 99999, 9, 999999999, 999, 0.999, 0, 88, 0.2, 0, 1.0]
                lines.append(",".join(str(x) for x in f))
                k += 1
    p = GEN / f"{code}_{'senzasole' if senza_sole else 'sole'}.epw"
    p.write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")
    return p


def cmd_epw():
    GEN.mkdir(parents=True, exist_ok=True)
    for c in CASI["climi"]:
        for s in (False, True):
            p = write_epw(c["id"], c["nome"], s)
            print(p.name, hashlib.sha256(p.read_bytes()).hexdigest()[:16])


# ---------------------------------------------------------------- IDF

def energyplus_exe():
    """EnergyPlus installato (C:/EnergyPlusV*) o estratto dallo zip ufficiale; ENERGYPLUS_EXE ha la precedenza."""
    import os
    env = os.environ.get("ENERGYPLUS_EXE")
    cands = [Path(env)] if env else []
    for pat in ("C:/EnergyPlusV*/energyplus.exe", str(Path.home()).replace("\\", "/") + "/EnergyPlus*/energyplus.exe"):
        base, _, rest = pat.partition("EnergyPlus")
        cands += sorted(Path(base).glob("EnergyPlus" + rest))
    cands = [c for c in cands if c.exists()]
    if not cands:
        raise SystemExit("EnergyPlus non trovato: installarlo in C:/EnergyPlusV*/ o impostare ENERGYPLUS_EXE")
    exe = cands[-1]
    out = subprocess.run([str(exe), "--version"], capture_output=True, text=True).stdout
    m = re.search(r"Version (\d+)\.(\d+)\.(\d+)", out)
    if not m:
        raise SystemExit(f"Versione di EnergyPlus illeggibile: {out!r}")
    return exe, f"{m.group(1)}.{m.group(2)}"


def idf_text(version, clima, inv, serr, season_csv, sopra):
    box = CASI["box"]
    L, H = box["lato_m"], box["altezza_netta_m"]
    mat = CASI["materiali"]
    w = inv[f"serramenti_{serr}"]
    o = []
    add = o.append
    add(f"Version,{version};")
    add("SimulationControl,No,No,No,No,Yes,No,1;")
    add("Building,Box,0,Suburbs,0.04,0.4,FullInteriorAndExterior,25,6;")
    add("Timestep,6;")
    add("GlobalGeometryRules,UpperLeftCorner,Counterclockwise,Relative;")
    add("RunPeriod,Anno,1,1,,12,31,,,No,No,No,Yes,Yes;")
    add("Site:GroundReflectance,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2,0.2;")
    add("ScheduleTypeLimits,Any;")
    add("Schedule:Constant,SempreAcceso,Any,1;")
    add("Schedule:Constant,SempreSpento,Any,0;")
    add("Schedule:Constant,TipoControllo,Any,1;")
    add(f"Schedule:File,Setpoint,Any,{season_csv.name},1,0,8760,Comma,No,60;")  # accanto all'IDF: niente percorsi del computer
    for k, m in mat.items():
        add(f"Material,{k},MediumRough,{m['spessore']},{m['lambda']},{m['rho']},{m['c']},0.9,0.6,0.6;")
    add(f"WindowMaterial:SimpleGlazingSystem,Vetro,{w['U']},{w['g']},0.7;")
    add("Construction,Parete," + ",".join(inv["parete"]) + ";")
    add("Construction,Copertura," + ",".join(inv["copertura"]) + ";")
    # pavimento in casi.json dall'alto (lato stanza): la Construction va dall'esterno (sotto) all'interno
    add("Construction,Pavimento," + ",".join(reversed(inv["pavimento"])) + ";")
    add("Construction,Finestra,Vetro;")
    add(f"Zone,Box,0,0,0,0,1,1,{H},{L * L * H};")

    def surf(name, typ, cons, bc, verts, zone="Box", obj=""):
        sun, wind = ("SunExposed", "WindExposed") if bc == "Outdoors" else ("NoSun", "NoWind")
        v = ",".join(f"{x},{y},{z}" for x, y, z in verts)
        add(f"BuildingSurface:Detailed,{name},{typ},{cons},{zone},,{bc},{obj},{sun},{wind},autocalculate,{len(verts)},{v};")

    surf("Parete_S", "Wall", "Parete", "Outdoors", [(0, 0, H), (0, 0, 0), (L, 0, 0), (L, 0, H)])
    surf("Parete_E", "Wall", "Parete", "Outdoors", [(L, 0, H), (L, 0, 0), (L, L, 0), (L, L, H)])
    surf("Parete_N", "Wall", "Parete", "Outdoors", [(L, L, H), (L, L, 0), (0, L, 0), (0, L, H)])
    surf("Parete_O", "Wall", "Parete", "Outdoors", [(0, L, H), (0, L, 0), (0, 0, 0), (0, 0, H)])
    soffitto = [(0, L, H), (0, 0, H), (L, 0, H), (L, L, H)]
    if sopra["id"] == "piana":
        surf("Copertura", "Roof", "Copertura", "Outdoors", soffitto)
    elif sopra["id"] == "piano":
        # soffitto verso un piano riscaldato: strati del pavimento, dall'alto (piano sopra) alla stanza
        add("Construction,Soffitto," + ",".join(inv["pavimento"]) + ";")
        surf("Soffitto", "Ceiling", "Soffitto", "Adiabatic", soffitto)
    else:
        # sottotetto non riscaldato: seconda zona senza impianto, falde a sud e a nord, timpani a est e ovest
        r = (L / 2) * math.tan(math.radians(sopra["pendenza_gradi"]))
        add("Construction,Soffitto," + ",".join(inv["copertura"]) + ";")
        add("Construction,SolaioSottotetto," + ",".join(reversed(inv["copertura"])) + ";")
        add("Construction,Tetto," + ",".join(sopra["tetto"]) + ";")
        add("Construction,Timpano," + ",".join(sopra["timpani"]) + ";")
        add(f"Zone,Sottotetto,0,0,0,0,1,1,{r:.4f},{L * L * r / 2:.4f};")
        surf("Soffitto", "Ceiling", "Soffitto", "Surface", soffitto, obj="Sottotetto_Pavimento")
        surf("Sottotetto_Pavimento", "Floor", "SolaioSottotetto", "Surface",
             [(L, L, H), (L, 0, H), (0, 0, H), (0, L, H)], zone="Sottotetto", obj="Soffitto")
        surf("Falda_S", "Roof", "Tetto", "Outdoors", [(0, L / 2, H + r), (0, 0, H), (L, 0, H), (L, L / 2, H + r)], zone="Sottotetto")
        surf("Falda_N", "Roof", "Tetto", "Outdoors", [(L, L / 2, H + r), (L, L, H), (0, L, H), (0, L / 2, H + r)], zone="Sottotetto")
        surf("Timpano_E", "Wall", "Timpano", "Outdoors", [(L, L / 2, H + r), (L, 0, H), (L, L, H)], zone="Sottotetto")
        surf("Timpano_O", "Wall", "Timpano", "Outdoors", [(0, L / 2, H + r), (0, L, H), (0, 0, H)], zone="Sottotetto")
        add(f"ZoneInfiltration:DesignFlowRate,Ricambi_sottotetto,Sottotetto,SempreAcceso,AirChanges/Hour,,,,{sopra['ricambi_h']},1,0,0,0;")
    surf("Pavimento", "Floor", "Pavimento", "Adiabatic", [(L, L, 0), (L, 0, 0), (0, 0, 0), (0, L, 0)])
    h_win, sill = 1.5, 0.8
    for orient in ("N", "E", "S", "O"):
        a = box["finestre_m2"][orient]
        if a <= 0:
            continue
        width = a / h_win
        add(f"Window,Finestra_{orient},Finestra,Parete_{orient},,1,{(L - width) / 2:.4f},{sill},{width:.4f},{h_win};")
    add(f"ZoneInfiltration:DesignFlowRate,Infiltrazioni,Box,SempreAcceso,AirChanges/Hour,,,,{inv['ricambi_h']},1,0,0,0;")
    add(f"ElectricEquipment,Apporti,Box,SempreAcceso,Watts/Area,,{box['apporti_interni_W_m2']},,0,0,0,Apporti;")
    add("ZoneControl:Thermostat,Termostato,Box,TipoControllo,ThermostatSetpoint:SingleHeating,SoloCaldo;")
    # temperatura operante (frazione radiante 0,5), come il nodo unico del motore: docs/validazione/CORREZIONE-MOTORE.md §1
    add("ZoneControl:Thermostat:OperativeTemperature,Termostato,Constant,0.5;")
    add("ThermostatSetpoint:SingleHeating,SoloCaldo,Setpoint;")
    add("ZoneHVAC:EquipmentConnections,Box,Box_Apparecchi,Box_Ingresso,,Box_Aria,Box_Ritorno;")
    add("ZoneHVAC:EquipmentList,Box_Apparecchi,SequentialLoad,ZoneHVAC:IdealLoadsAirSystem,Box_Ideale,1,1,,;")
    add("ZoneHVAC:IdealLoadsAirSystem,Box_Ideale,SempreAcceso,Box_Ingresso,,,60,13,0.0156,0.0077,NoLimit,,,NoLimit,,,SempreAcceso,SempreSpento;")
    add("Output:Variable,*,Zone Ideal Loads Zone Sensible Heating Energy,Hourly;")
    add("Output:Variable,Box,Zone Mean Air Temperature,Hourly;")
    add("Output:Diagnostics,DisplayExtraWarnings;")
    return "\n".join(o) + "\n"


def setpoint_csv(code):
    src = GEN / f"stagione_{code}.csv"
    if not src.exists():
        raise SystemExit(f"Manca {src.name}: lanciare prima npx vite-node scripts/validazione/motore.ts")
    vals = [int(x) for x in src.read_text().split()]
    if len(vals) != HOURS:
        raise SystemExit(f"{src.name}: {len(vals)} righe")
    dst = GEN / f"setpoint_{code}.csv"
    sp = CASI["box"]["setpoint_C"]
    dst.write_text("\n".join(str(sp if v else SETPOINT_OFF) for v in vals) + "\n", newline="\n")
    return dst


def cmd_idf():
    _, version = energyplus_exe()
    GEN.mkdir(parents=True, exist_ok=True)
    for c in CASI["climi"]:
        sp = setpoint_csv(c["id"])
        for sopra in CASI["sopra"]:
            for inv in CASI["involucri"]:
                for serr in ("oggi", "nuovi"):
                    p = GEN / idf_name(c, sopra, inv, serr)
                    p.write_text(idf_text(version, c, inv, serr, sp.resolve(), sopra), encoding="ascii", newline="\n")
    if __import__("os").environ.get("CASA010_ATTIC_ONLY"):
        # Solo 12 varianti richieste: solaio verso il sottotetto portato a U=0,25.
        for c in CASI["climi"]:
            sopra = next(x for x in CASI["sopra"] if x["id"] == "sottotetto")
            for inv in CASI["involucri"]:
                src = GEN / idf_name(c, sopra, inv, "oggi")
                txt = src.read_text()
                thick = "0.1191"
                mat = f"Material,IsolanteSolaio,MediumRough,{thick},0.035,20,1450,0.9,0.6,0.6;\n"
                if inv["id"] == "dopo2010":
                    txt = txt.replace("Construction,Soffitto,cls_5,xps_14,laterocemento_20,intonaco_int;\nConstruction,SolaioSottotetto,intonaco_int,laterocemento_20,xps_14,cls_5;", mat + "Construction,Soffitto,cls_5,IsolanteSolaio,laterocemento_20,intonaco_int;\nConstruction,SolaioSottotetto,intonaco_int,laterocemento_20,IsolanteSolaio,cls_5;")
                else:
                    txt = txt.replace("Construction,Soffitto,cls_5,laterocemento_20,intonaco_int;\nConstruction,SolaioSottotetto,intonaco_int,laterocemento_20,cls_5;", mat + "Construction,Soffitto,cls_5,laterocemento_20,IsolanteSolaio,intonaco_int;\nConstruction,SolaioSottotetto,intonaco_int,IsolanteSolaio,laterocemento_20,cls_5;")
                (GEN / f"iso_{c['id']}_{inv['id']}_oggi_sottotetto.idf").write_text(txt, encoding="ascii", newline="\n")
    print(f"IDF scritti per EnergyPlus {version}")


# ---------------------------------------------------------------- lancio

def read_hourly(csv_path):
    with open(csv_path, newline="") as f:
        rd = csv.reader(f)
        head = next(rd)
        col = next(i for i, h in enumerate(head) if "Zone Ideal Loads Zone Sensible Heating Energy" in h)
        vals = [float(r[col]) / 3.6e6 for r in rd]
    if len(vals) != HOURS:
        raise SystemExit(f"{csv_path}: {len(vals)} ore invece di {HOURS}")
    return vals


def cmd_lancia():
    exe, version = energyplus_exe()
    OUT.mkdir(parents=True, exist_ok=True)
    righe = []
    attic_config = CASI["interventi_010"]["isolamento_solaio_sottotetto"]
    selected = (x for x in case_ids([next(s for s in CASI["sopra"] if s["id"] == attic_config["sopra"])]) if x[3] == attic_config["serramenti"]) if __import__("os").environ.get("CASA010_ATTIC_ONLY") else case_ids()
    for c, sopra, inv, serr, sole, cid in selected:
        out = OUT / cid
        out.mkdir(exist_ok=True)
        idf = GEN / (f"iso_{c['id']}_{inv['id']}_{serr}_sottotetto.idf" if __import__("os").environ.get("CASA010_ATTIC_ONLY") else idf_name(c, sopra, inv, serr))
        epw = GEN / f"{c['id']}_{sole}.epw"
        r = subprocess.run([str(exe), "-w", str(epw), "-d", str(out), "-r", str(idf)], capture_output=True, text=True)
        err = (out / "eplusout.err").read_text(errors="replace") if (out / "eplusout.err").exists() else ""
        if r.returncode != 0 or "EnergyPlus Completed Successfully" not in err:
            print(r.stdout[-2000:], r.stderr[-2000:], err[-3000:])
            raise SystemExit(f"{cid}: EnergyPlus non è terminato correttamente")
        severe = len(re.findall(r"\*\* Severe", err))
        warn = len(re.findall(r"\*\* Warning", err))
        h = read_hourly(out / "eplusout.csv")
        monthly, k = [], 0
        for d in MONTH_DAYS:
            monthly.append(sum(h[k:k + d * 24]))
            k += d * 24
        righe.append([cid, f"{sum(h):.2f}", *[f"{v:.2f}" for v in monthly], warn, severe])
        print(f"{cid}: {sum(h):.0f} kWh ({warn} avvisi)")
    with open(DIR / "riferimento.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow([f"# EnergyPlus {version}"])
        w.writerow(["id", "fabbisogno_kWh", *[f"m{m + 1:02d}" for m in range(12)], "avvisi", "gravi"])
        w.writerows(righe)


# ---------------------------------------------------------------- confronto

def load_ref():
    ref, version = {}, ""
    with open(DIR / "riferimento.csv", newline="") as f:
        rows = list(csv.reader(f))
    version = rows[0][0].lstrip("# ").strip()
    for r in rows[2:]:
        ref[r[0]] = {"annuo": float(r[1]), "mensile": [float(x) for x in r[2:14]]}
    return ref, version


def fmt(x, nd=0):
    return f"{x:,.{nd}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(x):
    return f"{x * 100:+.1f}%".replace(".", ",")


def cmd_confronta():
    mot = {c["id"]: c for c in json.loads((DIR / "motore.json").read_text(encoding="utf-8"))["casi"]}
    ref, version = load_ref()
    s = CASI["soglie"]
    area = CASI["box"]["lato_m"] ** 2
    nomi = {c["id"]: c["nome"] for c in CASI["climi"]}
    inv_n = {i["id"]: i["nome"] for i in CASI["involucri"]}
    sopra_n = {x["id"]: x["nome"] for x in CASI["sopra"]}
    out = ["# Confronto con EnergyPlus (livello B) — risultati", "",
           f"Generato da `scripts/validazione/energyplus.py confronta` con {version}. Casi e convenzioni: `validazione/energyplus/casi.json`; piano: `docs/validazione/PIANO.md` §3. Lettura dei risultati: `docs/validazione/ANALISI-B.md`.", "",
           f"Soglie (`docs/validazione/PIANO.md` §3): errore annuo ≤ {s['errore_annuo_max'] * 100:.0f}%; errore sul risparmio ≤ max({s['errore_risparmio_quota_risparmio'] * 100:.0f}% del risparmio di EnergyPlus; {s['errore_risparmio_quota_base'] * 100:.0f}% del fabbisogno di partenza di EnergyPlus); nessun cambio di segno del risparmio.", "",
           "## Riepilogo", "",
           "| Sopra la stanza | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |",
           "|---|---:|---:|---:|---:|"]
    corpo = []
    for sopra in CASI["sopra"]:
        info = sopra["id"] == "sottotetto"
        corpo += ["", f"## {sopra_n[sopra['id']]}", "", "### Fabbisogno annuo di riscaldamento", "",
                  "| Clima | Involucro | Serramenti | Sole | EnergyPlus kWh | Motore kWh | kWh/m² EnergyPlus | Errore | Esito |"
                  + (" Motore con b = 0,9 (informazione) |" if info else ""),
                  "|---|---|---|---|---:|---:|---:|---:|---|" + ("---:|" if info else "")]
        n = {"sole": [0, 0], "senzasole": [0, 0]}
        for c, _, inv, serr, sole, cid in case_ids([sopra]):
            e, m = ref[cid]["annuo"], mot[cid]["fabbisogno_kWh"]
            err = (m - e) / e if e > 0 else (0.0 if m == 0 else float("inf"))
            ok = abs(err) <= s["errore_annuo_max"]
            n[sole][0] += ok
            n[sole][1] += 1
            extra = ""
            if info:
                m9 = mot[cid]["fabbisogno_b09_kWh"]
                extra = f" {fmt(m9)} ({pct((m9 - e) / e) if e > 0 else '—'}) |"
            corpo.append(f"| {nomi[c['id']]} | {inv_n[inv['id']]} | {serr} | {'sì' if sole == 'sole' else 'no'} | {fmt(e)} | {fmt(m)} | {fmt(e / area, 1)} | {pct(err) if math.isfinite(err) else '—'} | {'entro' if ok else '**fuori**'} |" + extra)
        if info:
            b = {inv["id"]: mot[f"{CASI['climi'][0]['id']}_{inv['id']}_oggi_sole_sottotetto"]["b"] for inv in CASI["involucri"]}
            corpo += ["", "Fattore b del motore (UNI EN ISO 13789): " + "; ".join(f"{inv_n[k]} {fmt(v, 2)}" for k, v in b.items()) + "."]
        corpo += ["", "### Risparmio dei serramenti nuovi", "",
                  "| Clima | Involucro | Sole | Risparmio EnergyPlus kWh | Risparmio motore kWh | Differenza kWh | Tolleranza kWh | Segno | Esito |",
                  "|---|---|---|---:|---:|---:|---:|---|---|"]
        r_ok = r_tot = 0
        for c in CASI["climi"]:
            for inv in CASI["involucri"]:
                for sole in ("sole", "senzasole"):
                    a = f"{c['id']}_{inv['id']}_oggi_{sole}{suffix(sopra)}"
                    b2 = f"{c['id']}_{inv['id']}_nuovi_{sole}{suffix(sopra)}"
                    se = ref[a]["annuo"] - ref[b2]["annuo"]
                    sm = mot[a]["fabbisogno_kWh"] - mot[b2]["fabbisogno_kWh"]
                    tol = max(s["errore_risparmio_quota_risparmio"] * abs(se), s["errore_risparmio_quota_base"] * ref[a]["annuo"])
                    segno_ok = not (abs(se) > tol and se * sm < 0)
                    ok = abs(sm - se) <= tol and segno_ok
                    r_tot += 1
                    r_ok += ok
                    corpo.append(f"| {nomi[c['id']]} | {inv_n[inv['id']]} | {'sì' if sole == 'sole' else 'no'} | {fmt(se)} | {fmt(sm)} | {fmt(sm - se)} | {fmt(tol)} | {'uguale' if segno_ok else '**opposto**'} | {'entro' if ok else '**fuori**'} |")
        corpo += ["", "### Andamento mensile (kWh, EnergyPlus / motore; serramenti di oggi, con il sole)", ""]
        for c, _, inv, serr, sole, cid in case_ids([sopra]):
            if serr != "oggi" or sole != "sole":
                continue
            e, m = ref[cid]["mensile"], mot[cid]["mensile_kWh"]
            cells = " | ".join(f"{fmt(x)} / {fmt(y)}" for x, y in zip(e, m))
            corpo.append(f"- {nomi[c['id']]}, {inv_n[inv['id']]}: {cells}")
        tot = n["sole"][0] + n["senzasole"][0]
        out.append(f"| {sopra_n[sopra['id']]} | {tot} su {n['sole'][1] + n['senzasole'][1]} | {n['senzasole'][0]} su {n['senzasole'][1]} | {n['sole'][0]} su {n['sole'][1]} | {r_ok} su {r_tot} |")
        print(f"{sopra['id']}: annuo {tot}/{n['sole'][1] + n['senzasole'][1]} (senza sole {n['senzasole'][0]}, con sole {n['sole'][0]}); risparmio {r_ok}/{r_tot}")
    out += corpo
    out += ["", "## Differenze note fra i due modelli", "",
            "- Il motore è a un nodo (1R1C): una sola capacità, apporti solari e interni direttamente sull'aria. EnergyPlus risolve ogni parete a strati, con scambi radianti interni.",
            "- Sottotetto: EnergyPlus lo simula come una zona con sole, vento e cielo; il motore usa il fattore b verso l'aria esterna, senza sole.",
            "- Facciate: entrambi usano Perez. Il motore applica ai vetri il modificatore angolare fisico di un doppio vetro pvlib; EnergyPlus usa la curva angolare del vetro semplificato.",
            "- Aria: il motore usa ρc = 1200 J/m³K costante; EnergyPlus la densità dell'aria esterna reale (più bassa in quota).",
            "- Coefficienti liminari: il motore usa Rsi fisso e il coefficiente esterno dal vento (UNI EN ISO 6946, appendice C); EnergyPlus calcola entrambi ora per ora.",
            ""]
    (ROOT / "docs" / "validazione" / "RISULTATI-B.md").write_text("\n".join(out), encoding="utf-8", newline="\n")


def cmd_diagnosi():
    """Scompone la differenza sul clima di Milano: sole sugli opachi, sole dai vetri, perdite effettive dei vetri e delle pareti."""
    exe, version = energyplus_exe()
    code = "015146"
    mask = [int(x) for x in (GEN / f"stagione_{code}.csv").read_text().split()]
    raw = json.loads(gzip.open(ROOT / "data" / "raw" / f"{code}_pvgis53_tmy.json.gz").read())["outputs"]["tmy_hourly"]
    dh = sum((CASI["box"]["setpoint_C"] - raw[(k - 1) % HOURS]["T2m"]) * m for k, m in enumerate(mask)) / 1000
    extra = ("Output:Variable,*,Surface Window Heat Loss Energy,Hourly;\nOutput:Variable,*,Surface Window Heat Gain Energy,Hourly;\n"
             "Output:Variable,*,Surface Window Transmitted Solar Radiation Energy,Hourly;\n"
             "Output:Variable,*,Surface Inside Face Conduction Heat Transfer Energy,Hourly;\n")
    mot = {c["id"]: c for c in json.loads((DIR / "motore.json").read_text(encoding="utf-8"))["casi"]}
    res = {"versione": version, "clima": code, "gradi_ora_kKh": round(dh, 1), "casi": {}}
    for inv in CASI["involucri"]:
        for serr in ("oggi", "nuovi"):
            base = (GEN / f"{code}_{inv['id']}_{serr}.idf").read_text().replace("Output:Diagnostics,DisplayExtraWarnings;\n", extra)
            # le copie in.idf stanno fuori da GEN: il file della stagione si indica con il percorso intero, solo qui
            base = base.replace(f"Any,setpoint_{code}.csv,", f"Any,{(GEN / f'setpoint_{code}.csv').as_posix()},")
            # variante: solo le facce esterne di pareti e copertura non assorbono il sole
            noabs = re.sub(r"^(Material,intonaco_est,.*),0\.9,0\.6,0\.6;$", r"\1,0.9,0.01,0.6;", base, flags=re.M)
            noabs = noabs.replace("Construction,Copertura,cls_5,", "Construction,Copertura,cls_5_est,")
            m = CASI["materiali"]["cls_5"]
            noabs += f"Material,cls_5_est,MediumRough,{m['spessore']},{m['lambda']},{m['rho']},{m['c']},0.9,0.01,0.6;\n"
            out = {}
            for nome, idf, sole in (("sole", base, "sole"), ("sole_vetri_soli", noabs, "sole"), ("senza_sole", base, "senzasole")):
                d = OUT / f"diagnosi_{inv['id']}_{serr}_{nome}"
                d.mkdir(parents=True, exist_ok=True)
                (d / "in.idf").write_text(idf, encoding="ascii", newline="\n")
                subprocess.run([str(exe), "-w", str(GEN / f"{code}_{sole}.epw"), "-d", str(d), "-r", str(d / "in.idf")], capture_output=True)
                with open(d / "eplusout.csv", newline="") as f:
                    rows = list(csv.reader(f))
                h, rows = rows[0], rows[1:]

                def tot(pred, season=True):
                    cols = [i for i, n in enumerate(h) if pred(n)]
                    return sum(sum(float(x[i]) for i in cols) for k, x in enumerate(rows) if mask[k] or not season) / 3.6e6
                q = tot(lambda n: "Ideal Loads" in n, season=False)
                rec = {"fabbisogno_kWh": round(q)}
                if nome == "senza_sole":
                    vetri = tot(lambda n: "Window Heat Loss" in n) - tot(lambda n: "Window Heat Gain" in n)
                    pareti = -tot(lambda n: n.startswith("PARETE") and "Conduction" in n)
                    rec |= {"perdita_vetri_kWh": round(vetri), "U_efficace_vetri": round(vetri / (16 * dh), 2),
                            "perdita_pareti_kWh": round(pareti), "U_efficace_pareti": round(pareti / (92 * dh), 2),
                            "perdita_copertura_kWh": round(-tot(lambda n: n.startswith("COPERTURA") and "Conduction" in n))}
                else:
                    rec["solare_dai_vetri_stagione_kWh"] = round(tot(lambda n: "Window Transmitted" in n))
                out[nome] = rec
            e = {k: v["fabbisogno_kWh"] for k, v in out.items()}
            mo = mot[f"{code}_{inv['id']}_{serr}_sole"]["fabbisogno_kWh"]
            ms = mot[f"{code}_{inv['id']}_{serr}_senzasole"]["fabbisogno_kWh"]
            out["scomposizione_kWh"] = {
                "effetto_sole_vetri_energyplus": e["senza_sole"] - e["sole_vetri_soli"],
                "effetto_sole_opachi_energyplus": e["sole_vetri_soli"] - e["sole"],
                "effetto_sole_motore": round(ms - mo),
            }
            res["casi"][f"{inv['id']}_{serr}"] = out
            print(inv["id"], serr, out["scomposizione_kWh"])
    (DIR / "diagnosi.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def cmd_vetri():
    """Sole dai vetri sul clima di Milano, box con il piano sopra: irraggiamento sulle facciate, sole trasmesso e
    guadagno solare totale (differenza del flusso netto dei vetri fra con e senza sole), nella stagione di riscaldamento."""
    exe, version = energyplus_exe()
    code = "015146"
    mask = [int(x) for x in (GEN / f"stagione_{code}.csv").read_text().split()]
    sopra = next(x for x in CASI["sopra"] if x["id"] == "piano")
    extra = ("Output:Variable,*,Surface Window Heat Loss Energy,Hourly;\nOutput:Variable,*,Surface Window Heat Gain Energy,Hourly;\n"
             "Output:Variable,*,Surface Window Transmitted Solar Radiation Energy,Hourly;\n"
             "Output:Variable,*,Surface Outside Face Incident Solar Radiation Rate per Area,Hourly;\n")
    res = {"versione": version, "clima": code, "sopra": "piano", "unita": "kWh nella stagione; irraggiamento in kWh/m²", "casi": {}}
    for inv in CASI["involucri"]:
        for serr in ("oggi", "nuovi"):
            base = (GEN / idf_name({"id": code}, sopra, inv, serr)).read_text().replace("Output:Diagnostics,DisplayExtraWarnings;\n", extra)
            # variante: le facce esterne delle pareti non assorbono il sole (resta solo il sole dei vetri)
            noabs = re.sub(r"^(Material,intonaco_est,.*),0\.9,0\.6,0\.6;$", r"\1,0.9,0.01,0.6;", base, flags=re.M)
            out = {}
            for sole, idf in (("sole", base), ("senzasole", base), ("sole_vetri_soli", noabs)):
                d = OUT / f"vetri_{inv['id']}_{serr}_{sole}"
                d.mkdir(parents=True, exist_ok=True)
                (d / "in.idf").write_text(idf, encoding="ascii", newline="\n")
                epw = GEN / f"{code}_{'senzasole' if sole == 'senzasole' else 'sole'}.epw"
                subprocess.run([str(exe), "-w", str(epw), "-d", str(d), "-r", str(d / "in.idf")], capture_output=True)
                with open(d / "eplusout.csv", newline="") as f:
                    rows = list(csv.reader(f))
                h, rows = rows[0], rows[1:]
                fabb = sum(float(x[i]) for x in rows for i, n in enumerate(h) if "Ideal Loads" in n) / 3.6e6

                def tot(pred, scale=3.6e6):
                    cols = [i for i, n in enumerate(h) if pred(n)]
                    return sum(sum(float(x[i]) for i in cols) for k, x in enumerate(rows) if mask[k]) / scale
                r = {"fabbisogno": fabb, "netto_vetri": tot(lambda n: "Window Heat Gain" in n) - tot(lambda n: "Window Heat Loss" in n),
                     "trasmesso": tot(lambda n: "Window Transmitted" in n)}
                for o in ("N", "E", "S", "O"):
                    r[f"incidente_{o}"] = tot(lambda n, o=o: n.startswith(f"FINESTRA_{o}:") and "Incident Solar" in n, 1000)
                out[sole] = r
            win = CASI["box"]["finestre_m2"]
            out["guadagno_solare_totale"] = out["sole"]["netto_vetri"] - out["senzasole"]["netto_vetri"]
            out["effetto_sole_vetri"] = out["senzasole"]["fabbisogno"] - out["sole_vetri_soli"]["fabbisogno"]
            out["effetto_sole_pareti"] = out["sole_vetri_soli"]["fabbisogno"] - out["sole"]["fabbisogno"]
            out["sole_sui_vetri"] = sum(win[o] * out["sole"][f"incidente_{o}"] for o in ("N", "E", "S", "O"))
            res["casi"][f"{inv['id']}_{serr}"] = {k: (round(v, 1) if isinstance(v, float) else {kk: round(vv, 1) for kk, vv in v.items()}) for k, v in out.items()}
            print(inv["id"], serr, res["casi"][f"{inv['id']}_{serr}"])
    (DIR / "vetri.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    cmds = {"epw": cmd_epw, "idf": cmd_idf, "lancia": cmd_lancia, "confronta": cmd_confronta, "diagnosi": cmd_diagnosi, "vetri": cmd_vetri}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        raise SystemExit(__doc__)
    cmds[sys.argv[1]]()
