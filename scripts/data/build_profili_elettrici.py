"""Costruisce i profili elettrici medi delle case italiane per mese, tipo di giorno e ora.

Fonte (in data/sources/arera-profili/, scaricata dal manutentore; il file grande non è nel repository):
- ARERA, «Analisi dei consumi dei clienti domestici», dati regionali 2025 (Dati_regione_2025.zip):
  prelievo medio orario in kWh dei clienti domestici trattati orari, per mese, regione, mercato, classe di potenza,
  residenza, tipo di giorno (feriale, sabato, domenica) e ora (Ora1 = dalle 0 alle 1).
  https://www.arera.it/dati-e-statistiche/dettaglio/analisi-dei-consumi-dei-clienti-domestici
  Licenza: CC BY-SA 4.0 (termini d'uso del sito ARERA, letti il 17/11/2026).

Che cosa tiene: clienti residenti, tutti i mercati, classi di potenza 1,5-3 kW e 3-4,5 kW, i 12 mesi (non la riga
dell'anno intero). Le 20 regioni si riuniscono in tre aree (Nord, Centro, Sud e isole, ripartizione ISTAT) con la
media semplice delle regioni: la fonte non dà il numero dei clienti per pesarle (ipotesi dichiarata).
Ogni tabella è divisa per la sua media, così vale 1 in media: l'energia dell'anno la fissa il motore.

Uso: .venv/Scripts/python scripts/data/build_profili_elettrici.py
Output: src/engine/data/profili-arera.json; manifest data/sources/arera-profili/arera-profili-source.json (hash).
"""
import hashlib
import io
import json
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "data" / "sources" / "arera-profili"
ARCHIVE = SOURCE_DIR / "Dati_regione_2025.zip"
MANIFEST = SOURCE_DIR / "arera-profili-source.json"
COMUNI = ROOT / "public" / "data" / "comuni.json"
OUTPUT = ROOT / "src" / "engine" / "data" / "profili-arera.json"
URL = "https://www.arera.it/fileadmin/allegati/dati/monitoraggioretail/Dati_regione_2025.zip"
PAGE = "https://www.arera.it/dati-e-statistiche/dettaglio/analisi-dei-consumi-dei-clienti-domestici"
YEAR = 2025
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

CLASSES = {
    "fino3": ("1.5<potenza_impegnata<=3", "dati prelievo orario per regionale1_5_a_3 anno 2025.xlsx"),
    "fino4_5": ("3<potenza_impegnata<=4.5", "dati prelievo orario per regionale3_a_4_5 anno 2025.xlsx"),
}
AREAS = {
    "nord": ["Piemonte", "Valle d'Aosta", "Liguria", "Lombardia", "Trentino-Alto Adige", "Veneto", "Friuli-Venezia Giulia", "Emilia-Romagna"],
    "centro": ["Toscana", "Umbria", "Marche", "Lazio"],
    "sud": ["Abruzzo", "Molise", "Campania", "Puglia", "Basilicata", "Calabria", "Sicilia", "Sardegna"],
}
DAY_TYPES = {"Giorno feriale": 0, "Sabato": 1, "Domenica": 2}
HEADER = ["Anno Mese", "Regione", "Tipo mercato", "Classe potenza", "Residenza", "Working Day", "Orario"]


def month_of(serial: str) -> int | None:
    """La colonna «Anno Mese» è il primo giorno del mese come numero di Excel; «2025» è la riga dell'anno intero."""
    n = int(serial)
    if n == YEAR:
        return None
    d = date(1899, 12, 30) + timedelta(days=n)
    if d.year != YEAR or d.day != 1:
        raise ValueError(f"Mese inatteso: {serial} -> {d}")
    return d.month


