import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject, exportEnergyProfile } from "../../src/engine";
import { loadMilano } from "../helpers";

// Eseguito prima della tappa 5: questi numeri non si rigenerano.
const path = resolve(__dirname, "auto-prima.json");
if (existsSync(path)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const cases = ["esempio", "fv-esistente", "batteria", "scaldacqua-pdc", "split"].map((name) => {
  const p = exampleProject();
  if (name === "fv-esistente") p.existingPv.present = true;
  if (name === "batteria") p.battery.enabled = true;
  if (name === "scaldacqua-pdc") { p.dhw.replace = true; p.dhw.newType = "pdc"; }
  if (name === "split") p.cooling.today = "split";
  const ev = evaluate(p, climate);
  if (!ev.ok) throw new Error(`Caso ${name} non valido`);
  return { name, packages: ev.packages.map((r) => ({
    id: r.id, npv: r.cash?.npv ?? null, bill: r.costs.total,
    import_kWh: r.elec.import_kWh, export_kWh: r.elec.export_kWh,
    investment: r.investment, pvKwp: r.pvKwp, batteryKwh: r.battery?.capacity_kWh ?? null,
  })), profile: exportEnergyProfile(p, climate, ev.packages, new Date("2026-11-05T00:00:00Z")) };
});
writeFileSync(path, JSON.stringify(cases, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
