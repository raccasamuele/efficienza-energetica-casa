import { HOURS, MONTH_DAYS, localDay, localHour, type ClimatePackage } from "./climate";
import { packagePv, pvProduction, residualDemand, seasonalDemand, seasonalTable } from "./electric";
import { batteryParams, simulateBattery } from "./battery";
import type { PackageResult } from "./scenarios";
import { ENGINE_VERSION, type MeasuredCurve, type ProjectInput } from "./types";

/**
 * Esportazione dei prelievi orari nel formato `curva-consumi` del simulatore CER (cersim): versione 2 senza batteria,
 * identica a prima; versione 3 con la batteria, che aggiunge `batteria_kwh`.
 * Specifica: documento del formato `curva-consumi` nel simulatore CER (docs/formato_curva_consumi.md).
 */
export interface ConsumptionCurveFile {
  formato: "curva-consumi";
  versione: 2 | 3;
  natura: "calcolato";
  unita: "kWh";
  fonte: "simulatore-casa";
  motore: string;
  descrizione: string;
  /** kWp di FV già tolti dai prelievi (0 senza FV): la CER avvisa di non reinserire lo stesso impianto. */
  fv_sottratto_kwp: number;
  /** Solo versione 3: capacità utile della batteria già considerata nei prelievi, kWh. */
  batteria_kwh?: number;
  kwh_annui: number;
  ore: number[];
}

export const CURVE_CELLS = 864;
const CALENDAR_YEAR = 2025; // calendario sintetico del TMY (vedi climate.ts)
const MAX_DESCRIPTION = 200;
// caratteri che cersim toglie da motore e descrizione: controllo e segni di Markdown o HTML
const FORBIDDEN = /[\x00-\x1f\x7f`*_[\]<>#|~!\\]/g;
// festività delle fasce ARERA (mese-giorno), Pasquetta a parte
const HOLIDAYS = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "11-01", "12-08", "12-25", "12-26"];

/** Pasquetta (mese-giorno) con l'algoritmo gregoriano anonimo. */
export function easterMonday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  easter.setUTCDate(easter.getUTCDate() + 1);
  return easter.toISOString().slice(5, 10);
}

/** Tipo di giorno come nelle fasce ARERA: 0 feriale, 1 sabato, 2 festivo. Il mese va da 1 a 12. */
export function dayType(year: number, month: number, day: number): number {
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || HOLIDAYS.includes(md) || md === easterMonday(year)) return 2;
  return weekday === 6 ? 1 : 0;
}

/** Indice della cella (tipo di giorno, mese, ora civile) dell'ora UTC h del calendario sintetico. */
export function curveCell(h: number): number {
  let month = 0;
  let rest = localDay(h);
  while (rest >= MONTH_DAYS[month]) rest -= MONTH_DAYS[month++];
  return (dayType(CALENDAR_YEAR, month + 1, rest + 1) * 12 + month) * 24 + localHour(h);
}

/** Con il FV esistente e «dalla curva del contatore»: i consumi si ricostruiscono da prelievi e immissioni. */
export function fromMeter(p: ProjectInput): boolean {
  return !!p.existingPv?.present && p.existingPv.consumptionFrom === "contatore";
}

/**
 * La curva decide le ore degli altri usi: senza FV esistente, oppure con il FV esistente quando ci sono anche le
 * immissioni. Con il FV e i soli prelievi la curva non è la forma dei consumi e non si usa.
 */
export function usesMeasuredCurve(p: ProjectInput): boolean {
  const c = p.consumption.measuredCurve;
  return !!c && (!p.existingPv?.present || (fromMeter(p) && !!c.immissioni));
}

const pvCellCache = new WeakMap<number[], number[]>();

/** Produzione oraria (W) ridotta a kWh medi per cella, sul calendario sintetico. */
function pvCells(pv_W: number[]): number[] {
  const hit = pvCellCache.get(pv_W);
  if (hit) return hit;
  const sum = new Array<number>(CURVE_CELLS).fill(0);
  const count = new Array<number>(CURVE_CELLS).fill(0);
  for (let h = 0; h < HOURS; h++) {
    const i = curveCell(h);
    sum[i] += pv_W[h] / 1000;
    count[i] += 1;
  }
  const out = sum.map((s, i) => (count[i] ? s / count[i] : 0));
  pvCellCache.set(pv_W, out);
  return out;
}

/**
 * Consumo della casa per cella: prelievi misurati più l'autoconsumo, cioè la produzione stimata meno le immissioni
 * misurate (mai sotto zero). La media dell'autoconsumo è la media della produzione meno quella delle immissioni:
 * l'unica stima è la produzione, di un anno tipico e non dei giorni misurati.
 */
export function reconstructedOre(c: MeasuredCurve, pv_W: number[]): number[] {
  if (!c.immissioni) return c.ore;
  const pv = pvCells(pv_W);
  const imm = c.immissioni.ore;
  return c.ore.map((v, i) => v + Math.max(0, pv[i] - imm[i]));
}

/** Quota delle immissioni dell'anno che supera la produzione stimata: se è grande, i dati dell'impianto non tornano. */
export function exportBeyondPv(c: MeasuredCurve, pv_W: number[]): number {
  if (!c.immissioni) return 0;
  const pv = pvCells(pv_W);
  const imm = c.immissioni.ore;
  let beyond = 0;
  let total = 0;
  for (let h = 0; h < HOURS; h++) {
    const i = curveCell(h);
    beyond += Math.max(0, imm[i] - pv[i]);
    total += imm[i];
  }
  return total > 0 ? beyond / total : 0;
}

/**
 * Gli altri usi elettrici in W: la forma della curva misurata se si usa, altrimenti il profilo sintetico; sempre con
 * il totale annuo del progetto, o con quello indicato. A scelta, senza misura usa le medie ARERA stagionali.
 * Con il FV esistente e le immissioni la forma è quella
 * ricostruita, che dipende dalla produzione: serve il clima.
 */
export function otherUsesDemand(p: ProjectInput, annualKwh = p.consumption.electricityKwh.value, climate?: ClimatePackage): number[] {
  const { profile } = p.consumption;
  const c = p.consumption.measuredCurve;
  if (p.consumption.profileMode === "stagionale" && (!c || !usesMeasuredCurve(p))) return seasonalDemand(annualKwh, profile, seasonalTable(p), curveCell);
  if (!c || !usesMeasuredCurve(p)) return residualDemand(annualKwh, profile);
  let ore = c.ore;
  if (p.existingPv?.present) {
    if (!climate) throw new Error("Consumi ricostruiti dal contatore: serve il clima per la produzione del FV esistente.");
    ore = reconstructedOre(c, packagePv(climate, p, false)!);
  }
  const w = new Array<number>(HOURS);
  let sum = 0;
  for (let h = 0; h < HOURS; h++) sum += w[h] = ore[curveCell(h)];
  const k = (annualKwh * 1000) / sum;
  return w.map((x) => x * k);
}

/** Prelievi orari dalla rete del pacchetto, in W (Wh per ora), come nel bilancio di scenarios.ts (raffrescamento e batteria compresi). */
export function gridImportSeries(p: ProjectInput, climate: ClimatePackage, r: PackageResult): number[] {
  const residual = otherUsesDemand(p, r.otherUses_kWh, climate);
  const pv = p.existingPv.present ? packagePv(climate, p, false) : r.has.P ? pvProduction(climate, p.pv.plane, r.pvKwp, p.pv.lossPct.value) : null;
  let demand = residual.map((x, h) => x + (r.hp ? r.hp.elec[h] : 0) + (r.cooling ? r.cooling.elec[h] : 0) + (r.dhw ? r.dhw.result.elec[h] : 0));
  if (r.cooking) demand = demand.map((x, h) => x + r.cooking!.elec[h]);
  if (r.battery && pv) return simulateBattery(demand, pv, { ...batteryParams(p), capacity_kWh: r.battery.capacity_kWh }, { hourly: true }).hourly!.import;
  const out = new Array<number>(HOURS);
  for (let h = 0; h < HOURS; h++) out[h] = Math.max(demand[h] - (pv ? pv[h] : 0), 0);
  return out;
}

/** Forma media su 864 celle e consumo annuo da una serie oraria in W sul calendario sintetico. */
export function consumptionCurve(series_W: number[], descrizione: string, pvKwp = 0, batteryKwh = 0): ConsumptionCurveFile {
  if (series_W.length !== HOURS) throw new Error(`Servono ${HOURS} ore, non ${series_W.length}.`);
  const sum = new Array<number>(CURVE_CELLS).fill(0);
  const count = new Array<number>(CURVE_CELLS).fill(0);
  let total = 0;
  for (let h = 0; h < HOURS; h++) {
    const v = series_W[h];
    if (!Number.isFinite(v) || v < 0) throw new Error(`Prelievo non valido all'ora ${h}.`);
    const i = curveCell(h);
    sum[i] += v / 1000;
    count[i] += 1;
    total += v / 1000;
  }
  if (count.some((n) => n === 0)) throw new Error("Calendario incompleto: una cella della curva è vuota.");
  if (!(total > 0)) throw new Error("Nessun prelievo dalla rete nell'anno: la curva sarebbe tutta a zero.");
  return {
    formato: "curva-consumi",
    versione: batteryKwh > 0 ? 3 : 2,
    natura: "calcolato",
    unita: "kWh",
    fonte: "simulatore-casa",
    motore: `casa-1R1C ${ENGINE_VERSION}`,
    descrizione: descrizione.replace(FORBIDDEN, "").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION),
    fv_sottratto_kwp: pvKwp,
    ...(batteryKwh > 0 ? { batteria_kwh: batteryKwh } : {}),
    kwh_annui: Math.round(total * 10) / 10,
    ore: sum.map((s, i) => Math.round((s / count[i]) * 1e5) / 1e5),
  };
}

