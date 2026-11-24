"""Estrae un piccolo catalogo di pompe di calore aria/acqua inverter dal database hplib (dati HP Keymark).

Fonte: hplib (codice MIT, database CSV CC BY 4.0), hplib/hplib_database.csv, parametri adattati ai dati pubblici
HP Keymark (EN 14511 / EN 14825). Modello: COP = p1·T_in + p2·T_out + p3 + p4·T_amb;
P_el = P_el_ref·(p1e·T_in + p2e·T_out + p3e + p4e·T_amb); P_th = P_el·COP (T_out = mandata).

Uso: .venv/Scripts/python scripts/data/build_hp_catalog.py
Output: src/engine/data/heatpumps.json
"""

import hashlib
import json
import re
from pathlib import Path

import pandas as pd
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
CSV = ROOT / "data" / "sources" / "keymark" / "hplib_database.csv"
SRC = CSV.parent

# (costruttore, modello) scelti: aria/acqua regolati (gruppo 1), errori di adattamento contenuti, potenze diverse
SELECTION = [
    ("Acond a.s.", "Acond PRO-N"),
    ("KRONOTERM d.o.o.", "VERSI 0209"),
    ("ait-deutschland GmbH", "Hybrox 8"),
    ("Acond a.s.", "Acond PRO-R"),
    ("Bosch Thermotechnik GmbH", " Bosch Compress CS3400iAWS 10,12,14 OR-T"),
    ("KRONOTERM d.o.o.", "ADAPT 0724"),
    # reversibili, aggiunte per il raffrescamento: gruppo 1, fit EER presente, MAPE EER e P_th ≤ 15%, MAPE P_el in
    # raffrescamento ≤ 20%, otto punti hplib; per fascia di potenza (5–9 e 10–16 kW) l'errore complessivo minore
    ("Advantix S.p.A.", "i-32V5 10/12"),
    ("Panasonic Marketing Europe GmbH", "Aquarea T-CAP 9-12 kW (M Series)"),
]
VARIANTS = [
    ("Acond PRO-N", "acond-n", "037-0075-22"),
    ("VERSI-O 0209-K1 HT / HK 1F", "versi", "011-1W0519"),
    ("Helox 8", "hybrox", "041-K001-52"),
    ("Acond PRO-R", "acond-r", "037-0076-22"),
    ("CS3400iAWS 14 ORB-T", "bosch", None),
    ("ADAPT 0724-K3 HT / HK 3F", "adapt", "011-1W0518"),
    ("i-32V5/KA/10", "advantix", None),
    ("WH-ADC0316M9E82 / WH-WXG12ME8", "panasonic-tcap", None),
]

NEW_IDS = {"advantix", "panasonic-tcap"}
COOL_MAX_MAPE_EER = 15
COOL_MAX_MAPE_PEL = 20


def cooling_fit(r):
    """Parametri hplib del raffrescamento (modalità 2), solo se la riga li ha."""
    if pd.isna(r["p1_EER [-]"]):
        return {}
    return {
        "eer": [float(r["p1_EER [-]"]), float(r["p2_EER [-]"]), float(r["p3_EER [-]"]), float(r["p4_EER [-]"])],
        "pElC": [float(r["p1_P_el_c [1/°C]"]), float(r["p2_P_el_c [1/°C]"]), float(r["p3_P_el_c [-]"]), float(r["p4_P_el_c [1/°C]"])],
        "pElCRef_W": float(r["P_el_c_ref [W]"]),
        "eerRef": float(r["EER_c_ref"]),
        "mapeCooling": {"eer": round(float(r["MAPE EER"]), 1), "pEl": round(float(r["MAPE P_el_c"]), 1)},
    }


