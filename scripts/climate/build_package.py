"""Trasforma i TMY PVGIS grezzi nei pacchetti clima versionati usati dall'app.

Uso: .venv/Scripts/python scripts/climate/build_package.py            (tutti i capoluoghi scaricati)
     .venv/Scripts/python scripts/climate/build_package.py 015146     (uno solo)

Ipotesi dichiarate (riportate anche nel manifest di ogni pacchetto):
- indice sintetico non bisestile di 8760 ore, anno di calendario 2025, UTC;
- la riga i del TMY è un valore quasi istantaneo a t_i + irradiance_time_offset (≈ HH:10),
  applicato come costante all'intervallo orario [t_i, t_i + 1 h): sfasamento di circa 20 min dichiarato;
- la posizione solare è calcolata a t_i + irradiance_time_offset (dal file PVGIS);
- facciate verticali con la trasposizione di Perez (UNI EN ISO 52010-1, come EnergyPlus; motore 0.7.1,
  docs/validazione/CORREZIONE-MOTORE.md §8), piani FV con la trasposizione isotropa; albedo 0,20;
- FV: Faiman (parametri di default pvlib, vento a 10 m usato senza correzione),
  PVWatts DC con gamma -0,37 %/K, perdite DC 14 %, nessun IAM esplicito,
  inverter PVWatts con rendimento nominale 0,96 e rapporto DC/AC 1,10.
Formato compatto: interi con fattore di scala dichiarato in "scale" (T e vento in decimi, potenze in W).
"""

import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib
from cache import load_cached

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 3
ALBEDO = 0.20
GAMMA_PDC = -0.0037
DC_LOSSES = 0.14
ETA_INV_NOM = 0.96
DC_AC_RATIO = 1.10
FACADES = {"N": 0.0, "E": 90.0, "S": 180.0, "O": 270.0}
PV_PLANES = [(az_name, az, tilt) for az_name, az in (("E", 90.0), ("S", 180.0), ("O", 270.0)) for tilt in (20.0, 35.0)]
MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def temperature_correction(code: str, t_air: np.ndarray) -> dict:
    rawdir = ROOT / "data" / "raw" / "gradi-giorno"
    archives = sorted(rawdir.glob(f"{code}_*.json.gz"))
    if not archives:
        raise SystemExit(f"{code}: archivio osservato locale mancante")
    path = archives[-1]
    meta_path = path.with_suffix(".meta")
    if not meta_path.exists():
        raise SystemExit(f"{code}: metadati mancanti per {path.name}")
    meta = json.loads(meta_path.read_text("utf-8"))
    body = gzip.decompress(path.read_bytes())
    sha = hashlib.sha256(body).hexdigest()
    if meta.get("sha256") != sha:
        raise SystemExit(f"{code}: SHA-256 non coerente: {path}")
    data = json.loads(body)
    days = dict(zip(data["daily"]["time"], data["daily"]["temperature_2m_mean"]))
    observed = []
    for month in range(1, 13):
        vals = [days.get(f"{year}-{month:02d}-{day:02d}") for year in range(2015, 2025) for day in range(1, MONTH_DAYS[month-1]+1)]
        if len(vals) != 10 * MONTH_DAYS[month-1] or any(v is None or not math.isfinite(v) for v in vals):
            raise SystemExit(f"{code}: dati osservati mancanti per il mese {month}")
        observed.append(float(np.mean(vals)))
    month_index = np.array([i.month - 1 for i in pd.date_range("2025-01-01", periods=8760, freq="h", tz="UTC")])
    monthly_tmy = [float(np.mean(t_air[month_index == m])) for m in range(12)]
    offsets = np.array(observed) - np.array(monthly_tmy)
    starts = np.cumsum([0] + MONTH_DAYS[:-1]) * 24
    knots = np.array(starts, dtype=float) + np.array(MONTH_DAYS) * 12
    hours = np.arange(8760, dtype=float) + 0.5
    def basis(values):
        out = np.empty((len(values), 12))
        ext = np.r_[knots[-1] - 8760, knots, knots[0] + 8760]
        for j in range(12):
            unit = np.zeros(12); unit[j] = 1
            y = np.r_[unit[-1], unit, unit[0]]
            out[:, j] = np.interp(values, ext, y)
        return out
    B = basis(hours)
    A = np.vstack([B[month_index == m].mean(axis=0) for m in range(12)])
    coefficients = np.linalg.solve(A, offsets)
    return {"method": "scarto mensile verso la media osservata 2015-2024, lineare a tratti fra le met\u00e0 dei mesi, media mensile conservata", "reference": "Open-Meteo Historical Weather API, ERA5, temperatura media giornaliera a 2 m, 2015-01-01 ? 2024-12-31", "rawSha256": sha, "monthlyOffset_C": [round(float(x), 3) for x in offsets], "knots_C": [round(float(x), 4) for x in coefficients], "knotHours": knots.tolist()}


