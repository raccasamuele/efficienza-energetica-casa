import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject } from "../src/engine";
import { loadMilano } from "./helpers";

// Tappa B del piano dopo la 8: i messaggi del motore non usano più «dominio», «esplorativo», «V1», «TMY».
// Il valore interno severity: "esplorativo" non si vede e resta; commenti e nomi del codice non contano.
const FORBIDDEN = /\bV1\b|\bTMY\b|dominio|esplorativ/i;
const engineDir = resolve(__dirname, "../src/engine");

/** Solo il testo dentro le stringhe, senza commenti e senza il valore interno «esplorativo». */
function stringLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  return [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)]
    .map((m) => m[0])
    .filter((s) => s !== '"esplorativo"');
}

describe("messaggi del motore con parole semplici", () => {
  it("nessuna stringa del motore contiene le parole vecchie", () => {
    const found: string[] = [];
    for (const file of readdirSync(engineDir).filter((f) => f.endsWith(".ts"))) {
      for (const s of stringLiterals(readFileSync(resolve(engineDir, file), "utf8"))) if (FORBIDDEN.test(s)) found.push(`${file}: ${s.slice(0, 120)}`);
    }
    expect(found).toEqual([]);
  });

  it("i messaggi della casa d'esempio e dei suoi pacchetti non le contengono", () => {
    const p = exampleProject();
    p.mode = "rapida";
    p.heatPump.model = "parametrico";
    const ev = evaluate(p, loadMilano());
    const texts = [
      ...ev.issues.map((i) => i.message),
      ...ev.packages.flatMap((r) => [...r.conditions, ...r.blockers, ...r.services.map((s) => s.generator)]),
      ...(ev.thermal ? [...ev.thermal.base.notes] : []),
    ];
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => FORBIDDEN.test(t))).toEqual([]);
  });
});
