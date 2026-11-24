import type { Orientation, PvPlane } from "./types";

export const HOURS = 8760;

export interface ClimateManifest {
  schemaVersion: number;
  climateId: string;
  name: string;
  provider: string;
  apiVersion: string;
  radiationDatabase: string;
  meteoDatabase: string;
  sourceWindow: [number, number];
  latitude: number;
  longitude: number;
  elevation_m: number;
  monthsSelected: { month: number; year: number }[];
  acquiredAt: string;
  query: string;
  rawSha256: string;
  irradianceTimeOffset_h: number;
  timeIndex: string;
  transformations: string[];
  software: Record<string, string>;
  attribution: string;
  note: string;
  // schema 2 (capoluoghi)
  sigla?: string;
  coordinateSource?: string;
  zone?: ClimateZone;
  gg?: number;
  altitudeDPR_m?: number;
  designTempEstimate?: number;
  temperatureCorrection?: { method: string; reference: string; rawSha256: string; monthlyOffset_C: number[]; knots_C: number[]; knotHours: number[] };
  scale?: { tAir: number; wind: number; ghi: number; facade: number; facadeGlazing?: number; pvAc: number };
}

export interface ClimatePackage {
  temperatureCorrected?: boolean;
  temperatureOffsets_C?: number[];
  manifest: ClimateManifest;
  degreeDays?: { observed: Record<string, number>; normal: Record<string, number>; tmy: Record<string, number> };
  series: {
    tAir: number[];
    wind: number[];
    ghi: number[];
    facade: Record<Orientation, number[]>;
    facadeGlazing?: Record<Orientation, number[]>;
    pvAc: Record<PvPlane, number[]>;
  };
}

export type ClimateZone = "A" | "B" | "C" | "D" | "E" | "F";

/** Voce dell'indice dei pacchetti clima disponibili (uno per capoluogo). */
export interface ClimateIndexEntry {
  id: string;
  name: string;
  sigla: string;
  lat: number;
  lon: number;
  elevation: number;
  altDPR: number;
  zone: ClimateZone;
  gg: number;
  tMean: number;
  tMin: number;
  tDesign?: number;
  pvS35: number;
}

/** Identificativo di un pacchetto: codice ISTAT a 6 cifre del capoluogo. */
export const isClimateId = (id: unknown): id is string => typeof id === "string" && /^\d{6}$/.test(id);
/** Vecchi identificativi accettati all'import. */
export const CLIMATE_ALIASES: Record<string, string> = { milano: "015146" };

/** Converte pacchetti compatti (schemi 2 e 3, interi con fattore di scala) nei valori fisici. */
export function temperatureOffsetSeries(manifest: ClimateManifest): number[] {
  const correction = manifest.temperatureCorrection;
  if (!correction) return new Array(HOURS).fill(0);
  const x = correction.knotHours, y = correction.knots_C;
  const xx = [x[11] - HOURS, ...x, x[0] + HOURS], yy = [y[11], ...y, y[0]];
  return Array.from({ length: HOURS }, (_, h) => {
    const t = h + 0.5;
    let i = 0; while (i < xx.length - 2 && xx[i + 1] < t) i++;
    return yy[i] + (yy[i + 1] - yy[i]) * (t - xx[i]) / (xx[i + 1] - xx[i]);
  });
}

export function unpackClimate(raw: unknown, options: { temperatureCorrection?: boolean } = {}): unknown {
  const p = raw as ClimatePackage;
  if (!p || typeof p !== "object" || !p.manifest || !p.series || (p.manifest.schemaVersion !== 2 && p.manifest.schemaVersion !== 3) || !p.manifest.scale) return raw;
  const sc = p.manifest.scale;
  const div = (a: unknown, k: number) => (Array.isArray(a) ? a.map((v) => (typeof v === "number" ? v / k : NaN)) : a);
  const s = p.series as unknown as Record<string, unknown>;
  const applyCorrection = options.temperatureCorrection !== false && !!p.manifest.temperatureCorrection;
  const offsets = applyCorrection ? temperatureOffsetSeries(p.manifest) : new Array(HOURS).fill(0);
  const tAir = div(s.tAir, sc.tAir) as number[];
  if (applyCorrection) for (let h = 0; h < tAir.length; h++) tAir[h] += offsets[h];
  const fac = s.facade as Record<string, unknown> | undefined;
  const pv = s.pvAc as Record<string, unknown> | undefined;
  const glazing = s.facadeGlazing as Record<string, unknown> | undefined;
  return {
    manifest: p.manifest,
    temperatureCorrected: applyCorrection,
    temperatureOffsets_C: applyCorrection ? offsets : undefined,
    series: {
      tAir,
      wind: div(s.wind, sc.wind),
      ghi: div(s.ghi, sc.ghi),
      facade: fac && Object.fromEntries(Object.entries(fac).map(([k, v]) => [k, div(v, sc.facade)])),
      ...(glazing ? { facadeGlazing: Object.fromEntries(Object.entries(glazing).map(([k, v]) => [k, div(v, sc.facadeGlazing ?? sc.facade)])) } : {}),
      pvAc: pv && Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, div(v, sc.pvAc)])),
    },
  };
}

