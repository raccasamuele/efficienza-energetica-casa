import { describe, expect, it } from "vitest";
import { HOURS, nonFinitePaths, simulateSplit, splitEer } from "../src/engine";
import { constantClimate, coolingProject } from "./helpers";

describe("Raffrescamento — split", () => {
  it("EER tarato a 35 °C", () => {
    expect(splitEer(35, 26, 3.2)).toBeCloseTo(3.2, 9);
  });

  it("EER più alto con aria più fresca, limitato a 1,5–8", () => {
    expect(splitEer(28, 26, 3.2)).toBeGreaterThan(3.2);
    expect(splitEer(80, 26, 3.2)).toBe(1.5);
    expect(splitEer(14, 26, 6)).toBe(8);
  });

  it("consumo = carico / EER ora per ora", () => {
    const c = coolingProject().cooling;
    const q = new Array<number>(HOURS).fill(0);
    const tMax = new Array<number>(HOURS).fill(NaN);
    q[4000] = 2000;
    tMax[4000] = 26;
    const r = simulateSplit(q, tMax, constantClimate(35), c);
    expect(r.elec[4000]).toBeCloseTo(2000 / 3.2, 6);
    expect(r.elec_kWh).toBeCloseTo(2 / 3.2, 9);
    expect(r.delivered_kWh).toBeCloseTo(2, 9);
    expect(r.seasonalEer).toBeCloseTo(3.2, 9);
    expect(r.generator).toContain("Split");
  });

  it("potenza insufficiente: ore e kWh non forniti, consumo finito", () => {
    const c = coolingProject().cooling;
    c.splitCapacity.value = 0.5;
    const q = new Array<number>(HOURS).fill(0);
    const tMax = new Array<number>(HOURS).fill(26);
    q[100] = 2000;
    const r = simulateSplit(q, tMax, constantClimate(35), c);
    expect(r.hoursUndersized).toBe(1);
    expect(r.undelivered_kWh).toBeCloseTo(1.5, 6);
    expect(r.delivered_kWh).toBeCloseTo(0.5, 6);
    expect(Number.isFinite(r.elec_kWh)).toBe(true);
  });

  it("nessun freddo fornito: EER stagionale NaN ammesso", () => {
    const r = simulateSplit(new Array<number>(HOURS).fill(0), new Array<number>(HOURS).fill(NaN), constantClimate(20), coolingProject().cooling);
    expect(r.elec_kWh).toBe(0);
    expect(r.seasonalEer).toBeNaN();
    expect(nonFinitePaths({ cooling: r })).toEqual([]);
    expect(nonFinitePaths({ cooling: { ...r, elec_kWh: NaN } })).toEqual(["cooling.elec_kWh"]);
  });
});
