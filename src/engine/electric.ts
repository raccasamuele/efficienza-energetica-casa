import { HOURS, localHour, type ClimatePackage } from "./climate";
import type { ElectricProfile, ProjectInput, PvPlane } from "./types";
import arera from "./data/profili-arera.json";

type ProfileArea = keyof typeof arera.profiles.fino3;
export type SeasonalTable = readonly (readonly (readonly number[])[])[];
export const ARERA_PROFILE_SOURCE = { source: arera.source, url: arera.url, year: arera.year, licence: arera.licence, date: arera.acquiredAt };

export function profileArea(sigla: string): ProfileArea | undefined {
  return Object.hasOwn(arera.areaBySigla, sigla) ? (arera.areaBySigla as Record<string, ProfileArea>)[sigla] : undefined;
}

/** Classi ARERA 1,5–3 e 3–4,5 kW; oltre 3 kW si usa la seconda, anche per contratti maggiori. */
export function seasonalTable(p: ProjectInput): SeasonalTable {
  return arera.profiles[p.tariffs.contractPower.value <= 3 ? "fino3" : "fino4_5"][profileArea(p.location.sigla) ?? "nord"];
}

/** Profili giornalieri SINTETICI (ora locale 0..23), pesi relativi: non derivano da misure. */
const SHAPES: Record<ElectricProfile, number[]> = {
  diurno: [3, 3, 3, 3, 3, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 5, 5, 4, 4, 3],
  serale: [3, 3, 3, 3, 3, 3, 4, 5, 4, 3, 3, 3, 3, 3, 3, 3, 4, 6, 8, 9, 9, 8, 6, 4],
  distribuito: [4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4],
};

export const PROFILE_LABELS: Record<ElectricProfile, string> = {
  diurno: "Prevalentemente diurno (casa abitata di giorno)",
  serale: "Prevalentemente serale (casa vuota di giorno)",
  distribuito: "Distribuito nella giornata",
};

/** Curva oraria in W con integrale annuo pari a annualKwh. */
export function residualDemand(annualKwh: number, profile: ElectricProfile): number[] {
  const shape = SHAPES[profile];
  const w = new Array<number>(HOURS);
  let sum = 0;
  for (let h = 0; h < HOURS; h++) {
    w[h] = shape[localHour(h)];
    sum += w[h];
  }
  const k = (annualKwh * 1000) / sum; // Wh per unità di peso; passo 1 h → W
  return w.map((x) => x * k);
}

/**
 * Curva ARERA in W, al totale annuo inserito (§18 di CORREZIONE-MOTORE.md).
 * calendar è curveCell delle tariffe: cella (tipo di giorno × 12 + mese) × 24 + ora locale.
 * I dati sono medie regionali 2025, CC BY-SA 4.0; fonte e acquisizione in ARERA_PROFILE_SOURCE.
 */
export function seasonalDemand(annualKwh: number, profile: ElectricProfile, table: SeasonalTable, calendar: (h: number) => number): number[] {
  const w = new Array<number>(HOURS);
  let sum = 0;
  for (let h = 0; h < HOURS; h++) {
    const cell = calendar(h);
    const hour = cell % 24, month = Math.floor(cell / 24) % 12, day = Math.floor(cell / 288);
    w[h] = table[month][day][hour] * SHAPES[profile][hour] / SHAPES.distribuito[hour];
    sum += w[h];
  }
  const k = (annualKwh * 1000) / sum;
  return w.map((x) => x * k);
}

/** Produzione oraria in W, con ombre e perdite oltre quelle già comprese nel pacchetto climatico. */
export function pvProduction(climate: ClimatePackage, plane: PvPlane, kWp: number, lossPct = 0): number[] {
  const k = kWp * (1 - lossPct / 100);
  return climate.series.pvAc[plane].map((p) => p * k);
}

/**
 * Produzione del pacchetto: il FV già installato, se c'è, in tutti i pacchetti; altrimenti il FV nuovo nei pacchetti
 * con la lettera P.
 */
export function packagePv(climate: ClimatePackage, p: ProjectInput, hasP: boolean): number[] | null {
  const e = p.existingPv;
  if (e.present) return pvProduction(climate, e.plane, e.kWp.value, e.lossPct.value);
  return hasP ? pvProduction(climate, p.pv.plane, p.pv.kWp.value, p.pv.lossPct.value) : null;
}

/** Variazione del flusso di ogni anno rispetto al primo per il degrado dei moduli (€), col bilancio orario rifatto. */
export function pvDegradationFlows(demand: number[], pv: number[], degradationPct: number, years: number, elecPrice: number, exportPrice: number): number[] {
  const flows = new Array<number>(years).fill(0);
  if (!(degradationPct > 0)) return flows;
  const value = (f: number) => {
    let v = 0;
    for (let h = 0; h < HOURS; h++) {
      const net = demand[h] - pv[h] * f;
      v += net > 0 ? -net * elecPrice : -net * exportPrice;
    }
    return v / 1000;
  };
  const first = value(1);
  for (let t = 1; t < years; t++) flows[t] = value((1 - degradationPct / 100) ** t) - first;
  return flows;
}

export interface Balance {
  demand_kWh: number;
  pv_kWh: number;
  self_kWh: number;
  import_kWh: number;
  export_kWh: number;
  importPeak_W: number;
}

/** Bilancio orario: autoconsumo = min(P, D), import = max(D−P, 0), export = max(P−D, 0). */
export function balance(demand: number[], pv: number[] | null): Balance {
  let d = 0;
  let p = 0;
  let s = 0;
  let im = 0;
  let ex = 0;
  let peak = 0;
  for (let h = 0; h < HOURS; h++) {
    const dh = demand[h];
    const ph = pv ? pv[h] : 0;
    d += dh;
    p += ph;
    s += Math.min(dh, ph);
    const i = Math.max(dh - ph, 0);
    im += i;
    ex += Math.max(ph - dh, 0);
    if (i > peak) peak = i;
  }
  return { demand_kWh: d / 1000, pv_kWh: p / 1000, self_kWh: s / 1000, import_kWh: im / 1000, export_kWh: ex / 1000, importPeak_W: peak };
}