def poa(solpos, dni, ghi, dhi, dni_extra, tilt, azimuth, model="isotropic"):
    # Perez: coefficienti allsitescomposite1990, massa d'aria relativa di Kasten-Young (default pvlib)
    airmass = pvlib.atmosphere.get_relative_airmass(solpos["apparent_zenith"]) if model == "perez" else None
    out = pvlib.irradiance.get_total_irradiance(
        surface_tilt=tilt,
        surface_azimuth=azimuth,
        solar_zenith=solpos["apparent_zenith"],
        solar_azimuth=solpos["azimuth"],
        dni=dni,
        ghi=ghi,
        dhi=dhi,
        dni_extra=dni_extra,
        airmass=airmass,
        albedo=ALBEDO,
        model=model,
    )
    g = out["poa_global"]
    if model == "perez":
        # Perez divide per la diffusa: con diffusa nulla (alba, tramonto) il cielo non contribuisce, restano diretta e suolo
        no_diffuse = g.isna() & (dhi <= 0)
        g = g.where(~no_diffuse, out["poa_direct"].fillna(0.0) + out["poa_ground_diffuse"].fillna(0.0))
    nan_day = int((g.isna() & (solpos["apparent_zenith"] < 90.0)).sum())
    if nan_day:
        raise SystemExit(f"{nan_day} ore diurne con irraggiamento NaN (tilt {tilt}, azimut {azimuth})")
    return g.fillna(0.0).clip(lower=0.0)  # NaN solo con sole sotto l'orizzonte


