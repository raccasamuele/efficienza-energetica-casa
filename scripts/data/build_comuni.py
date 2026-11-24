"""Costruisce l'anagrafe dei comuni per l'app unendo tre fonti pubbliche.

Fonti (in data/sources/, scaricate dal manutentore):
- ISTAT, Elenco comuni italiani al 21/02/2026 (XLSX): codici, nomi, sigla, regione, flag capoluogo; CSV 2025 per le migrazioni.
- ISTAT, Confini amministrativi generalizzati 01/01/2025 (zip con shapefile UTM 32N): centroidi.
- DPR 412/1993 Allegato A (PDF, testo coordinato): zona climatica, gradi giorno, altitudine della casa comunale.
- data/sources/dpr412_errata.json: correzioni manuali documentate (righe non estratte, refusi del PDF).

Provenienza per comune («fonte»):
- "DPR412": riga del DPR abbinata per nome (esatto, j/i, o tramite alias documentato);
- "DPR412-approssimato": abbinamento per somiglianza del nome (stessa provincia o regione);
- "DPR412-conflitto": riga originale con zona/GG discordanti, conservata e da verificare;
- "vicino": comune non trovato nel DPR (fusione successiva o riga illeggibile): dati del comune abbinato più vicino.

Uso: .venv/Scripts/python scripts/data/build_comuni.py
Output: data/derived/comuni.json (completo), public/data/comuni.json (compatto), registri in data/derived/.
"""

import csv
import difflib
import hashlib
import io
import json
import math
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import shapefile
from pypdf import PdfReader
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "sources"
DERIVED = ROOT / "data" / "derived"

# sigle del 1993 non più esistenti → regione (per gli abbinamenti fra province della stessa regione)
OLD_SIGLA_REGION = {"PS": "Marche", "FO": "Emilia-Romagna"}
# passaggi di comune fra regioni dopo il 1993 (sigla attuale, sigla nel DPR)
CROSS_REGION = {("UD", "BL")}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.split("/")[0]
    s = s.replace("j", "i")
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def read_istat():
    text = (SRC / "Elenco-comuni-italiani.csv").read_bytes().decode("cp1252")
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))[1:]
    out = []
    for r in rows:
        if len(r) < 20 or not r[4].strip():
            continue
        out.append({"code": r[4].strip(), "name": r[6].strip(), "region": r[10].strip(), "sigla": r[14].strip(), "capoluogo": r[13].strip() == "1"})
    current = SRC / "istat-2026-02-21.xlsx"
    if not current.exists():
        raise SystemExit("Scaricare l'anagrafe corrente con scripts/data/fetch_audit_sources.mjs")
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(current) as z:
        strings = ["".join(t.itertext()) for t in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("s:si", ns)]
        records = []
        for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(".//s:row", ns)[1:]:
            record = {}
            for cell in row.findall("s:c", ns):
                value = cell.find("s:v", ns)
                value = value.text if value is not None else ""
                record[re.sub(r"\d", "", cell.attrib["r"])] = strings[int(value)] if cell.get("t") == "s" else value
            records.append(record)
    # Le due fusioni sono documentate da ISTAT, Novità 2026, p. 1. La colonna Q dà i vecchi codici sardi.
    old_by_name = {c["name"]: c["code"] for c in out}
    mergers = {"Castegnero Nanto": ["Castegnero", "Nanto"], "Montalto Pavese": ["Montalto Pavese", "Lirio"]}
    result = []
    for r in records:
        code = r["E"].zfill(6)
        previous = [old_by_name[n] for n in mergers[r["G"]]] if r["G"] in mergers else [r["Q"].zfill(6)]
        result.append({"code": code, "name": r["G"], "region": r["K"], "sigla": r["O"], "capoluogo": r["N"] == "1",
                       "previousCodes": [p for p in previous if p != code], "boundaryCodes": previous,
                       "registryDate": "2026-02-21", "boundaryChanged": r["G"] in mergers})
    if len(result) != 7894 or len({c["code"] for c in result}) != len(result):
        raise SystemExit("Elenco ISTAT corrente inatteso: verificare versione e migrazione")
    return result