def fit_metadata(title):
    validation = pd.read_csv(SRC / "relative_error.csv")
    rows = validation[(validation["titel"] == title) & (validation["Group"] == 1) & validation["P_th_real"].notna()]
    points = [{"air": float(r.T_in), "flow": float(r.T_out), "cop": float(r.COP_real), "pTh_W": float(r.P_th_real), "pEl_W": float(r.P_el_real)} for r in rows.itertuples()]
    if len(points) != 8:
        raise ValueError(f"Punti hplib inattesi per {title}: {len(points)}")
    cop = [[p["air"], p["flow"]] for p in points]
    power = [p for p in cop if p[0] not in (7, 12)]
    return {
        "points": power,
        "copPoints": cop,
        "observations": points,
        "source": "hplib/hplib_database.py, calculate_fitting_parameters, righe 369–456; output/relative_error.csv, revisione " + json.loads((SRC / "hplib-source.json").read_text("utf-8"))["revision"],
        "conditions": "EN 14825, clima medio, aria/acqua regolata; COP: 8 punti, P_el: solo i 4 punti ad aria −7 e +2 °C. Mandate variabili 34/52, 30/42, 27/36, 24/30 °C assegnate dalla pipeline hplib. TOL e WTOL non delimitano il fit.",
        "validationSha256": hashlib.sha256((SRC / "relative_error.csv").read_bytes()).hexdigest(),
    }