/** Descrizione leggibile nella CER: casa, pacchetto, PDC e FV. */
export function curveDescription(p: ProjectInput, r: PackageResult): string {
  const parts = [p.name || "Casa", p.location.name, r.label, "prelievi dalla rete"];
  const kwp = curvePvKwp(p, r);
  if (kwp > 0) parts.push(`con FV ${String(kwp).replace(".", ",")} kWp`);
  if (r.battery) parts.push(`batteria ${String(r.battery.capacity_kWh).replace(".", ",")} kWh`);
  return parts.filter(Boolean).join(", ");
}

/** File `curva-consumi` dei prelievi dalla rete di un pacchetto valido. */
export function exportConsumptionCurve(p: ProjectInput, climate: ClimatePackage, r: PackageResult): ConsumptionCurveFile {
  if (!r.valid) throw new Error(`${r.label}: pacchetto bloccato, nessuna curva da esportare.`);
  return consumptionCurve(gridImportSeries(p, climate, r), curveDescription(p, r), curvePvKwp(p, r), r.battery ? r.battery.capacity_kWh : 0);
}

/** kWp di FV già tolti dai prelievi del pacchetto: l'impianto esistente o quello nuovo. */
export function curvePvKwp(p: ProjectInput, r: PackageResult): number {
  if (p.existingPv.present) return p.existingPv.kWp.value;
  return r.has.P ? r.pvKwp : 0;
}
