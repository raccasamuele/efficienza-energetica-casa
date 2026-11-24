import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";
import { evaluate, exampleProject } from "../../src/engine";
import { loadMilano } from "../helpers";

// Eseguito prima delle modifiche al motore; la fixture non deve essere sovrascritta.
it("salva i risultati originali una sola volta", () => {
  const path = resolve(__dirname, "involucro-prima.json");
  if (existsSync(path)) return;
  const climate = loadMilano();
  const cases = ["esempio", "split", "serramenti"].map((name) => {
    const p = exampleProject();
    if (name === "split") p.cooling.today = "split";
    if (name === "serramenti") p.goal = "serramenti";
    const ev = evaluate(p, climate);
    if (!ev.ok) throw new Error("Esempio non valido");
    return { name, calibrationFactor: ev.calibration?.factor ?? null, packages: ev.packages.map((r) => ({
      id: r.id, label: r.label, heatNeed_kWh: r.heatNeed_kWh, peak_kW: r.peak_kW,
      gasSmc: r.gasSmc, import_kWh: r.elec.import_kWh, investment: r.investment,
      annualBenefit: r.annualBenefit, npv: r.cash?.npv ?? null,
    })) };
  });
  writeFileSync(path, JSON.stringify(cases, null, 2) + "\n", "utf8");
});
