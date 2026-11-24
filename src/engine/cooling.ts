import { HOURS, type ClimatePackage } from "./climate";
import type { CoolingInput } from "./types";

/** Raffrescamento di un pacchetto: consumo elettrico orario del generatore (split o PDC). */
export interface CoolingResult {
  elec: number[]; // W
  elec_kWh: number;
  delivered_kWh: number; // freddo fornito
  seasonalEer: number; // NaN se non si fornisce freddo
  hoursUndersized: number;
  undelivered_kWh: number; // carico oltre la potenza, non fornito
  hoursExtrapolated: number;
  generator: string;
}

export const EER_MIN = 1.5;
export const EER_MAX = 8;
const K = 273.15;
const EVAP_DT = 14; // batteria interna sotto la temperatura obiettivo
const COND_DT = 10; // condensatore sopra l'aria esterna
const it1 = (v: number) => v.toFixed(1).replace(".", ",");

/** EER parametrico esplorativo degli split: Carnot ridotto tarato sull'EER dichiarato a 35 °C esterni e 26 °C interni. */
export function splitEer(tOut: number, tMax: number, eer35: number): number {
  const carnot = (te: number, tc: number) => te / Math.max(1, tc - te);
  const eta = eer35 / carnot(26 - EVAP_DT + K, 35 + COND_DT + K);
  const eer = eta * carnot(tMax - EVAP_DT + K, tOut + COND_DT + K);
  return Math.min(EER_MAX, Math.max(EER_MIN, eer));
}

/** Converte un carico orario in consumo, con potenza limitata: il carico oltre la potenza non viene fornito. */
export function coolingFromLoad(qCool: number[], perf: (h: number) => { eer: number; capW: number; extrapolated?: boolean }, generator: string): CoolingResult {
  const elec = new Array<number>(HOURS).fill(0);
  let e = 0;
  let delivered = 0;
  let undelivered = 0;
  let undersized = 0;
  let extrapolated = 0;
  for (let h = 0; h < HOURS; h++) {
    const q = qCool[h];
    if (!(q > 0)) continue;
    const p = perf(h);
    let d = q;
    if (q > p.capW * 1.0001) {
      undersized++;
      undelivered += q - Math.max(0, p.capW);
      d = Math.max(0, p.capW);
    }
    if (d <= 0) continue;
    if (p.extrapolated) extrapolated++;
    elec[h] = d / p.eer;
    e += elec[h];
    delivered += d;
  }
  return {
    elec,
    elec_kWh: e / 1000,
    delivered_kWh: delivered / 1000,
    seasonalEer: e > 0 ? delivered / e : NaN,
    hoursUndersized: undersized,
    undelivered_kWh: undelivered / 1000,
    hoursExtrapolated: extrapolated,
    generator,
  };
}

/** Split esistenti: EER orario dalla temperatura esterna e dall'obiettivo dell'ora, potenza totale dichiarata. */
export function simulateSplit(qCool: number[], tMax: number[], climate: ClimatePackage, c: CoolingInput): CoolingResult {
  const capW = c.splitCapacity.value * 1000;
  return coolingFromLoad(
    qCool,
    (h) => ({ eer: splitEer(climate.series.tAir[h], Number.isFinite(tMax[h]) ? tMax[h] : c.setpoint.value, c.splitEer35.value), capW }),
    `Split, EER ${it1(c.splitEer35.value)} a 35 °C (modello parametrico)`,
  );
}
