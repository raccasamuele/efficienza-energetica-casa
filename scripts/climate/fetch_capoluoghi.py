"""Geolocalizza i capoluoghi (centro abitato, OpenStreetMap/Nominatim) e scarica un TMY PVGIS 5.3 per ciascuno.

Uso: .venv/Scripts/python scripts/climate/fetch_capoluoghi.py
- Legge data/derived/comuni.json (da scripts/data/build_comuni.py).
- Nominatim: al massimo 1 richiesta/s con User-Agent identificativo, risultati in cache (data/derived/capoluoghi.json).
- PVGIS: cache versionata in data/sources/climate/<chiave-richiesta>/<acquisizione>/ con query e hash.
Gli archivi storici in data/raw sono solo letti. --refresh conserva una nuova acquisizione.
"""

import argparse
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path
from cache import load_cached, request_for, save_response

ROOT = Path(__file__).resolve().parents[2]
UA = "confronto-interventi-energetici/0.2 (prototipo locale di ricerca)"


def get(url: str, timeout=120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "it"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def geocode(caps):
    cache_path = ROOT / "data" / "derived" / "capoluoghi.json"
    cache = json.loads(cache_path.read_text("utf-8")) if cache_path.exists() else {}
    selected = {}
    for c in caps:
        if c["code"] in cache:
            selected[c["code"]] = cache[c["code"]]
            continue
        previous = next((code for code in c.get("previousCodes", []) if code in cache), None)
        if previous:
            selected[c["code"]] = cache[previous]  # ID del clima stabile anche dopo la ricodifica ISTAT
            continue
        name = c["name"].split("/")[0]
        q = urllib.parse.urlencode({"city": name, "country": "Italia", "format": "jsonv2", "limit": 5, "addressdetails": 1})
        res = json.loads(get("https://nominatim.openstreetmap.org/search?" + q))
        time.sleep(1.1)
        # tra i risultati scegli il più vicino al centroide ISTAT del comune
        best = min(res, key=lambda r: haversine((float(r["lat"]), float(r["lon"])), (c["lat"], c["lon"])), default=None)
        if best is None:
            entry = {"lat": c["lat"], "lon": c["lon"], "fonte": "centroide ISTAT (Nominatim senza risultati)"}
        else:
            d = haversine((float(best["lat"]), float(best["lon"])), (c["lat"], c["lon"]))
            entry = {"lat": round(float(best["lat"]), 4), "lon": round(float(best["lon"]), 4), "fonte": "OpenStreetMap/Nominatim", "osm": f"{best['osm_type']}/{best['osm_id']}", "distDalCentroideKm": round(d, 1)}
            if d > 25:
                entry = {"lat": c["lat"], "lon": c["lon"], "fonte": f"centroide ISTAT (risultato OSM a {d:.0f} km scartato)"}
        entry.update(code=c["code"], name=c["name"], sigla=c["sigla"], altDPR=c["alt"], zone=c["zone"], gg=c["gg"])
        cache[c["code"]] = entry
        selected[c["code"]] = entry
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        print("geo", c["name"], entry["fonte"], entry.get("distDalCentroideKm"))
    return selected


def fetch_tmy(entry, refresh=False):
    if not refresh and load_cached(entry):
        return
    request = request_for(entry)
    url = request["endpoint"] + "?" + urllib.parse.urlencode(request["query"])
    for attempt in range(4):
        try:
            body = get(url, timeout=180)
            break
        except Exception as e:  # rete instabile: riprova con attesa crescente
            print("retry", entry["name"], e)
            time.sleep(5 * (attempt + 1))
    else:
        raise SystemExit(f"PVGIS non raggiungibile per {entry['name']}")
    data = json.loads(body)
    if len(data["outputs"]["tmy_hourly"]) != 8760:
        raise SystemExit(f"TMY incompleto per {entry['name']}")
    save_response(entry, body)
    print("tmy", entry["name"], data["inputs"]["location"]["elevation"], "m (DPR", entry["altDPR"], "m)")
    time.sleep(1.0)


def main():
    parser = argparse.ArgumentParser(description="Cache TMY versionata; --refresh conserva una nuova acquisizione senza sovrascrivere le precedenti")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    comuni = json.loads((ROOT / "data" / "derived" / "comuni.json").read_text("utf-8"))
    caps = [c for c in comuni if c["capoluogo"]]
    cache = geocode(caps)
    for c in caps:
        fetch_tmy(cache[c["code"]], refresh=args.refresh)
    print("ok", len(caps))


if __name__ == "__main__":
    main()