def rows(sheet: bytes):
    z = zipfile.ZipFile(io.BytesIO(sheet))
    shared = ["".join(t.text or "" for t in si.iter(M + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si")]
    with z.open("xl/worksheets/sheet1.xml") as f:
        for _, el in ET.iterparse(f):
            if el.tag != M + "row":
                continue
            out = []
            for c in el.findall(M + "c"):
                v = c.find(M + "v")
                out.append(None if v is None else shared[int(v.text)] if c.get("t") == "s" else v.text)
            el.clear()
            yield out


def regional_tables(sheet: bytes, power: str) -> dict[str, list[list[list[float]]]]:
    tables: dict[str, list[list[list[float | None]]]] = {}
    first = True
    for r in rows(sheet):
        if first:
            first = False
            if [str(x).strip() for x in r[:7]] != HEADER:
                raise ValueError(f"Intestazione inattesa: {r}")
            continue
        serial, region, market, klass, residence, day, hour, value = r
        if klass != power:
            raise ValueError(f"Classe di potenza inattesa: {klass}")
        month = month_of(serial)
        if month is None or market != "Tutti" or residence != "Residente":
            continue
        t = tables.setdefault(region, [[[None] * 24 for _ in range(3)] for _ in range(12)])
        h = int(hour.removeprefix("Ora")) - 1
        if t[month - 1][DAY_TYPES[day]][h] is not None:
            raise ValueError(f"Riga doppia: {r}")
        t[month - 1][DAY_TYPES[day]][h] = float(value)
    for region, t in tables.items():
        if any(v is None or not v > 0 for m in t for d in m for v in d):
            raise ValueError(f"Tabella incompleta o non positiva: {region}")
    return tables  # type: ignore[return-value]


def normalized(t: list[list[list[float]]]) -> list[list[list[float]]]:
    mean = sum(v for m in t for d in m for v in d) / 864
    return [[[v / mean for v in d] for d in m] for m in t]


def main() -> None:
    raw = ARCHIVE.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    archive = zipfile.ZipFile(io.BytesIO(raw))
    names = {Path(n).name: n for n in archive.namelist()}
    profiles: dict[str, dict[str, list[list[list[float]]]]] = {}
    for key, (power, filename) in CLASSES.items():
        regional = regional_tables(archive.read(names[filename]), power)
        missing = [r for regions in AREAS.values() for r in regions if r not in regional]
        if missing or len(regional) != 20:
            raise ValueError(f"Regioni mancanti o in più: {missing}, {sorted(regional)}")
        profiles[key] = {}
        for area, regions in AREAS.items():
            shapes = [normalized(regional[r]) for r in regions]
            mean = [[[sum(s[m][d][h] for s in shapes) / len(shapes) for h in range(24)] for d in range(3)] for m in range(12)]
            profiles[key][area] = [[[round(v, 4) for v in d] for d in m] for m in normalized(mean)]

    comuni = json.loads(COMUNI.read_text(encoding="utf-8"))
    fields = comuni["fields"]
    records = comuni.get("rows") or comuni.get("comuni") or comuni.get("data")
    region_area = {r: a for a, regions in AREAS.items() for r in regions}
    alias = {"Valle d'Aosta/Vallée d'Aoste": "Valle d'Aosta", "Trentino-Alto Adige/Südtirol": "Trentino-Alto Adige"}
    area_by_sigla: dict[str, str] = {}
    for row in records:
        sigla, region = row[fields.index("sigla")], row[fields.index("region")]
        area = region_area[alias.get(region, region)]
        if area_by_sigla.setdefault(sigla, area) != area:
            raise ValueError(f"Provincia in due aree: {sigla}")

    acquired = json.loads(MANIFEST.read_text(encoding="utf-8"))["acquiredAt"] if MANIFEST.exists() else date.today().isoformat()
    MANIFEST.write_text(json.dumps({
        "page": PAGE, "url": URL, "path": ARCHIVE.name, "acquiredAt": acquired, "sha256": sha, "bytes": len(raw),
        "licence": "CC BY-SA 4.0 (https://www.arera.it/termini-e-condizioni-uso-del-sito)",
        "filters": {"anno": YEAR, "mercato": "Tutti", "residenza": "Residente", "classi": [c[0] for c in CLASSES.values()]},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Fine riga LF come nel repository (.gitattributes), anche su Windows.
    OUTPUT.write_bytes((json.dumps({
        "source": "ARERA, Analisi dei consumi dei clienti domestici, dati regionali 2025 (clienti residenti, tutti i mercati)",
        "url": PAGE, "licence": "CC BY-SA 4.0", "year": YEAR, "acquiredAt": acquired, "sha256": sha,
        "note": "Valori relativi (media 1) per [mese 0-11][giorno: 0 feriale, 1 sabato, 2 domenica][ora locale 0-23]; aree = media semplice delle regioni.",
        "areaBySigla": dict(sorted(area_by_sigla.items())),
        "profiles": profiles,
    }, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    print(f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size} byte, {len(area_by_sigla)} province, sha256 {sha[:12]}")


if __name__ == "__main__":
    main()