def read_centroids(istat):
    shp = SRC / "limiti" / "Com01012025_g" / "Com01012025_g_WGS84.shp"
    if not shp.exists():
        with zipfile.ZipFile(SRC / "Limiti01012025_g.zip") as z:
            z.extractall(SRC / "limiti")
    sf = shapefile.Reader(str(shp), encoding="latin1")
    # nonostante il nome «_WGS84», il .prj è WGS 1984 UTM 32N
    tr = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)
    idx = [f[0] for f in sf.fields[1:]].index("PRO_COM_T")
    out, weights = {}, {}
    for sr in sf.iterShapeRecords():
        pts = sr.shape.points
        parts = list(sr.shape.parts) + [len(pts)]
        best = None  # centroide della parte più grande (le isole minori non spostano il punto)
        for a, b in zip(parts[:-1], parts[1:]):
            ring = pts[a:b]
            A = cx = cy = 0.0
            for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
                c = x0 * y1 - x1 * y0
                A += c
                cx += (x0 + x1) * c
                cy += (y0 + y1) * c
            if A == 0:
                continue
            A *= 0.5
            cand = (abs(A), cx / (6 * A), cy / (6 * A))
            if best is None or cand[0] > best[0]:
                best = cand
        lon, lat = tr.transform(best[1], best[2])
        out[sr.record[idx]] = (round(lat, 5), round(lon, 5))
        weights[sr.record[idx]] = best[0]
    current = {}
    for c in istat:
        codes = c["boundaryCodes"]
        total = sum(weights[code] for code in codes)
        current[c["code"]] = tuple(round(sum(out[code][i] * weights[code] for code in codes) / total, 5) for i in (0, 1))
        c["coordinateSource"] = "Centroide da confini ISTAT 01/01/2025" + (", aggregato per fusione 2026 (ponderato per area)" if len(codes) > 1 else "")
    return current


ZONE_GG = [("A", 0, 600), ("B", 601, 900), ("C", 901, 1400), ("D", 1401, 2100), ("E", 2101, 3000), ("F", 3001, 99999)]


def zone_of(gg):
    return next(z for z, lo, hi in ZONE_GG if lo <= gg <= hi)


def zone_consistent(zone, gg):
    return any(z == zone and lo <= gg <= hi for z, lo, hi in ZONE_GG)


FULL = re.compile(r"^([A-Z]{2}) ([A-F]) (\d{3,4}) (\d{1,4}) (.+?)\s*(?:\((\d+)\))?\s*$")
NOZONE = re.compile(r"^([A-Z]{2}) (\d{3,4}) (\d{1,4}) (.+?)\s*(?:\((\d+)\))?\s*$")
HEAD_ONLY = re.compile(r"^([A-Z]{2}) ([A-F]) (\d{3,4})\s*$")
TAIL_ONLY = re.compile(r"^(\d{1,4}) ([A-Za-zÀ-ÿ'].*?)\s*(?:\((\d+)\))?\s*$")
ROWLIKE = re.compile(r"^[A-Za-z]{2} ([A-F]|\d)")


def fix_ocr(line: str) -> str:
    # sigla con «l» minuscola al posto di «I» (es. «Bl» → «BI»)
    line = re.sub(r"^([A-Z])l ", r"\1I ", line)
    # cifre: lettera O o simbolo ° al posto dello zero
    head = re.sub(r"(?<=\d)[O°]|[O°](?=\d)", "0", line[:22])
    return head + line[22:]


def read_dpr():
    reader = PdfReader(str(SRC / "dpr412-93_allA_tabellagradigiorno-riscaldamento.pdf"))
    rows, rejected = [], []
    footnotes = {}
    for page_number, page in enumerate(reader.pages, 1):
        start = len(rows)
        pending = []  # righe spezzate: «SO F 3971» ... più sotto «1339 Valfurva»
        for raw in page.extract_text().splitlines():
            line = raw.strip()
            fm = re.match(r"^\((\d+)\)\s+(.*)$", line)
            if fm:
                footnotes[fm.group(1)] = fm.group(2)
                continue
            fixed = fix_ocr(line)
            m = FULL.match(fixed)
            if m:
                rows.append({"sigla": m[1], "zone": m[2], "gg": int(m[3]), "alt": int(m[4]), "name": m[5], "nota": m[6]})
                continue
            m = HEAD_ONLY.match(fixed)
            if m:
                pending.append(m)
                continue
            m = NOZONE.match(fixed)
            if m and not FULL.match(fixed):
                gg = int(m[2])
                rows.append({"sigla": m[1], "zone": zone_of(gg), "gg": gg, "alt": int(m[3]), "name": m[4], "nota": m[5], "derivata": "zona ricavata dai gradi giorno (lettera assente nel PDF)"})
                continue
            if pending:
                t = TAIL_ONLY.match(fixed)
                if t:
                    h = pending.pop(0)
                    rows.append({"sigla": h[1], "zone": h[2], "gg": int(h[3]), "alt": int(t[1]), "name": t[2], "nota": t[3], "derivata": "riga ricomposta (spezzata nel PDF)"})
                    continue
            if ROWLIKE.match(line):
                rejected.append(line)
        for h in pending:
            rejected.append(h.group(0) + "  [riga spezzata senza seguito]")
        for r in rows[start:]:
            r["reference"] = f"DPR 412/1993 Allegato A, copia locale, pagina PDF {page_number}, riga {r['sigla']} {r['zone']} {r['gg']} {r['alt']} {r['name']}"
    # righe aggiunte solo per una porzione di territorio: non rappresentano il comune
    partial = {n for n, t in footnotes.items() if "porzione" in t.lower()}
    for r in rows:
        if r.get("nota") in partial:
            r["parziale"] = footnotes[r["nota"]][:160]
    return rows, rejected


