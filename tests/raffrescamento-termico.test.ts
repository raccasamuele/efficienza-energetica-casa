import { describe, expect, it } from "vitest";
import { coolingLimit, coolingMask, exampleProject, exchangeSplit, rcStep, simulateThermal } from "../src/engine";
import { constantClimate, coolingProject, loadMilanoLegacy, steady5R1C } from "./helpers";

const milano = loadMilanoLegacy();
/** Fabbisogno di riscaldamento della casa d'esempio senza raffrescamento: motore 0.8.0, convezione esterna dei vetri (0.7.1: 16078.303085084244; 0.7.0: 16373.64928867066; 0.6.0: 17469.034587480943; 0.1.2-0.5.0: 18990.02589252119). */
const HEAT_NEED_0_1_2 = 15989.535197808718;

describe("Raffrescamento — modello termico", () => {
  it("rcStep raffresca fino a tMax con la soluzione esatta", () => {
    const H = 300, C = 2e7, tOut = 40, T0 = 26;
    const r = rcStep(T0, H, H * tOut, 0, C, 3600, null, 26);
    const a = Math.exp((-H * 3600) / C);
    const tFree = a * T0 + (1 - a) * tOut;
    expect(r.tNext).toBeCloseTo(26, 9);
    expect(r.qCool).toBeCloseTo((H * (tFree - 26)) / (1 - a), 6);
    expect(r.qHeat).toBe(0);
  });

  it("nessun carico estivo se la temperatura libera resta sotto tMax", () => {
    const r = rcStep(24, 300, 300 * 25, 0, 2e7, 3600, null, 26);
    expect(r.qCool).toBe(0);
    expect(r.tNext).toBeLessThan(26);
  });

  it("limite H→0 anche in raffrescamento", () => {
    const r = rcStep(26, 0, 0, 5000, 2e7, 3600, null, 26);
    expect(r.qCool).toBeCloseTo(5000, 6);
    expect(r.tNext).toBe(26);
  });

  it("la differenza massima alza il limite con il caldo", () => {
    const c = exampleProject().cooling;
    expect(coolingLimit(38, c)).toBe(28);
    expect(coolingLimit(30, c)).toBe(26);
  });

  it("bilancio in regime con clima costante caldo", () => {
    const p = coolingProject();
    const clim = constantClimate(32);
    const t = simulateThermal(p.building, p.service, clim, p.cooling);
    const env = t.envelope;
    const x = exchangeSplit(env, clim);
    const hx = { Hve: x.ve.H[0], Bve: x.ve.B[0], Hw: x.w.H[0], Bw: x.w.B[0], Hop: x.op.H[0], Bop: x.op.B[0] };
    const tMax = coolingLimit(32, p.cooling);
    // regime della rete 5R1C a mano: potenza negativa = calore sottratto (motore 0.7.0)
    const ss = steady5R1C(hx, env.Am, env.Af, env.internalGainW, 0, tMax);
    const hours = coolingMask(p.cooling).filter(Boolean).length;
    const latent = p.cooling.latentFactor.value;
    const mid = t.qCool.findIndex((q, h) => q > 0 && h > 5000);
    expect(Math.abs(t.qCool[mid] / latent + ss.phi) / -ss.phi).toBeLessThan(1e-9);
    const expected = (-ss.phi * latent * hours) / 1000;
    // a inizio periodo si scarica anche la massa, alcune decine di kWh
    expect(Math.abs(t.coolNeed_kWh - expected) / expected).toBeLessThan(0.02);
    expect(t.coolHours).toBe(hours);
  });

  it("senza CoolingInput nessun carico estivo e riscaldamento come prima", () => {
    const p = exampleProject();
    const a = simulateThermal(p.building, p.service, milano);
    expect(a.coolNeed_kWh).toBe(0);
    expect(a.qCool.every((x) => x === 0)).toBe(true);
    // tolleranza relativa 1e-12: sul server di pubblicazione (Linux) l'ultima cifra binaria differisce (motore 0.7.1)
    expect(Math.abs(a.heatNeed_kWh - HEAT_NEED_0_1_2) / HEAT_NEED_0_1_2).toBeLessThan(1e-12);
    expect(simulateThermal(p.building, p.service, milano, p.cooling).coolNeed_kWh).toBeGreaterThan(0);
  });

  it("il fattore latente moltiplica il carico estivo", () => {
    const p = coolingProject();
    const base = simulateThermal(p.building, p.service, milano, p.cooling).coolNeed_kWh;
    p.cooling.latentFactor.value = 1.2;
    expect(simulateThermal(p.building, p.service, milano, p.cooling).coolNeed_kWh).toBeCloseTo(base * 1.2, 6);
  });

  it("schermature estive più forti riducono il carico estivo", () => {
    const p = coolingProject();
    const base = simulateThermal(p.building, p.service, milano, p.cooling).coolNeed_kWh;
    p.cooling.summerShading.value = 0.4;
    expect(simulateThermal(p.building, p.service, milano, p.cooling).coolNeed_kWh).toBeLessThan(base);
  });

  it("limite orario esposto solo nel periodo estivo", () => {
    const p = coolingProject();
    const t = simulateThermal(p.building, p.service, milano, p.cooling);
    const mask = coolingMask(p.cooling);
    t.tMax.forEach((v, h) => expect(Number.isNaN(v)).toBe(!mask[h]));
    expect(Math.max(...t.qCool.filter((_, h) => !mask[h]))).toBe(0);
  });
});
