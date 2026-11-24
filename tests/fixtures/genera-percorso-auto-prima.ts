import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject, exportEnergyProfile } from "../../src/engine";
import { evStrategies } from "../../src/engine/auto";
import { loadMilano } from "../helpers";

const path = resolve(__dirname, "percorso-auto-prima.json");
if (existsSync(path)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const cases = [
  { name: "spenta-arrivo-fv-nuovo", enabled: false, strategy: "arrivo" as const, pv: "nuovo" },
  { name: "accesa-arrivo-fv-nuovo", enabled: true, strategy: "arrivo" as const, pv: "nuovo" },
  { name: "accesa-sole-fv-nuovo", enabled: true, strategy: "sole" as const, pv: "nuovo" },
  { name: "accesa-arrivo-fv-esistente", enabled: true, strategy: "arrivo" as const, pv: "esistente" },
  { name: "accesa-sole-fv-esistente", enabled: true, strategy: "sole" as const, pv: "esistente" },
  { name: "accesa-sole-batteria", enabled: true, strategy: "sole" as const, pv: "nuovo", battery: true },
].map(({ name, enabled, strategy, pv, battery }) => {
  const p = exampleProject();
  p.ev.enabled = enabled;
  p.ev.strategy = strategy;
  p.existingPv.present = pv === "esistente";
  if (battery) p.battery.enabled = true;
  const ev = evaluate(p, climate);
  if (!ev.ok) throw new Error(`Caso ${name} non valido`);
  return {
    name,
    packages: ev.packages.map((r) => ({
      id: r.id, npv: r.cash?.npv ?? null, spending: r.costs.total,
      import_kWh: r.elec.import_kWh, export_kWh: r.elec.export_kWh,
      investment: r.investment,
      ev: r.ev ? { home_kWh: r.ev.home_kWh, need_kWh: r.ev.need_kWh, outside_kWh: r.ev.outside_kWh,
        unmet_kWh: r.ev.unmet_kWh, fromPv_kWh: r.ev.fromPv_kWh, fromBattery_kWh: r.ev.fromBattery_kWh,
        fromGrid_kWh: r.ev.fromGrid_kWh, marginalCost: r.ev.marginalCost } : null,
      evStrategies: evStrategies(p, climate, r).map(({ strategy, home_kWh, fromPv_kWh, fromBattery_kWh, fromGrid_kWh, outside_kWh, unmet_kWh, marginalCost, peak_W, overContractHours, batteryBenefit }) => ({
        strategy, home_kWh, fromPv_kWh, fromBattery_kWh, fromGrid_kWh, outside_kWh, unmet_kWh, marginalCost, peak_W, overContractHours, batteryBenefit,
      })),
    })),
    profile: exportEnergyProfile(p, climate, ev.packages, new Date("2026-11-05T00:00:00Z")),
  };
});
writeFileSync(path, JSON.stringify(cases) + "\n", { encoding: "utf8", flag: "wx" });
