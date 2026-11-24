import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject } from "../../src/engine";
import { loadMilano } from "../helpers";

// Eseguito sul motore precedente alla 4C (commit c93c7fb); la fixture non si rigenera.
const path = resolve(__dirname, "solare-prima.json");
if (existsSync(path)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const cases = ["gas-pdc", "gas-elettrico", "boiler-pdc", "boiler-elettrico", "boiler-oggi"].map((name) => {
  const p = exampleProject();
  if (name.startsWith("boiler")) { p.system.acsOnGas = false; p.dhw.todayElectric = true; p.heatPump.included = false; }
  p.dhw.replace = name !== "boiler-oggi";
  p.dhw.newType = name.endsWith("elettrico") ? "elettrico" : "pdc";
  const ev = evaluate(p, climate);
  if (!ev.ok) throw new Error(`Caso ${name} non valido`);
  return { name, packages: ev.packages.map((r) => ({
    id: r.id, label: r.label, gasSmc: r.gasSmc, import_kWh: r.elec.import_kWh, investment: r.investment,
    annualBenefit: r.annualBenefit, npv: r.cash?.npv ?? null,
    dhw: r.dhw ? { generator: r.dhw.generator, elec_kWh: r.dhw.result.elec_kWh, heat_kWh: r.dhw.result.heat_kWh, loss_kWh: r.dhw.result.loss_kWh, unmetHours: r.dhw.result.unmetHours, cop: r.dhw.result.cop } : null,
  })) };
});
writeFileSync(path, JSON.stringify(cases, null, 2) + "\n", "utf8");
