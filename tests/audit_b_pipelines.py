"""Regressioni offline delle pipeline del Blocco B; nessuna scrittura nei grezzi reali."""
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts" / "data"), str(ROOT / "scripts" / "climate")]
import build_comuni
import cache
import fetch_capoluoghi
import build_package


class FacadeGlazingTests(unittest.TestCase):
    def test_schema_e_integrali_iam_del_doppio_vetro(self):
        self.assertEqual(build_package.SCHEMA_VERSION, 3)
        iam2 = lambda aoi: build_package.pvlib.iam.physical(aoi) ** 2
        self.assertAlmostEqual(build_package.pvlib.iam.physical(0), 1.0, places=12)
        for region, expected in (("sky", 0.904), ("horizon", 0.947), ("ground", 0.904)):
            value = build_package.pvlib.iam.marion_integrate(iam2, 90, region)
            self.assertAlmostEqual(value, expected, delta=0.001)


class ComuniTests(unittest.TestCase):
    def test_conflitto_non_sostituito(self):
        c = {}
        d = {"name": "Cunico", "sigla": "AT", "zone": "F", "gg": 2698, "alt": 257, "reference": "PDF pagina 6"}
        build_comuni.assign_dpr(c, d, "DPR412")
        self.assertEqual((c["zone"], c["gg"], c["alt"]), ("F", 2698, 257))
        self.assertEqual(c["fonte"], "DPR412-conflitto")
        self.assertIn("da verificare", c["conflict"])
        self.assertEqual(c["reference"], "PDF pagina 6")

    def test_fusione_esplorativa_con_donatore(self):
        c = {"boundaryChanged": True}
        build_comuni.assign_dpr(c, {"name": "Montalto Pavese", "sigla": "PV", "zone": "E", "gg": 2800, "alt": 400}, "DPR412")
        self.assertEqual(c["fonte"], "DPR412-approssimato")
        self.assertEqual(c["donor"]["name"], "Montalto Pavese")
        self.assertIn("Confini modificati", c["nota"])

    def test_migrazione_copre_ogni_codice_storico_una_volta(self):
        rows = build_comuni.read_istat()
        self.assertEqual(len(rows), 7894)
        old = [code for c in rows for code in c["boundaryCodes"]]
        self.assertEqual(len(old), 7896)
        self.assertEqual(len(set(old)), 7896)
        self.assertTrue(all(c["registryDate"] == "2026-02-21" for c in rows))


