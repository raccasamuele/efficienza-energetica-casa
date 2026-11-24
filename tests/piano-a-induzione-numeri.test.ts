import { it } from "vitest";
import { defaultCookingSwitch, evaluate, exampleProject } from "../src/engine";
import { loadMilano } from "./helpers";

it("stampa i numeri per il revisore: Milano, scaldacqua a pompa di calore, H e HP", () => {
  const p = exampleProject(), climate = loadMilano();
  p.dhw.replace = true;
  p.dhw.newType = "pdc";
  // Importi di prova dichiarati, non prezzi di mercato né preventivi reali.
  p.cooking = { ...defaultCookingSwitch(), hobCost: { value: 1000, status: "documentato", source: "Costo di prova dichiarato nel test: piano, pentole e posa" }, meterClosureCost: { value: 200, status: "documentato", source: "Costo di prova dichiarato nel test: chiusura del contatore" } };
  for (const enabled of [false, true]) {
    p.cooking.enabled = enabled;
    const ev = evaluate(p, climate);
    for (const id of ["H", "HP"]) {
      const r = ev.packages.find((x) => x.id === id)!;
      console.log(JSON.stringify({ pacchetto: id, induzione: enabled, gasCucina_Smc: r.services.find((s) => s.service === "Cucina" && s.carrier === "gas")?.smc ?? 0, elettricitaInPiu_kWh: r.cooking?.elec_kWh ?? 0, quotaFissaGas_EUR: r.costs.gasFixed, spesaAnnua_EUR: r.costs.total, investimento_EUR: r.investment, VAN_EUR: r.cash?.npv ?? null }));
    }
  }
});