def main():
    raw = CSV.read_bytes()
    d = pd.read_csv(CSV)
    out = []
    certificates = json.loads((SRC / "certificates-source.json").read_text("utf-8"))
    source = json.loads((SRC / "hplib-source.json").read_text("utf-8"))
    for f in source["files"]:
        path = ROOT / "data" / "sources" / f["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != f["sha256"]:
            raise SystemExit(f"Fonte hplib modificata: {f['path']}")
    for (man, model), (title, certificate_name, registration) in zip(SELECTION, VARIANTS):
        rows = d[(d["Manufacturer"].str.strip() == man.strip()) & (d["Model"].str.strip() == model.strip()) & (d["Group"] == 1)]
        if rows.empty:
            raise SystemExit(f"non trovato: {man} {model}")
        # più righe per lo stesso modello (es. unità interne diverse): si sceglie quella con errore di adattamento minore
        rows = rows.assign(_err=rows["MAPE P_th"] + rows["MAPE COP"]).sort_values("_err")
        print(f"{model}: {len(rows)} righe, errori P_th/COP: " + ", ".join(f"{a:.1f}/{b:.1f}" for a, b in zip(rows["MAPE P_th"], rows["MAPE COP"])))
        r = rows.iloc[0]
        if r["Titel"] != title:
            raise SystemExit(f"La selezione è cambiata per {model}: verificare la variante prima di rigenerare")
        if float(r["MAPE P_th"]) > 15:
            print(f"  escluso: errore sulla potenza {float(r['MAPE P_th']):.1f}% > 15%")
            continue
        certificate = dict(next(c for c in certificates if c["name"] == certificate_name))
        certificate["registration"] = registration
        certificate["revision"] = None
        certificate["schemeRevision"] = None
        certificate["standardsEdition"] = "EN 14511 / EN 14825, edizioni non specificate nel report acquisito; non attribuite automaticamente alle edizioni correnti"
        if certificate.get("path"):
            text = "\n".join(p.extract_text() for p in PdfReader(ROOT / "data" / "sources" / certificate["path"]).pages)
            match = re.search(r"Registration number\s+([^\n]+)", text)
            certificate["registration"] = match[1].strip() if match else registration
            match = re.search(r"Testing basis\s+(.*?)\nTesting laboratory", text, re.S)
            certificate["schemeRevision"] = " ".join(match[1].split()) if match else None
            certificate["revision"] = "Non indicata nel report acquisito; copia identificata da data di esportazione e SHA256"
            certificate["verification"] = "Report acquisito; identità e metadati verificati, non una validazione della curva di capacità"
        elif registration:
            certificate["verification"] = "Report originale non acquisito (HTTP 500); registrazione dal registro pubblico, revisione e hash del PDF non verificati"
        else:
            certificate["verification"] = f"Report originale non acquisito: {certificate.get('error', 'non cercato')}; registrazione, revisione e hash non verificati"
        e = {
            # le macchine aggiunte per il raffrescamento usano il nome breve: il modello contiene «/» e parentesi
            "id": certificate_name if certificate_name in NEW_IDS else f"{man.split()[0].lower()}-{model.strip().split()[-1].lower()}".replace(",", ""),
            "manufacturer": man.strip(),
            "model": title,
            "family": model.strip(),
            "variant": title,
            "csvRow": int(r.name) + 2,
            "certificate": certificate,
            "fitDomain": fit_metadata(title),
            "extrapolationPolicy": "segnala",
            "scopConditions": "EN 14825, bassa temperatura, clima medio (dato del CSV hplib)",
            "keymarkDate": None if pd.isna(r["Date"]) else str(r["Date"]),
            "refrigerant": None if pd.isna(r["Refrigerant"]) else str(r["Refrigerant"]),
            "ratedPowerLowT_kW": float(r["Rated Power low T [kW]"]),
            "ratedPowerMediumT_kW": float(r["Rated Power medium T [kW]"]),
            "scop": float(r["SCOP"]),
            "tol_C": float(r["Tolerance temperature [°C]"]),
            "maxFlow_C": float(r["Max. water heating temperature [°C]"]),
            "pElRef_W": float(r["P_el_h_ref [W]"]),
            "pThRef_W": float(r["P_th_h_ref [W]"]),
            "pEl": [float(r["p1_P_el_h [1/°C]"]), float(r["p2_P_el_h [1/°C]"]), float(r["p3_P_el_h [-]"]), float(r["p4_P_el_h [1/°C]"])],
            "cop": [float(r["p1_COP [-]"]), float(r["p2_COP [-]"]), float(r["p3_COP [-]"]), float(r["p4_COP [-]"])],
            "mape": {"pTh": round(float(r["MAPE P_th"]), 1), "pEl": round(float(r["MAPE P_el"]), 1), "cop": round(float(r["MAPE COP"]), 1)},
            **cooling_fit(r),
        }
        if "eer" in e and (e["mapeCooling"]["eer"] > COOL_MAX_MAPE_EER or e["mapeCooling"]["pEl"] > COOL_MAX_MAPE_PEL):
            raise SystemExit(f"Fit di raffrescamento oltre i limiti per {title}: {e['mapeCooling']}")
        out.append(e)
    payload = {
        "source": "hplib (codice MIT, CSV CC BY 4.0) – parametri adattati ai dati pubblici HP Keymark (EN 14511/EN 14825); https://github.com/FZJ-IEK3-VSA/hplib",
        "license": "Codice hplib: MIT, Copyright (c) 2021 Tjarko Tjaden, Hauke Hoops, RE-Lab-Projects; testo in data/sources/keymark/LICENSE-hplib. Database CSV: CC BY 4.0 come dichiarato nel README della revisione acquisita.",
        "revision": source["revision"],
        "sourceFiles": source["files"],
        "notes": "Fit COP su 8 punti; fit P_el su 4 punti: l'inviluppo comune è registrato in fitDomain.points. Oltre l'inviluppo l'app conta ore ed energia estrapolate; restano i blocchi prudenziali sotto −7 °C e oltre 55 °C di mandata, con saturazione dell'aria a 12 °C nelle ore miti. Correzione di capacità a −7 °C non validata, anch'essa segnalata se estrapola. TOL è il limite della dichiarazione usata, non un dominio osservato.",
        "csvSha256": hashlib.sha256(raw).hexdigest(),
        "model": "COP = p1·T_aria + p2·T_mandata + p3 + p4·T_aria; P_el = P_el_ref·(p1e·T_aria + p2e·T_mandata + p3e + p4e·T_aria); P_th = P_el·COP",
        "models": out,
    }
    dst = ROOT / "src" / "engine" / "data"
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "heatpumps.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    for e in out:
        cop = lambda ta, tf: e["cop"][0] * ta + e["cop"][1] * tf + e["cop"][2] + e["cop"][3] * ta
        pel = lambda ta, tf: e["pElRef_W"] * (e["pEl"][0] * ta + e["pEl"][1] * tf + e["pEl"][2] + e["pEl"][3] * ta)
        print(e["id"], e["model"], "| A7W35 COP %.2f Pth %.1f kW | A-7W55 COP %.2f Pth %.1f kW | TOL %s" % (cop(7, 35), pel(7, 35) * cop(7, 35) / 1000, cop(-7, 55), pel(-7, 55) * cop(-7, 55) / 1000, e["tol_C"]))


if __name__ == "__main__":
    main()
