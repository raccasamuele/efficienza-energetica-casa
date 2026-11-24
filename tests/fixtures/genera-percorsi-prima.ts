import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { evaluate, exampleProject, runSensitivity, type ProjectInput } from "../../src/engine";
import { loadMilano } from "../helpers";

const target = resolve(__dirname, "percorsi-prima.json");
if (existsSync(target)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const cases = [
  { name: "indicativa-boiler-no-ev-no", mutate: (p: ProjectInput) => { p.pv.sizing = "indicativa"; p.heatPump.boilerEndOfLife = false; p.ev.enabled = false; } },
  { name: "indicativa-boiler-si-ev-no", mutate: (p: ProjectInput) => { p.pv.sizing = "indicativa"; p.heatPump.boilerEndOfLife = true; p.ev.enabled = false; } },
  { name: "indicativa-boiler-si-ev-si", mutate: (p: ProjectInput) => { p.pv.sizing = "indicativa"; p.heatPump.boilerEndOfLife = true; p.ev.enabled = true; } },
  { name: "preventivo", mutate: (p: ProjectInput) => { p.pv.sizing = "preventivo"; p.heatPump.boilerEndOfLife = false; p.ev.enabled = false; } },
];
const out = cases.map(({ name, mutate }) => {
  const p = exampleProject(); mutate(p);
  const ev = evaluate(p, climate);
  if (!ev.ok) throw new Error(`Caso ${name} non valido`);
  const sens = runSensitivity(p, climate, ev);
  return { name, packages: ev.packages.map((x) => ({ id: x.id, npv: x.cash?.npv ?? null, cashFlows: x.cash?.cashFlows ?? null, investment: x.investment, spending: x.costs.total })), sensitivity: { packages: sens.packages.map((x) => ({ id: x.id, npvMin: x.npvMin, npvMax: x.npvMax })), nominalBest: sens.nominalBest, bestStableShare: sens.bestStableShare } };
});
const data = JSON.stringify(out, null, 2) + "\n";
writeFileSync(target, data, { encoding: "utf8", flag: "wx" });
console.log(`Fixture: ${target}`);
console.log(`Bytes: ${Buffer.byteLength(data, "utf8")}`);
console.log(`SHA-256: ${createHash("sha256").update(data).digest("hex")}`);
