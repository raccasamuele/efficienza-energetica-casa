// Valida tutti i pacchetti clima: npx vite-node scripts/check-packages.ts
import { readFileSync } from "node:fs";
import { unpackClimate, validateClimate, type ClimateIndexEntry } from "../src/engine";

const index = JSON.parse(readFileSync("public/data/packages/index.json", "utf-8")) as { climates: ClimateIndexEntry[] };
let bad = 0;
for (const e of index.climates) {
  const errs = validateClimate(unpackClimate(JSON.parse(readFileSync(`public/data/packages/${e.id}.json`, "utf-8"))));
  if (errs.length) {
    bad++;
    console.log(e.id, e.name, errs.slice(0, 3).join(" | "));
  }
}
console.log(`pacchetti: ${index.climates.length}, non validi: ${bad}`);