def build(code: str, info: dict) -> dict:
    cached = load_cached({**info, "code": code}, ROOT)
    if cached is None:
        raise SystemExit(f"{code}: cache assente o incoerente con la richiesta completa; rieseguire fetch_tmy (le copie precedenti restano conservate)")
    raw_bytes, query = cached
    raw = json.loads(raw_bytes)
    loc = raw["inputs"]["location"]
    lat, lon, elev = loc["latitude"], loc["longitude"], loc["elevation"]
    offset_h = loc["irradiance_time_offset"]
    rows = raw["outputs"]["tmy_hourly"]
    if len(rows) != 8760:
        raise SystemExit(f"{code}: attese 8760 ore, trovate {len(rows)}")
    df = pd.DataFrame(rows)
    index = pd.date_range("2025-01-01 00:00", periods=8760, freq="h", tz="UTC")
    for i, t in enumerate(df["time(UTC)"]):
        mm, dd, hh = int(t[4:6]), int(t[6:8]), int(t[9:11])
        if (index[i].month, index[i].day, index[i].hour) != (mm, dd, hh):
            raise SystemExit(f"{code} riga {i}: {t} non allineata all'indice sintetico {index[i]}")

    t_air = df["T2m"].to_numpy(float)
    ghi = df["G(h)"].to_numpy(float)
    dni = df["Gb(n)"].to_numpy(float)
    dhi = df["Gd(h)"].to_numpy(float)
    wind = df["WS10m"].to_numpy(float)
    for arr, label in ((t_air, "T2m"), (ghi, "G(h)"), (dni, "Gb(n)"), (dhi, "Gd(h)"), (wind, "WS10m")):
        if not np.all(np.isfinite(arr)):
            raise SystemExit(f"{code}: valori non finiti in {label}")
    if ghi.min() < 0 or dni.min() < 0 or dhi.min() < 0:
        raise SystemExit(f"{code}: irraggiamento negativo nel TMY")
    # ERA5 contiene talvolta velocità del vento leggermente negative: portate a zero e dichiarate
    if wind.min() < -3:
        raise SystemExit(f"{code}: vento {wind.min()} m/s non plausibile")
    wind_neg = int((wind < 0).sum())
    wind = np.clip(wind, 0.0, None)

    solar_times = index + pd.Timedelta(hours=offset_h)
    solpos = pvlib.solarposition.get_solarposition(solar_times, lat, lon, altitude=elev, temperature=t_air)
    solpos.index = index
    dni_extra = pvlib.irradiance.get_extra_radiation(solar_times)
    dni_extra.index = index
    dni_s = pd.Series(dni, index=index).where(solpos["apparent_zenith"] < 90.0, 0.0)
    ghi_s = pd.Series(ghi, index=index)
    dhi_s = pd.Series(dhi, index=index)
    facades = {k: poa(solpos, dni_s, ghi_s, dhi_s, dni_extra, 90.0, az, "perez") for k, az in FACADES.items()}
    # IAM del doppio vetro: due lastre identiche, riflessioni multiple trascurate.
    glazing_facades = {}
    iam_slab = lambda aoi: pvlib.iam.physical(aoi)  # parametri pvlib predefiniti
    iam_sky = pvlib.iam.marion_integrate(lambda aoi: pvlib.iam.physical(aoi) ** 2, 90, "sky")
    iam_horizon = pvlib.iam.marion_integrate(lambda aoi: pvlib.iam.physical(aoi) ** 2, 90, "horizon")
    iam_ground = pvlib.iam.marion_integrate(lambda aoi: pvlib.iam.physical(aoi) ** 2, 90, "ground")
    for name, az in FACADES.items():
        components = pvlib.irradiance.perez(
            90.0, az, dhi_s, dni_s, dni_extra, solpos["apparent_zenith"],
            solpos["azimuth"], pvlib.atmosphere.get_relative_airmass(solpos["apparent_zenith"]),
            model="allsitescomposite1990", return_components=True,
        )
        aoi = pvlib.irradiance.aoi(90.0, az, solpos["apparent_zenith"], solpos["azimuth"])
        beam = dni_s * np.maximum(np.cos(np.radians(aoi)), 0.0)
        beam = beam.where(solpos["apparent_zenith"] < 90.0, 0.0)
        weighted = (beam + components["circumsolar"].fillna(0.0)) * iam_slab(aoi) ** 2
        weighted += components["isotropic"].fillna(0.0) * iam_sky
        weighted += components["horizon"].fillna(0.0) * iam_horizon
        weighted += pvlib.irradiance.get_ground_diffuse(90.0, ghi_s, ALBEDO) * iam_ground
        glazing_facades[name] = weighted.fillna(0.0).clip(lower=0.0)

    pdc0 = 1000.0
    pac0 = pdc0 / DC_AC_RATIO
    pv = {}
    for az_name, az, tilt in PV_PLANES:
        g = poa(solpos, dni_s, ghi_s, dhi_s, dni_extra, tilt, az)
        t_cell = pvlib.temperature.faiman(g, t_air, wind)
        p_dc = pvlib.pvsystem.pvwatts_dc(g, t_cell, pdc0, GAMMA_PDC) * (1.0 - DC_LOSSES)
        p_ac = pvlib.inverter.pvwatts(p_dc, pac0 / ETA_INV_NOM, eta_inv_nom=ETA_INV_NOM)
        if int(p_ac[solpos["apparent_zenith"] < 90.0].isna().sum()):
            raise SystemExit(f"{code}: potenza AC NaN in ore diurne ({az_name}{tilt})")
        pv[f"{az_name}{int(tilt)}"] = p_ac.fillna(0.0).clip(lower=0.0).to_numpy()

    def ints(a, k=1.0):
        return [int(round(float(x) * k)) for x in a]

    correction = temperature_correction(code, np.round(t_air * 10) / 10)
    # Percentile della serie corretta, arrotondato a 0,5 ?C.
    knot_hours = np.array(correction["knotHours"])
    knot_values = np.array(correction["knots_C"])
    correction_hours = np.arange(8760) + 0.5
    extended_x = np.r_[knot_hours[-1]-8760, knot_hours, knot_hours[0]+8760]
    extended_y = np.r_[knot_values[-1], knot_values, knot_values[0]]
    t_corrected = np.round(t_air * 10) / 10 + np.interp(correction_hours, extended_x, extended_y)
    design_est = float(np.round(np.percentile(t_corrected, 0.4) * 2) / 2)
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "climateId": code,
        "name": info["name"],
        "sigla": info["sigla"],
        "provider": "JRC PVGIS",
        "apiVersion": "5.3",
        "endpoint": "tmy",
        "radiationDatabase": raw["inputs"]["meteo_data"]["radiation_db"],
        "meteoDatabase": raw["inputs"]["meteo_data"]["meteo_db"],
        "sourceWindow": [raw["inputs"]["meteo_data"]["year_min"], raw["inputs"]["meteo_data"]["year_max"]],
        "useHorizon": raw["inputs"]["meteo_data"]["use_horizon"],
        "latitude": lat,
        "longitude": lon,
        "elevation_m": elev,
        "coordinateSource": query.get("coordinateSource", "manutentore"),
        "zone": info["zone"],
        "gg": info["gg"],
        "altitudeDPR_m": info["altDPR"],
        "designTempEstimate": design_est,
        "monthsSelected": raw["outputs"]["months_selected"],
        "acquiredAt": query["acquiredAt"],
        "query": query["url"],
        "requestKey": query["requestKey"],
        "rawSha256": query["sha256"],
        "irradianceTimeOffset_h": offset_h,
        "timeIndex": "8760 ore, anno sintetico 2025 non bisestile, UTC; il valore della riga i (istante i h + offset di irraggiamento) è applicato all'intervallo [i h, i+1 h)",
        "scale": {"tAir": 10, "wind": 10, "ghi": 1, "facade": 1, "facadeGlazing": 1, "pvAc": 1},
        "units": {"tAir": "°C", "wind": "m/s", "ghi": "W/m²", "facade": "W/m²", "facadeGlazing": "W/m²", "pvAc": "W per kWp DC"},
        "transformations": [
            "posizione solare pvlib a t + irradiance_time_offset",
            f"facciate: trasposizione di Perez (allsitescomposite1990, massa d'aria Kasten-Young); piani FV: trasposizione isotropa; albedo {ALBEDO}",
            f"facadeGlazing: componenti Perez pesate con IAM fisico pvlib al quadrato; integrali emisferici sky {iam_sky:.3f}, horizon {iam_horizon:.3f}, ground {iam_ground:.3f}",
            "facciate verticali N/E/S/O (azimut pvlib N=0, E=90, S=180, O=270)",
            f"FV: Faiman default, PVWatts DC gamma {GAMMA_PDC}/K, perdite DC {DC_LOSSES:.0%}, nessun IAM esplicito",
            f"inverter PVWatts eta_nom {ETA_INV_NOM}, DC/AC {DC_AC_RATIO}",
            "temperatura di progetto stimata = percentile 0,4% delle temperature orarie corrette del TMY, scelta esplorativa arrotondata a 0,5 °C: non è un dato di progetto normativo né una statistica pluriennale degli estremi",
            *([f"vento: {wind_neg} ore con valori negativi del TMY (≥ −3 m/s) portate a 0"] if wind_neg else []),
        ],
        "software": {"pvlib": pvlib.__version__, "pandas": pd.__version__, "numpy": np.__version__},
        "attribution": "Dati meteo e di irraggiamento: PVGIS © Unione Europea, JRC (TMY, PVGIS 5.3). Elaborazione con pvlib (BSD-3-Clause). Coordinate del centro: © OpenStreetMap contributors (ODbL). Zona, gradi giorno e altitudine: DPR 412/1993 Allegato A; codici e confini: ISTAT (CC BY 4.0).",
        "note": "Modello pvlib alimentato da TMY PVGIS, non produzione calcolata dal servizio FV di PVGIS. Il TMY rappresenta condizioni tipiche, non un anno futuro né gli estremi di progetto.",
    }
    out_dir = ROOT / "public" / "data" / "packages"
    out_path = out_dir / f"{code}.json"
    correction["method"] = "scarto mensile verso la media osservata 2015-2024, lineare a tratti fra le met" + chr(0x00e0) + " dei mesi, media mensile conservata"
    correction["reference"] = "Open-Meteo Historical Weather API, ERA5, temperatura media giornaliera a 2 m, 2015-01-01 " + chr(0x2192) + " 2024-12-31"
    if out_path.exists():
        previous_manifest = json.loads(out_path.read_text("utf-8"))["manifest"]
        transformations = list(previous_manifest["transformations"])
        design_line = next((i for i, row in enumerate(transformations) if "temperatura di progetto stimata" in row), None)
        if design_line is not None:
            transformations[design_line] = transformations[design_line].replace("temperature orarie del TMY", "temperature orarie corrette del TMY")
        transformations.insert(0, "temperatura esterna riportata mese per mese alla media osservata Open-Meteo ERA5 2015-2024; interpolazione ciclica fra le met" + chr(0x00e0) + " dei mesi, medie mensili conservate")
        manifest = dict(previous_manifest)
        manifest["designTempEstimate"] = design_est
        manifest["temperatureCorrection"] = correction
        manifest["transformations"] = transformations
    else:
        manifest["temperatureCorrection"] = correction
        manifest["transformations"].insert(0, "temperatura esterna riportata mese per mese alla media osservata Open-Meteo ERA5 2015-2024; interpolazione ciclica fra le met" + chr(0x00e0) + " dei mesi, medie mensili conservate")
    package = {
        "manifest": manifest,
        "series": {
            "tAir": ints(t_air, 10),
            "wind": ints(wind, 10),
            "ghi": ints(ghi),
            "facade": {k: ints(v) for k, v in facades.items()},
            "facadeGlazing": {k: ints(v) for k, v in glazing_facades.items()},
            "pvAc": {k: ints(v) for k, v in pv.items()},
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(package, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {
        "id": code,
        "name": info["name"],
        "sigla": info["sigla"],
        "lat": lat,
        "lon": lon,
        "elevation": elev,
        "altDPR": info["altDPR"],
        "zone": info["zone"],
        "gg": info["gg"],
        "tMean": round(float(t_corrected.mean()), 1),
        "tMin": round(float(t_corrected.min()), 1),
        "tDesign": design_est,
        "pvS35": math.floor(sum(package["series"]["pvAc"]["S35"]) / 1000 + 0.5),
    }


def main():
    caps = json.loads((ROOT / "data" / "derived" / "capoluoghi.json").read_text("utf-8"))
    # zona, gradi giorno e altitudine sempre dall'anagrafe corrente (non dalla cache delle coordinate)
    comuni = {code: c for c in json.loads((ROOT / "data" / "derived" / "comuni.json").read_text("utf-8")) for code in [c["code"], *c.get("previousCodes", [])]}
    for code, e in caps.items():
        c = comuni[code]
        e.update(zone=c["zone"], gg=c["gg"], altDPR=c["alt"], name=c["name"], sigla=c["sigla"])
    # Una cache incoerente deve interrompere anche la ricostruzione completa, non lasciare il vecchio indice.
    codes = sys.argv[1:] or list(caps)
    index_path = ROOT / "public" / "data" / "packages" / "index.json"
    index = {e["id"]: e for e in json.loads(index_path.read_text("utf-8"))["climates"]} if index_path.exists() else {}
    for code in codes:
        built = build(code, caps[code])
        if code in index:
            for field in ("tMean", "tMin", "tDesign"):
                index[code][field] = built[field]
        else:
            index[code] = built
        print("ok", code, caps[code]["name"])
    payload = {"schemaVersion": SCHEMA_VERSION, "climates": sorted(index.values(), key=lambda e: e["name"])}
    index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=0), encoding="utf-8")
    print("indice:", len(index))


if __name__ == "__main__":
    main()