function checkSeries(name: string, s: unknown, min: number, max: number): string[] {
  if (!Array.isArray(s)) return [`${name}: serie mancante`];
  if (s.length !== HOURS) return [`${name}: ${s.length} valori invece di ${HOURS}`];
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return [`${name}: valore non finito all'ora ${i}`];
    if (v < min || v > max) return [`${name}: valore ${v} fuori intervallo fisico [${min}, ${max}] all'ora ${i}`];
  }
  return [];
}

/** Controlla forma e intervalli fisici di un pacchetto clima (dato non fidato). */
export function validateClimate(pkg: unknown): string[] {
  const errors: string[] = [];
  const p = pkg as Partial<ClimatePackage> | null;
  if (!p || typeof p !== "object" || !p.manifest || !p.series) return ["pacchetto clima malformato"];
  if (p.manifest.schemaVersion !== 1 && p.manifest.schemaVersion !== 2 && p.manifest.schemaVersion !== 3) errors.push(`schemaVersion clima ${p.manifest.schemaVersion} non supportata`);
  const s = p.series;
  const correction = p.manifest.temperatureCorrection;
  if (correction !== undefined) {
    for (const key of ["monthlyOffset_C", "knots_C"] as const) {
      const values = correction?.[key];
      if (!Array.isArray(values) || values.length !== 12 || values.some((v) => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 20)) errors.push(`manifest.temperatureCorrection.${key}: attesi 12 numeri finiti entro ?20 ?C`);
    }
    if (!Array.isArray(correction.knotHours) || correction.knotHours.length !== 12 || correction.knotHours.some((v) => typeof v !== "number" || !Number.isFinite(v))) errors.push("manifest.temperatureCorrection.knotHours: attese 12 ore finite");
  }
  errors.push(...checkSeries("tAir", s.tAir, -40, 50));
  errors.push(...checkSeries("wind", s.wind, 0, 60));
  errors.push(...checkSeries("ghi", s.ghi, 0, 1400));
  for (const o of ["N", "E", "S", "O"] as Orientation[]) errors.push(...checkSeries(`facade.${o}`, s.facade?.[o], 0, 1400));
  if (s.facadeGlazing) for (const o of ["N", "E", "S", "O"] as Orientation[]) errors.push(...checkSeries(`facadeGlazing.${o}`, s.facadeGlazing[o], 0, 1400));
  for (const k of ["E20", "E35", "S20", "S35", "O20", "O35"] as PvPlane[])
    errors.push(...checkSeries(`pvAc.${k}`, s.pvAc?.[k], 0, 1100));
  return errors;
}

/** Ora UTC 0..8759 → data del calendario sintetico 2025 (non bisestile). */
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isValidDate(month: number, day: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= MONTH_DAYS[month - 1];
}

export function dayOfYear(month: number, day: number): number {
  if (!isValidDate(month, day)) throw new Error(`Data non valida: ${day}/${month}`);
  let d = 0;
  for (let m = 1; m < month; m++) d += MONTH_DAYS[m - 1];
  return d + day - 1;
}

/** Giorno dell'anno 0..364 dentro un periodo di date, anche a cavallo dell'anno (inizio dopo la fine). */
export function inDayPeriod(d: number, start: { month: number; day: number }, end: { month: number; day: number }): boolean {
  const a = dayOfYear(start.month, start.day);
  const b = dayOfYear(end.month, end.day);
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** Ora UTC → ora locale Europe/Rome nel calendario sintetico 2025 (DST 30/3 01:00 UTC – 26/10 01:00 UTC). */
const DST_START = dayOfYear(3, 30) * 24 + 1;
const DST_END = dayOfYear(10, 26) * 24 + 1;
export function utcOffset(h: number): number {
  return h >= DST_START && h < DST_END ? 2 : 1;
}
export function localHour(h: number): number {
  return (h + utcOffset(h)) % 24;
}
/** Giorno locale (0..364) dell'ora UTC h, con passaggio d'anno ciclico del TMY. */
export function localDay(h: number): number {
  return Math.floor((h + utcOffset(h)) / 24) % 365;
}

export function mean(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

/** File dei gradi giorno osservati (`data/gradi-giorno.json`), per capoluogo. */
export interface DegreeDaysFile { cities?: Record<string, NonNullable<ClimatePackage["degreeDays"]>> }

/** Stessa preparazione del pacchetto clima nel sito e negli strumenti per agenti: decompressione, gradi giorno, controlli. */
export function prepareClimate(packed: unknown, degrees: DegreeDaysFile | null, climateId: string): { climate: ClimatePackage; errors: string[] } {
  const climate = unpackClimate(packed) as ClimatePackage;
  const cityDegreeDays = degrees?.cities?.[climateId];
  if (cityDegreeDays) climate.degreeDays = cityDegreeDays;
  return { climate, errors: validateClimate(climate) };
}
