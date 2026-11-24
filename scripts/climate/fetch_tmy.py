"""Scarica un TMY nella cache versionata, senza scrivere in data/raw.

Uso: .venv/Scripts/python scripts/climate/fetch_tmy.py <climateId> <lat> <lon> [--refresh]
"""
import argparse
from fetch_capoluoghi import fetch_tmy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("climateId")
    parser.add_argument("lat", type=float)
    parser.add_argument("lon", type=float)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    fetch_tmy({"code": args.climateId, "name": args.climateId, "lat": args.lat, "lon": args.lon, "altDPR": "n.d.", "fonte": "manutentore"}, args.refresh)


if __name__ == "__main__":
    main()