def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def assign_dpr(c, d, fonte):
    # Anche una riga discordante conserva valori e quota originali: il vicino non la sostituisce.
    conflict = None if zone_consistent(d["zone"], d["gg"]) else f"Zona {d['zone']} discordante dai {d['gg']} GG secondo le soglie dell'art. 2; da verificare con atto correttivo"
    if conflict and fonte == "DPR412":
        fonte = "DPR412-conflitto"
    if c.get("boundaryChanged") and fonte == "DPR412":
        fonte = "DPR412-approssimato"
    c.update(zone=d["zone"], gg=d["gg"], alt=d["alt"], fonte=fonte,
             donor={"name": d["name"], "sigla": d["sigla"], "zone": d["zone"], "gg": d["gg"], "alt": d["alt"]},
             reference=d.get("reference", "data/sources/dpr412_errata.json: " + d.get("errata", "")),
             conflict=conflict, verification="da verificare" if conflict or fonte != "DPR412" else "abbinamento esatto; atti successivi non censiti integralmente")
    notes = [d.get("derivata"), d.get("errata"), "Confini modificati nel 2026: classificazione delle singole località da verificare" if c.get("boundaryChanged") else None]
    if conflict:
        verifications = json.loads((SRC / "dpr412_verifiche.json").read_text("utf-8"))
        check = next((r for r in verifications["rows"] if r["name"] == d["name"]), None)
        if check:
            notes.append(check["note"] + " Fonte della verifica: " + check["url"])
    c["nota"] = "; ".join(n for n in notes if n)


