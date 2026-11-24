import { it } from "vitest";
import { applyLocation, defaultHeatingSchedule, evaluate, exampleProject, matchClimate, parseComuni, type ClimateIndexEntry, type PackageId } from "../src/engine";
import { fmt } from "../src/ui/format";
import { loadPackage, readPublicJson } from "./helpers";

// Nessuna asserzione sui numeri, nessun dato di riferimento scritto o modificato.
it("stampa la casa d'esempio a Milano, Trento e Bari", () => {
  const comuni = parseComuni(readPublicJson("comuni.json"));
  const index = (readPublicJson("packages/index.json") as { climates: ClimateIndexEntry[] }).climates;
  const rows: string[] = ["Città | Modo | PDC | Fabbisogno kWh | Taratura | VAN PDC € | VAN Serramenti € | Pmax kW | Ore fredde"];
  const notes: string[] = [];
  for (const name of ["Milano", "Trento", "Bari"]) {
    const entry = index.find((c) => c.name === name)!;
    const climate = loadPackage(entry.id), comune = comuni.find((c) => c.name === name)!;
    for (const mode of ["continuo", "spento", "ridotta"] as const) {
      for (const hp of mode === "continuo" ? ["continuo"] as const : ["continuo", "come-oggi"] as const) {
        const p = applyLocation(exampleProject(), comune, matchClimate(comune, index).find((m) => m.entry.id === entry.id)!);
        p.climateId = entry.id;
        if (mode !== "continuo") { p.service.schedule = defaultHeatingSchedule(); p.service.schedule.setback = mode; p.service.schedule.withHeatPump = hp; }
        const ev = evaluate(p, climate);
        const van = (id: PackageId) => ev.packages.find((r) => r.id === id)?.cash?.npv;
        const schedule = ev.thermal?.base.schedule;
        // Nell'esempio non c'è un periodo di bolletta: il fattore è il rapporto diretto dopo ACS e cucina.
        const sys = p.system;
        const heatGas = ev.thermal ? ev.thermal.base.heatNeed_kWh / sys.boilerEfficiency.value / (sys.efficiencyBasis === "PCS" ? sys.gasPcs.value : sys.gasPci.value) : NaN;
        const factor = (p.consumption.gasSmcObserved.value - (sys.acsOnGas ? sys.acsGasSmc.value : 0) - (sys.cookingOnGas ? sys.cookingGasSmc.value : 0)) / heatGas;
        rows.push([name, mode, hp, fmt(ev.thermal?.base.heatNeed_kWh, 2), `${fmt(factor, 6)}${ev.calibration ? "" : " (non applicata)"}`, fmt(van("H"), 2), fmt(van("W"), 2), fmt(schedule?.pMax_W ? schedule.pMax_W / 1000 : null, 3), fmt(schedule?.coldHours)].join(" | "));
        if (hp === "come-oggi") {
          const tuned = ev.calibration?.packages.find((r) => r.id === "H");
          if (tuned?.hp?.hoursUndersized) notes.push(`${name}, ${mode}: dopo la scala di taratura la PDC supera la potenza in ${tuned.hp.hoursUndersized} ore (§17.2.4 e §17.2.5 da conciliare).`);
        }
      }
    }
  }
  console.log("\nLocalità applicata con stagione della zona e temperatura di progetto proposta; VAN senza taratura.\n" + rows.join("\n") + (notes.length ? "\n" + notes.join("\n") : ""));
}, 120000);
