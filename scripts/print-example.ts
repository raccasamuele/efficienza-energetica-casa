// Stampa i risultati del caso d'esempio: npx vite-node scripts/print-example.ts
import { readFileSync } from "node:fs";
import { defaultVariants, evaluate, exampleProject, flowTemperature, runSensitivity, unpackClimate, type ClimatePackage } from "../src/engine";

const climate = unpackClimate(JSON.parse(readFileSync("public/data/packages/015146.json", "utf-8"))) as ClimatePackage;
const p = exampleProject();
const t0 = performance.now();
const ev = evaluate(p, climate);
const t1 = performance.now();
const s = runSensitivity(p, climate, ev);
const t2 = performance.now();
const env = ev.thermal.base.envelope;
console.log("H [W/K]", env.H.toFixed(1), env.exchanges.map((e) => `${e.label}=${e.H.toFixed(1)}`).join("; "));
console.log("C [MJ/K]", (env.C / 1e6).toFixed(1), "cicli", ev.thermal.base.cycles, "gap gas osservato %", ev.observedGapPct?.toFixed(1));
for (const r of ev.packages)
  console.log(
    r.id.padEnd(4),
    `Q=${r.heatNeed_kWh.toFixed(0)} kWh (${r.heatNeedPerM2.toFixed(0)}/m²) picco=${r.peak_kW.toFixed(1)} kW`,
    `gas=${r.gasSmc.toFixed(0)} Smc el.imp=${r.elec.import_kWh.toFixed(0)} pv=${r.elec.pv_kWh.toFixed(0)} self=${r.elec.self_kWh.toFixed(0)}`,
    `costo=${r.costs.total.toFixed(0)} risp=${r.annualSaving.toFixed(0)} inv=${r.investment.toFixed(0)}`,
    r.cash ? `VAN=${r.cash.npv.toFixed(0)} PB=${r.cash.simplePayback?.toFixed(1)}` : "VAN=—",
    r.hp ? `SCOP=${r.hp.seasonalCop.toFixed(2)} under=${r.hp.hoursUndersized} ood=${r.hp.hoursOutOfDomain}` : "",
    r.valid ? "" : "NON VALIDO",
  );
console.log("best", s.nominalBest, "stabile", s.bestStableShare?.toFixed(2));
for (const x of s.packages) console.log(x.id, "risp", x.benefitMin.toFixed(0), "…", x.benefitMax.toFixed(0), "VAN", x.npvMin?.toFixed(0), "…", x.npvMax?.toFixed(0), x.unresolved ? "NON RISOLTA" : "", x.invalidIn.length ? `non valido in ${x.invalidIn.length}: ${x.invalidIn.join("; ")}` : "");
const invalidLabels = new Set(s.packages.flatMap((x) => x.invalidIn));
for (const v of defaultVariants(p).filter((x) => invalidLabels.has(x.label))) {
  const changed = v.apply(p);
  const result = evaluate(changed, climate);
  console.log(`Variante ${v.id}: ${v.label}`);
  for (const r of result.packages.filter((x) => !x.valid)) {
    const th = r.has.W ? result.thermal!.windows : result.thermal!.base;
    const air = climate.series.tAir.filter((_, h) => th.qHeat[h] > 0);
    const flow = air.map((t) => flowTemperature(t, changed.system.designFlowTemp.value, changed.system.designOutdoorTemp.value, changed.service.setpoint.value));
    console.log(`${r.id}: aria minima con carico ${Math.min(...air).toFixed(2)} °C; mandata massima ${Math.max(...flow).toFixed(2)} °C; ore fuori dominio ${r.hp?.hoursOutOfDomain}; ore sottodimensionate ${r.hp?.hoursUndersized}. ${r.blockers.join(" ")}`);
  }
}
console.log(`tempi: valutazione ${(t1 - t0).toFixed(0)} ms, sensibilità ${(t2 - t1).toFixed(0)} ms`);
console.log("issues", ev.issues.map((i) => `[${i.severity}] ${i.message}`).join("\n"));
