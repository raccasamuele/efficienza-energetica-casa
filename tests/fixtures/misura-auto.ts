import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, exampleProject, runSensitivity, unpackClimate, type ClimatePackage } from "../../src/engine";

const climate = unpackClimate(JSON.parse(readFileSync(resolve("public/data/packages/015146.json"), "utf8"))) as ClimatePackage;
for (let giro = 1; giro <= 3; giro++) {
  for (const enabled of [false, true]) {
    const p = exampleProject(); p.ev.enabled = enabled;
    const start = performance.now();
    const ev = evaluate(p, climate);
    const evaluated = performance.now();
    const sensitivity = runSensitivity(p, climate, ev);
    const done = performance.now();
    if (!ev.ok) throw new Error("Esempio non valido");
    console.log(JSON.stringify({ giro, auto: enabled ? "accesa" : "spenta", evaluate_ms: evaluated - start, sensibilita_ms: done - evaluated, pacchetti: ev.packages.length, varianti: sensitivity.variants.length }));
  }
}
