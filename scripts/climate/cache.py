"""Cache TMY per richiesta completa; data/raw è un archivio storico in sola lettura."""
import gzip
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[2]
API = "https://re.jrc.ec.europa.eu/api/v5_3/tmy"


def request_for(entry):
    return {"endpoint": API, "query": {
        "lat": f"{entry['lat']:.4f}", "lon": f"{entry['lon']:.4f}", "outputformat": "json",
        "startyear": str(entry.get("startyear", 2005)), "endyear": str(entry.get("endyear", 2023)),
        "raddatabase": entry.get("raddatabase", "PVGIS-SARAH3"), "usehorizon": "1",
    }}


def request_key(request):
    return hashlib.sha256(json.dumps(request, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_cached(gz, sidecar, request, code):
    try:
        body = gzip.decompress(gz.read_bytes())
        meta = json.loads(sidecar.read_text("utf-8"))
        raw = json.loads(body)
        if meta["sha256"] != hashlib.sha256(body).hexdigest() or meta["bytes"] != len(body) or meta["climateId"] != code:
            return None
        url = urlsplit(meta["url"])
        if f"{url.scheme}://{url.netloc}{url.path}" != request["endpoint"] or dict(parse_qsl(url.query)) != meta["query"]:
            return None
        loc, weather = raw["inputs"]["location"], raw["inputs"]["meteo_data"]
        # I sidecar storici omettono i default: questi si ricavano solo dalla risposta conservata.
        recorded = {"startyear": str(weather["year_min"]), "endyear": str(weather["year_max"]),
                    "raddatabase": weather["radiation_db"], "usehorizon": "1" if weather["use_horizon"] else "0", **meta["query"]}
        echoed = {"startyear": str(weather["year_min"]), "endyear": str(weather["year_max"]), "raddatabase": weather["radiation_db"], "usehorizon": "1" if weather["use_horizon"] else "0"}
        if any(request["query"][k] != v for k, v in echoed.items()) or not all(math.isfinite(loc[k]) for k in ("latitude", "longitude")):
            return None
        if recorded != request["query"] or abs(loc["latitude"] - float(recorded["lat"])) > 0.00011 or abs(loc["longitude"] - float(recorded["lon"])) > 0.00011:
            return None
        if meta.get("requestKey", request_key(request)) != request_key(request) or len(raw["outputs"]["tmy_hourly"]) != 8760:
            return None
        return body, {**meta, "requestKey": request_key(request)}
    except (OSError, ValueError, KeyError, TypeError, EOFError):
        return None


def load_cached(entry, root=None):
    root = root or ROOT
    request = request_for(entry)
    directory = root / "data" / "sources" / "climate" / request_key(request)
    candidates = sorted(directory.glob("*/response.json.gz"), reverse=True) if directory.exists() else []
    for gz in candidates:
        result = read_cached(gz, gz.with_name("query.json"), request, entry["code"])
        if result:
            return result
    gz = root / "data" / "raw" / f"{entry['code']}_pvgis53_tmy.json.gz"
    return read_cached(gz, gz.with_name(f"{entry['code']}_pvgis53_tmy.query.json"), request, entry["code"])


def save_response(entry, body, root=None):
    root = root or ROOT
    request = request_for(entry)
    key = request_key(request)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    directory = root / "data" / "sources" / "climate" / key / stamp
    directory.mkdir(parents=True, exist_ok=False)
    meta = {"climateId": entry["code"], "name": entry["name"], "query": request["query"],
            "url": request["endpoint"] + "?" + urlencode(request["query"]), "requestKey": key,
            "acquiredAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(), "coordinateSource": entry.get("fonte", "manutentore"), "osm": entry.get("osm")}
    gz, sidecar = directory / "response.json.gz", directory / "query.json"
    gz.write_bytes(gzip.compress(body, compresslevel=9))
    sidecar.write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
    if not read_cached(gz, sidecar, request, entry["code"]):
        raise ValueError("Risposta PVGIS incoerente con la richiesta: copia conservata, cache non riutilizzabile")
    return meta
