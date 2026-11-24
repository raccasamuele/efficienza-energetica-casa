import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject, q } from "../../src/engine";
import { loadMilano } from "../helpers";

// Eseguito sul motore precedente alla 4B; la fixture non si rigenera.
const path = resolve(__dirname, "acqua-prima.json");
if (existsSync(path)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const cases = ["esempio", "split", "serramenti"].map((name) => {
  const p = exampleProject();
  if (name === "split") p.cooling.today = "split";
  if (name === "serramenti") p.goal = "serramenti";
  p.economics.homeValue = { enabled: true, energyClass: "E", marketValue: q(300000, "ipotizzato", "Stima dell'utente") };
  const ev = evaluate(p, climate);
  if (!ev.ok) throw new Error("Esempio non valido");
  return { name, calibrationFactor: ev.calibration?.factor ?? null, homeValue: ev.homeValue, packages: ev.packages.map((r) => ({
    id: r.id, label: r.label, heatNeed_kWh: r.heatNeed_kWh, peak_kW: r.peak_kW,
    gasSmc: r.gasSmc, import_kWh: r.elec.import_kWh, investment: r.investment,
    annualBenefit: r.annualBenefit, npv: r.cash?.npv ?? null,
  })) };
});
writeFileSync(path, JSON.stringify(cases, null, 2) + "\n", "utf8");
