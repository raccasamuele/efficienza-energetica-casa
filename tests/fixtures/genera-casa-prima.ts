import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { evaluate, type Goal } from "../../src/engine";
import { startProject } from "../../src/ui/journey";
import { loadMilano } from "../helpers";

const target = resolve(__dirname, "casa-prima.json");
if (existsSync(target)) throw new Error("La fixture originale esiste già: non sovrascriverla.");
const climate = loadMilano();
const goals: Goal[] = ["fv", "batteria", "pdc", "serramenti", "auto", "completo"];
const cases: { mode: "rapida" | "documentata"; goal: Goal }[] = goals.map((goal) => ({ mode: "rapida", goal }));
cases.push({ mode: "documentata", goal: "completo" });
const dataOut = cases.map(({ mode, goal }) => {
  const p = startProject(mode, true, goal);
  const ev = evaluate(p, climate);
  return {
    mode, goal, ok: ev.ok,
    packages: ev.packages.map((x) => ({ id: x.id, npv: x.cash?.npv ?? null, spending: x.costs.total, electricityKwh: x.elec.import_kWh, gasSmc: x.gasSmc, investment: x.investment })),
  };
});
const data = JSON.stringify(dataOut, null, 2) + "\n";
writeFileSync(target, data, { encoding: "utf8", flag: "wx" });
console.log(`Fixture: ${target}`);
console.log(`Bytes: ${Buffer.byteLength(data, "utf8")}`);
console.log(`SHA-256: ${createHash("sha256").update(data).digest("hex")}`);
