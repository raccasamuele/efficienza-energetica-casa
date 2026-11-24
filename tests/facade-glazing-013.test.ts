import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateClimate, unpackClimate } from "../src/engine/climate";
import { exampleProject } from "../src/engine/example";
import { buildEnvelope, simulateThermal, solarGainAtHour } from "../src/engine/thermal";
import { ENGINE_VERSION } from "../src/engine/types";
import { evaluate } from "../src/engine/scenarios";
import { constantClimate, loadMilanoLegacy } from "./helpers";

describe("trasmissione angolare dei vetri 0.13.0", () => {
  it("legge e scala facadeGlazing nello schema 3 e ne controlla le quattro serie", () => {
    const raw = {
      manifest: { schemaVersion: 3, scale: { tAir: 10, wind: 10, ghi: 1, facade: 1, facadeGlazing: 2, pvAc: 1 } },
      series: {
        tAir: Array(8760).fill(100), wind: Array(8760).fill(10), ghi: Array(8760).fill(0),
        facade: Object.fromEntries(["N", "E", "S", "O"].map((o) => [o, Array(8760).fill(0)])),
        facadeGlazing: Object.fromEntries(["N", "E", "S", "O"].map((o) => [o, Array(8760).fill(120)])),
        pvAc: Object.fromEntries(["E20", "E35", "S20", "S35", "O20", "O35"].map((o) => [o, Array(8760).fill(0)])),
      },
    };
    const climate = unpackClimate(raw) as any;
    expect(climate.series.facadeGlazing.S[0]).toBe(60);
    expect(validateClimate(climate)).toEqual([]);
    climate.series.facadeGlazing.N.pop();
    expect(validateClimate(climate)).toContain("facadeGlazing.N: 8759 valori invece di 8760");
  });

  it("mantiene esattamente Fw 0,9 e segnala i pacchetti senza serie angolare", () => {
    expect(ENGINE_VERSION).toBe("0.18.1");
    const p = exampleProject();
    const legacy = constantClimate(5, 100);
    const env = buildEnvelope(p.building, p.service, legacy);
    expect(env.solarArea.S).toBe(env.geometry.windows.S * p.building.gWindow.value * (1 - p.building.frameFraction.value) * p.building.shadingFactor.value * 0.9);
    expect(env.notes).toContain("Pacchetto clima senza dati angolari: Fw 0,9.");
    expect(simulateThermal(p.building, p.service, legacy).heatNeed_kWh).toBe(simulateThermal(p.building, p.service, { ...legacy, series: { ...legacy.series, facadeGlazing: undefined } }).heatNeed_kWh);
    const before = JSON.parse(readFileSync(resolve(__dirname, "fixtures/facade-glazing-013.json"), "utf8"));
    p.cooling.today = "split"; p.system.emitters = "ventilconvettori";
    const previous = simulateThermal(p.building, p.service, loadMilanoLegacy(), p.cooling);
    expect(previous.heatNeed_kWh).toBeCloseTo(before.before.base.heatNeed_kWh, 6);
    expect(previous.coolNeed_kWh).toBeCloseTo(before.before.base.coolNeed_kWh, 6);
  });

  it("usa le facciate pesate al posto di facade, senza Fw nell'area solare", () => {
    const p = exampleProject();
    const climate = unpackClimate(JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/015146.json"), "utf8")), { temperatureCorrection: false }) as any;
    const legacy = { ...climate, series: { ...climate.series, facadeGlazing: undefined } };
    const env = buildEnvelope(p.building, p.service, climate);
    expect(env.solarArea.S).toBe(env.geometry.windows.S * p.building.gWindow.value * (1 - p.building.frameFraction.value) * p.building.shadingFactor.value);
    expect(simulateThermal(p.building, p.service, climate).heatNeed_kWh).not.toBe(simulateThermal(p.building, p.service, legacy).heatNeed_kWh);
  });

  it("calcola a mano l'apporto di un'ora come somma di area solare per facadeGlazing", () => {
    const p = exampleProject();
    const base = constantClimate(0, 900);
    const glazing = Object.fromEntries((["N", "E", "S", "O"] as const).map((o, i) => [o, Array(8760).fill(i + 1)])) as any;
    const climate = { ...base, series: { ...base.series, facadeGlazing: glazing } };
    const env = buildEnvelope(p.building, p.service, climate);
    const expected = env.solarArea.N + 2 * env.solarArea.E + 3 * env.solarArea.S + 4 * env.solarArea.O;
    expect(solarGainAtHour(env, climate, 0)).toBe(expected);
    expect(solarGainAtHour(env, climate, 0, 0.5)).toBe(expected * 0.5);
  });

  it("riproduce la fixture 0.13.0 della casa d'esempio a Milano", () => {
    const expected = JSON.parse(readFileSync(resolve(__dirname, "fixtures/facade-glazing-013.json"), "utf8"));
    const p = exampleProject(); p.cooling.today = "split"; p.system.emitters = "ventilconvettori";
    const result = evaluate(p, unpackClimate(JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/015146.json"), "utf8")), { temperatureCorrection: false }) as any);
    for (const row of result.packages) {
      expect(row.heatNeed_kWh).toBeCloseTo(expected.after[row.id].heatNeed_kWh, 6);
      expect(row.coolNeed_kWh).toBeCloseTo(expected.after[row.id].coolNeed_kWh, 6);
    }
  });
});
