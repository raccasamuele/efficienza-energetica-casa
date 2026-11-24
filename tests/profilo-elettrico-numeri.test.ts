import { it } from "vitest";
import { applyLocation, evaluate, exampleProject, matchClimate, parseComuni, selfConsumption, selfSufficiency, type ClimateIndexEntry } from "../src/engine";
import { fmt } from "../src/ui/format";
import { applyGoal } from "../src/ui/goals";
import { loadPackage, readPublicJson } from "./helpers";

// Numeri per il revisore: nessuna asserzione sui valori e nessun riferimento rigenerato.
it("stampa il confronto dei profili sulla domanda fotovoltaico a Milano e Bari", () => {
  const comuni = parseComuni(readPublicJson("comuni.json"));
  const index = (readPublicJson("packages/index.json") as { climates: ClimateIndexEntry[] }).climates;
  const rows = ["Città | Abitudine | Modo | Autoconsumo FV % | Autosufficienza FV % | VAN FV € | Autoconsumo FV+batteria % | Autosufficienza FV+batteria % | VAN FV+batteria €"];
  for (const name of ["Milano", "Bari"]) {
    const entry = index.find((c) => c.name === name)!, climate = loadPackage(entry.id), comune = comuni.find((c) => c.name === name)!;
    for (const profile of ["diurno", "serale", "distribuito"] as const) for (const mode of ["sintetico", "stagionale"] as const) {
      const p = applyLocation(exampleProject(), comune, matchClimate(comune, index).find((m) => m.entry.id === entry.id)!);
      applyGoal(p, "fv"); p.consumption.profile = profile; p.consumption.profileMode = mode;
      const r = evaluate(p, climate).packages.find((r) => r.id === "P")!;
      const b = r.battery;
      rows.push([name, profile, mode, fmt(b?.without.selfConsumptionPct ?? selfConsumption(r.elec), 2), fmt(b?.without.selfSufficiencyPct ?? selfSufficiency(r.elec), 2), fmt(b ? b.without.npv : r.cash?.npv, 2), fmt(b?.selfConsumptionPct, 2), fmt(b?.selfSufficiencyPct, 2), fmt(b ? r.cash?.npv : null, 2)].join(" | "));
    }
  }
  console.log("\nVAN senza incentivo; FV senza batteria e pacchetto FV con batteria.\n" + rows.join("\n"));
}, 120000);