def main():
    istat = read_istat()
    cent = read_centroids(istat)
    dpr, rejected = read_dpr()
    errata = json.loads((SRC / "dpr412_errata.json").read_text("utf-8"))
    aliases = {k: v for k, v in errata["aliases"].items() if not k.startswith("_")}
    for e in errata["rows"]:
        dpr.append({"sigla": e["sigla"], "zone": e["zone"], "gg": e["gg"], "alt": e["alt"], "name": e["name"], "errata": e["motivo"]})

    sigla_region = {c["sigla"]: c["region"] for c in istat}
    sigla_region.update(OLD_SIGLA_REGION)
    inconsistent = []
    usable = []
    for d in dpr:
        if d.get("parziale"):
            continue
        if not zone_consistent(d["zone"], d["gg"]):
            inconsistent.append(f"{d['sigla']} {d['zone']} {d['gg']} {d['alt']} {d['name']}")
        alias = aliases.get(f"{d['sigla']}|{norm(d['name'])}")
        d["key"] = norm(alias) if alias else norm(d["name"])
        if alias:
            d["derivata"] = f"nome corretto da «{d['name']}» (refuso del PDF)"
        usable.append(d)
    # le errata sostituiscono le righe estratte con lo stesso nome
    errata_keys = {(d["sigla"], d["key"]) for d in usable if d.get("errata")}
    usable = [d for d in usable if d.get("errata") or (d["sigla"], d["key"]) not in errata_keys]

    by_key, by_name, by_region = {}, {}, {}
    for d in usable:
        by_key.setdefault((d["sigla"], d["key"]), d)
        by_name.setdefault(d["key"], []).append(d)
        by_region.setdefault(sigla_region.get(d["sigla"], "?"), []).append(d)

    def compatible(c, d):
        return sigla_region.get(d["sigla"]) == c["region"] or (c["sigla"], d["sigla"]) in CROSS_REGION

    used = set()
    out, unmatched, fuzzy = [], [], []
    # passo 1: abbinamenti esatti (stessa sigla, poi stessa regione o passaggio noto)
    for c in istat:
        if c["code"] not in cent:
            raise SystemExit(f"centroide mancante per {c['code']} {c['name']}")
        c["lat"], c["lon"] = cent[c["code"]]
        k = norm(c["name"])
        d = by_key.get((c["sigla"], k))
        if d is None:
            cands = [x for x in by_name.get(k, []) if compatible(c, x)]
            d = cands[0] if len(cands) == 1 else None
        if d is not None:
            used.add(id(d))
            assign_dpr(c, d, "DPR412")
        out.append(c)
    # passo 2: somiglianza del nome nella stessa regione, tra le righe non ancora usate
    for c in out:
        if "fonte" in c:
            continue
        k = norm(c["name"])
        score = lambda x: difflib.SequenceMatcher(None, k, x["key"]).ratio()
        region = [x for x in by_region.get(c["region"], []) + [y for s, t in CROSS_REGION if s == c["sigla"] for y in by_region.get(sigla_region.get(t, ""), [])] if id(x) not in used]
        prov = [x for x in region if x["sigla"] == c["sigla"]]
        best = max(prov, key=score, default=None)
        if best is None or score(best) < 0.85:
            # nome del DPR contenuto all'inizio del nome attuale (es. «Venaria» → «Venaria Reale»), se il candidato è unico
            pref = [x for x in prov if len(x["key"]) >= 6 and k.startswith(x["key"])]
            best = pref[0] if len(pref) == 1 else None
            if best is None:
                cand = max(region, key=score, default=None)
                best = cand if cand is not None and score(cand) >= 0.9 else None
        if best is not None:
            used.add(id(best))
            assign_dpr(c, best, "DPR412-approssimato")
            fuzzy.append(f"{c['name']} ({c['sigla']}) <- {best['name']} ({best['sigla']})")
        else:
            unmatched.append(c)

    matched = [c for c in out if c.get("fonte") == "DPR412"]
    for c in unmatched:
        near = min(matched, key=lambda m: haversine((c["lat"], c["lon"]), (m["lat"], m["lon"])))
        assign_dpr(c, {**near, "reference": near["reference"]}, "vicino")
        c["nota"] = f"Ipotesi dal vicino {near['name']} ({near['sigla']}), quota del donatore: sito sconosciuto; stesso versante e rettifica altimetrica non verificati. Non è un provvedimento del Sindaco."

    DERIVED.mkdir(parents=True, exist_ok=True)
    (DERIVED / "comuni.json").write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    (DERIVED / "dpr412_rifiutate.txt").write_text("\n".join(rejected + ["", "# righe con zona e gradi giorno incoerenti (CONSERVATE, da verificare):"] + inconsistent), encoding="utf-8")
    (DERIVED / "dpr412_conflitti.json").write_text(json.dumps([c for c in out if c.get("conflict")], ensure_ascii=False, indent=1), encoding="utf-8")
    (DERIVED / "abbinamenti_approssimati.txt").write_text("\n".join(f"{c['name']} ({c['sigla']}) <- {c['donor']['name']} ({c['donor']['sigla']}): {c['nota']}" for c in out if c["fonte"] == "DPR412-approssimato"), encoding="utf-8")
    (DERIVED / "comuni_non_trovati.txt").write_text("\n".join(f"{c['name']} ({c['sigla']}): {c['nota']}" for c in unmatched), encoding="utf-8")
    compact = {
        "schemaVersion": 1,
        "fields": ["code", "name", "sigla", "region", "lat", "lon", "zone", "gg", "alt", "fonte", "capoluogo", "provenance"],
        "registryDate": "2026-02-21",
        "sources": [
            "ISTAT, Elenco dei comuni italiani al 21/02/2026; centroidi dai Confini generalizzati 01/01/2025, aggregati per le fusioni (CC BY 4.0)",
            "DPR 412/1993, Allegato A (testo coordinato con DM 6/8/1994, 16/5/1995, 6/10/1997): zona climatica, gradi giorno, altitudine della casa comunale",
        ],
        "sourceSha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [SRC / "istat-2026-02-21.xlsx", SRC / "dpr412-93_allA_tabellagradigiorno-riscaldamento.pdf"]},
        "rows": [[c["code"], c["name"], c["sigla"], c["region"], c["lat"], c["lon"], c["zone"], c["gg"], c["alt"], c["fonte"], 1 if c["capoluogo"] else 0,
                  {k: c[k] for k in ("donor", "reference", "conflict", "verification", "nota", "previousCodes", "registryDate", "coordinateSource")}] for c in out],
    }
    (ROOT / "public" / "data" / "comuni.json").write_text(json.dumps(compact, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        json.dumps(
            {
                "comuni": len(out),
                "dpr_righe": len(dpr),
                "dpr_parziali_escluse": sum(1 for d in dpr if d.get("parziale")),
                "dpr_incoerenti": len(inconsistent),
                "righe_rifiutate": len(rejected),
                "abbinati_esatti": sum(1 for c in out if c.get("fonte") == "DPR412"),
                "abbinati_approssimati": sum(1 for c in out if c.get("fonte") == "DPR412-approssimato"),
                "conflitti_conservati": sum(1 for c in out if c.get("conflict")),
                "dati_del_vicino": len(unmatched),
                "capoluoghi": sum(1 for c in out if c["capoluogo"]),
                "capoluoghi_non_esatti": [c["name"] for c in out if c["capoluogo"] and c.get("fonte") != "DPR412"],
            },
            indent=1,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
