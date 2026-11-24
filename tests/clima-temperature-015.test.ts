import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { temperatureOffsetSeries, unpackClimate, validateClimate } from "../src/engine/climate";
import { exampleProject, parseProjectFile, toProjectFile } from "../src/engine";
import { loadMilano } from "./helpers";

describe("correzione temperature clima 0.15.0", () => {
  it("migra i progetti 0.14.0 e annuncia il ricalcolo con 0.18.1", () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/015146.json"), "utf-8"));
    const climate = unpackClimate(raw) as any;
    const file = toProjectFile(exampleProject(), climate);
    file.engineVersion = "0.14.0";
    const parsed = parseProjectFile(JSON.stringify(file), climate);
    expect(parsed.warnings).toContain("Progetto salvato con motore 0.14.0: i risultati vengono ricalcolati con 0.18.1.");
  });
  it("applica interpolazione ciclica ai nodi del fixture", () => {
    const f = JSON.parse(readFileSync(resolve(__dirname, "fixtures/clima-temperature-015.json"), "utf-8"));
    const series = temperatureOffsetSeries({ temperatureCorrection: { ...f, method: "test", reference: "test", rawSha256: "a".repeat(64) } } as any);
    expect(series).toHaveLength(8760);
    expect(series[371]).toBeCloseTo(1, 1);
    expect(series[372]).toBeGreaterThan(1);
    expect(Math.abs(series[8759] - series[0])).toBeLessThan(0.05);
  });
  it("accetta nodi e scarti fino a ±20 °C e rifiuta oltre il limite", () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/015146.json"), "utf-8"));
    const decoded = unpackClimate(raw) as any;
    const correction = decoded.manifest.temperatureCorrection;
    correction.knots_C[0] = 20; correction.monthlyOffset_C[0] = -20;
    expect(validateClimate(decoded)).toEqual([]);
    correction.knots_C[0] = 20.001;
    expect(validateClimate(decoded).some((e: string) => e.includes("knots_C"))).toBe(true);
  });
  it("restituisce il TMY senza correzione se richiesto e valida i campi nuovi", () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/015146.json"), "utf-8"));
    const original = unpackClimate(raw, { temperatureCorrection: false }) as any;
    expect(original.temperatureCorrected).toBe(false);
    expect(original.series.tAir[0]).toBe(raw.series.tAir[0] / raw.manifest.scale.tAir);
    expect(validateClimate(unpackClimate(raw))).toEqual([]);
  });
  it("le medie mensili corrette rispettano gli scarti per Milano, Sondrio e Bari", () => {
    const index = JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/index.json"), "utf-8"));
    for (const name of ["Milano", "Sondrio", "Bari"]) {
      const raw = JSON.parse(readFileSync(resolve(__dirname, `../public/data/packages/${index.climates.find((c: any) => c.name === name).id}.json`), "utf-8"));
      const original = unpackClimate(raw, { temperatureCorrection: false }) as any;
      const corrected = unpackClimate(raw) as any;
      let offset=0;
      const days=[31,28,31,30,31,30,31,31,30,31,30,31];
      for(let m=0;m<12;m++) { const n=days[m]*24; const a=original.series.tAir.slice(offset,offset+n).reduce((s:number,v:number)=>s+v,0)/n; const b=corrected.series.tAir.slice(offset,offset+n).reduce((s:number,v:number)=>s+v,0)/n; expect(Math.abs((b-a)-raw.manifest.temperatureCorrection.monthlyOffset_C[m])).toBeLessThan(0.001); offset+=n; }
      expect(Math.max(...corrected.temperatureOffsets_C.slice(1).map((v:number,i:number)=>Math.abs(v-corrected.temperatureOffsets_C[i])))).toBeLessThan(0.05);
    }
    expect(loadMilano().temperatureCorrected).toBe(true);
  });
});