class CacheTests(unittest.TestCase):
    def setUp(self):
        temp_root = Path(os.environ.get("CASA013_TMP", tempfile.gettempdir())) / "audit-b-work"
        temp_root.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=temp_root)
        self.root = Path(self.tmp.name)
        self.entry = json.loads((ROOT / "data/derived/capoluoghi.json").read_text("utf-8"))["015146"]
        self.raw = self.root / "data/raw"
        self.raw.mkdir(parents=True)
        for suffix in ("json.gz", "query.json"):
            name = "015146_pvgis53_tmy." + suffix
            shutil.copyfile(ROOT / "data/raw" / name, self.raw / name)
        self.gz = self.raw / "015146_pvgis53_tmy.json.gz"
        self.sidecar = self.raw / "015146_pvgis53_tmy.query.json"
        self.body = gzip.decompress(self.gz.read_bytes())
        self.request = cache.request_for(self.entry)

    def tearDown(self):
        self.tmp.cleanup()

    def test_cache_storica_integra_riutilizzabile(self):
        result = cache.load_cached(self.entry, self.root)
        self.assertIsNotNone(result)
        self.assertEqual(result[0], self.body)
        self.assertEqual(result[1]["requestKey"], cache.request_key(self.request))

    def test_coordinata_cambiata_invalida_anche_il_builder(self):
        changed = {**self.entry, "lat": self.entry["lat"] + 0.1}
        self.assertIsNone(cache.load_cached(changed, self.root))
        with patch.object(build_package, "ROOT", self.root):
            with self.assertRaisesRegex(SystemExit, "richiesta completa"):
                build_package.build("015146", changed)
            derived = self.root / "data/derived"
            derived.mkdir()
            (derived / "capoluoghi.json").write_text(json.dumps({"015146": changed}), "utf-8")
            (derived / "comuni.json").write_text(json.dumps([{"code": "015146", "zone": "E", "gg": 2404, "alt": 122, "name": "Milano", "sigla": "MI"}]), "utf-8")
            public = self.root / "public/data/packages"
            public.mkdir(parents=True)
            previous = '{"climates": []}'
            (public / "index.json").write_text(previous, "utf-8")
            with patch.object(sys, "argv", ["build_package.py"]), self.assertRaisesRegex(SystemExit, "richiesta completa"):
                build_package.main()
            self.assertEqual((public / "index.json").read_text("utf-8"), previous)

    def test_richiesta_completa_invalida_versione_finestra_database_e_opzioni(self):
        changes = [
            {**self.request, "endpoint": self.request["endpoint"].replace("v5_3", "v5_4")},
            *[{**self.request, "query": {**self.request["query"], k: v}} for k, v in
              [("startyear", "2006"), ("endyear", "2022"), ("raddatabase", "PVGIS-ERA5"), ("usehorizon", "0"), ("outputformat", "csv"), ("lon", "9.9999")]],
        ]
        for changed in changes:
            with self.subTest(changed=changed):
                self.assertNotEqual(cache.request_key(changed), cache.request_key(self.request))
                self.assertIsNone(cache.read_cached(self.gz, self.sidecar, changed, "015146"))

    def test_sidecar_assente_o_corrotto_non_riusa_file(self):
        self.sidecar.unlink()
        self.assertIsNone(cache.load_cached(self.entry, self.root))
        self.sidecar.write_text("{broken", "utf-8")
        self.assertIsNone(cache.load_cached(self.entry, self.root))

    def test_hash_e_byte_non_coerenti_invalidano_cache(self):
        meta = json.loads(self.sidecar.read_text("utf-8"))
        for field, value in [("sha256", "0" * 64), ("bytes", 1), ("climateId", "999999"), ("requestKey", "wrong")]:
            with self.subTest(field=field):
                self.sidecar.write_text(json.dumps({**meta, field: value}), "utf-8")
                self.assertIsNone(cache.load_cached(self.entry, self.root))

    def test_url_e_query_diverse_invalidano_cache(self):
        meta = json.loads(self.sidecar.read_text("utf-8"))
        meta["query"]["lat"] = "45.0000"
        self.sidecar.write_text(json.dumps(meta), "utf-8")
        self.assertIsNone(cache.load_cached(self.entry, self.root))

    def test_risposta_con_finestra_o_coordinate_diverse_non_diventa_cache_valida(self):
        raw = json.loads(self.body)
        raw["inputs"]["meteo_data"]["year_min"] = 2006
        with self.assertRaisesRegex(ValueError, "incoerente"):
            cache.save_response(self.entry, json.dumps(raw).encode(), self.root)
        raw = json.loads(self.body)
        raw["inputs"]["location"]["latitude"] += 0.1
        with self.assertRaisesRegex(ValueError, "incoerente"):
            cache.save_response(self.entry, json.dumps(raw).encode(), self.root)

    def test_aggiornamento_esplicito_conserva_le_copie_e_non_scrive_nei_grezzi(self):
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.raw.iterdir()}
        with patch.object(cache, "ROOT", self.root), patch.object(fetch_capoluoghi, "get", return_value=self.body) as get, patch.object(fetch_capoluoghi.time, "sleep"):
            fetch_capoluoghi.fetch_tmy(self.entry)
            get.assert_not_called()
            fetch_capoluoghi.fetch_tmy(self.entry, refresh=True)
            fetch_capoluoghi.fetch_tmy(self.entry, refresh=True)
            self.assertEqual(get.call_count, 2)
        self.assertEqual(len(list((self.root / "data/sources/climate").glob("*/*/response.json.gz"))), 2)
        self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.raw.iterdir()})
        self.assertIsNotNone(cache.load_cached(self.entry, self.root))


if __name__ == "__main__":
    unittest.main()
