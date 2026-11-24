import { collectorIrradiance, evaluate, exampleProject, planeIrradiance } from "../../src/engine";
import { loadMilano } from "../helpers";

// Stampa i numeri della 4C per il registro LOG-4C.md (non è un test).
const climate = loadMilano();
const kwh = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / 1000;
console.log("facciata S: mio", kwh(planeIrradiance(climate, 90, 180)).toFixed(1), "pvlib", kwh(climate.series.facade.S).toFixed(1));
console.log("orizzontale", kwh(climate.series.ghi).toFixed(1), "S35", kwh(collectorIrradiance(climate, "S35")).toFixed(1), "E35", kwh(collectorIrradiance(climate, "E35")).toFixed(1));
for (const [backup, hpIncluded] of [["gas", true], ["gas", false], ["elettrico", false]] as const) {
  const p = exampleProject(); p.dhw.replace = true; p.heatPump.included = hpIncluded; p.dhw.newType = "solare"; p.dhw.solarBackup = backup;
  const t0 = performance.now(), ev = evaluate(p, climate), ms = performance.now() - t0;
  console.log(`\n== integrazione ${backup}, PDC ${hpIncluded} (${ms.toFixed(0)} ms)`);
  for (const r of ev.packages) {
    const d = r.dhw?.result;
    console.log(r.id, r.label, "| gas", r.gasSmc.toFixed(1), "Smc | prelievi", r.elec.import_kWh.toFixed(0), "kWh | inv", r.investment.toFixed(0), "| beneficio", r.annualBenefit.toFixed(0), "| VAN", r.cash?.npv?.toFixed(0) ?? "—",
      d ? `| sole ${d.solar_kWh.toFixed(0)} prelievi ${d.draw_kWh.toFixed(0)} perdite ${d.loss_kWh.toFixed(0)} integr ${d.heat_kWh.toFixed(0)} gasInt ${d.backupGas_kWh.toFixed(0)} elettr ${d.elec_kWh.toFixed(0)} pompa ${d.pump_kWh.toFixed(0)} buttato ${d.dumped_kWh.toFixed(0)} oreSotto40 ${d.unmetHours}` : "", r.blockers.join(" "));
  }
}
const p = exampleProject(); p.dhw.replace = true; p.heatPump.included = false; p.dhw.newType = "pdc";
const ev = evaluate(p, climate), h = ev.packages.find((r) => r.id === "H")!;
console.log("\nconfronto PDC scaldacqua: beneficio", h.annualBenefit.toFixed(0), "VAN", h.cash?.npv?.toFixed(0), "elettr", h.dhw!.result.elec_kWh.toFixed(0));
