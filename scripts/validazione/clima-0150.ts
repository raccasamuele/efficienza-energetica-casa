import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject, parseComuni, suggestClimate, applyLocation, unpackClimate, type ClimatePackage } from "../../src/engine";

const ROOT = resolve(__dirname, "../..");
const index = JSON.parse(readFileSync(resolve(ROOT, "public/data/packages/index.json"), "utf8")).climates;
const comuni = parseComuni(JSON.parse(readFileSync(resolve(ROOT, "public/data/comuni.json"), "utf8")));
const gg = JSON.parse(readFileSync(resolve(ROOT, "public/data/gradi-giorno.json"), "utf8"));
const cities = ["Milano", "Trento", "Sondrio", "Bari"];
const rows: unknown[] = [];
for (const name of cities) {
  const comune = comuni.find((c) => c.name === name)!;
  const match = suggestClimate(comune, index)!;
  const raw = JSON.parse(readFileSync(resolve(ROOT, `public/data/packages/${match.entry.id}.json`), "utf8"));
  const degreeDays = gg.cities[match.entry.id];
  const climate = (corrected: boolean) => ({ ...(unpackClimate(raw, { temperatureCorrection: corrected }) as ClimatePackage), degreeDays });
  const base = applyLocation(exampleProject(), comune, match);
  const results: Record<string, unknown> = {};
  for (const corrected of [false, true]) {
    const c = climate(corrected);
    const ev = evaluate(structuredClone(base), c);
    if (!ev.ok) throw new Error(`${name} ${corrected ? "corretto" : "TMY"}: ${JSON.stringify(ev.issues.filter((i) => i.severity === "errore"))}`);
    const pkg = (id: string) => ev.packages.find((p) => p.id === id)!;
    results[corrected ? "corretto" : "originale"] = {
      heating_kWh: ev.thermal!.base.heatNeed_kWh,
      cooling_kWh: pkg("base").coolNeed_kWh,
      gasSmc: pkg("base").gasSmc,
      costToday_EUR: pkg("base").costs.total,
      insulation: { saving_kWh: (pkg("base").gasKwh + pkg("base").elec.import_kWh) - (pkg("W").gasKwh + pkg("W").elec.import_kWh), saving_EUR_year: pkg("W").annualSaving, npv_EUR: pkg("W").cash?.npv ?? null },
      heatPump: { saving_kWh: (pkg("base").gasKwh + pkg("base").elec.import_kWh) - (pkg("H").gasKwh + pkg("H").elec.import_kWh), saving_EUR_year: pkg("H").annualSaving, npv_EUR: pkg("H").cash?.npv ?? null, blocker: pkg("H").blockers.join("; ") || null },
    };
    const bill = structuredClone(base);
    bill.consumption.gasSmcObserved.value = 1200;
    bill.consumption.observedStart = "2023-10";
    const calibrated = evaluate(bill, c);
    const baseTuned = calibrated.calibration?.packages.find((p) => p.id === "base");
    (results[corrected ? "corretto" : "originale"] as any).bill1200 = {
      factor: calibrated.calibration?.factor ?? null,
      heatingCalibrated_kWh: baseTuned?.heatNeed_kWh ?? null,
      note: calibrated.calibrationNote,
    };
  }
  const left: any = results.originale, right: any = results.corretto;
  const a = left.bill1200.heatingCalibrated_kWh, b = right.bill1200.heatingCalibrated_kWh;
  rows.push({ city: name, zone: base.location.zone, seasonStart: base.service.seasonStart, seasonEnd: base.service.seasonEnd, designOutdoorTemp_C: base.system.designOutdoorTemp.value, ...results, calibratedHeatingChangePct: a && b ? 100 * (b - a) / a : null });
}
console.log(JSON.stringify(rows, null, 2));
