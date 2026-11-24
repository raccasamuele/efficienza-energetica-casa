import { HOURS } from "./climate";
import { CURVE_CELLS, curveCell, dayType } from "./curva";
import type { MeasuredCurve, MeasuredExport, MeasuredYear } from "./types";

/**
 * Consumi misurati: i file del Portale Consumi e di e-distribuzione, ridotti a una forma media.
 * Stessi formati e stesse regole del lettore del simulatore CER (cersim/misure.py e docs/consumi_misurati.md della CER).
 * Il POD, se c'è, non viene letto; della curva restano solo le medie, non le date e le letture puntuali.
 */

const QUARTERS = 96;
const MAX_CHARS = 10_000_000;
export const MIN_DAYS = 28; // meno di quattro settimane non dicono abbastanza sulla forma dei consumi
const CHANGE_HOUR = [8, 9, 10, 11]; // colonne 02:00-02:45: inesistenti a marzo, doppie a ottobre
const COLUMN = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
const DATE_IT = /^(\d{2})\/(\d{2})\/(\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/;
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTHS = Array.from({ length: 12 }, (_, m) => m);
const DAY_HOURS = Array.from({ length: 24 }, (_, h) => h);

type Row = (number | null)[];

export interface MeterReadings {
  days: Map<string, Row[]>; // AAAA-MM-GG → righe del giorno (due a ottobre)
  source: string;
  warnings: string[];
}

const clean = (cell: string) => cell.trim().replace(/^"|"$/g, "").trim();

function parseDay(cell: string): string {
  const c = clean(cell);
  const it = DATE_IT.exec(c);
  const iso = DATE_ISO.exec(c);
  const [y, m, d] = it ? [Number(it[3]), Number(it[2]), Number(it[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
  const real = new Date(Date.UTC(y, m - 1, d));
  if (!y || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) throw new Error(`data non riconosciuta (${c.slice(0, 30)})`);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseValue(cell: string): number | null {
  let c = clean(cell);
  if (!c) return null;
  if (c.includes(",")) c = c.replace(/\./g, "").replace(",", ".");
  const v = Number(c);
  if (!Number.isFinite(v) || v < 0) throw new Error(c);
  return v;
}

function parseRow(cells: string[], day: string, warnings: string[]): Row {
  const out: Row = [];
  for (let i = 0; i < QUARTERS; i++) {
    try {
      out.push(parseValue(cells[i] ?? ""));
    } catch {
      warnings.push(`${day}: valore ignorato (${clean(cells[i]).slice(0, 20)})`);
      out.push(null);
    }
  }
  return out;
}

const lastSunday = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - last.getUTCDay();
};

/** Quarti d'ora veri del giorno in ora civile italiana: 92 l'ultima domenica di marzo, 100 l'ultima di ottobre. */
function realQuarters(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if (m === 3 && d === lastSunday(y, 3)) return QUARTERS - 4;
  if (m === 10 && d === lastSunday(y, 10)) return QUARTERS + 4;
  return QUARTERS;
}

function eDistribuzione(rows: string[][]): MeterReadings {
  const warnings: string[] = [];
  const days = new Map<string, Row[]>();
  let app = false;
  rows.slice(1).forEach((row, i) => {
    if (!row[0]?.trim()) return;
    let day: string;
    try {
      day = parseDay(row[0]);
    } catch (e) {
      throw new Error(`Riga ${i + 2}: ${(e as Error).message}`);
    }
    app ||= clean(row[0]).includes(" ");
    days.set(day, [...(days.get(day) ?? []), parseRow(row.slice(1), day, warnings)]);
  });
  return { days, source: app ? "e-distribuzione, app" : "e-distribuzione, sito", warnings };
}

function portale(rows: string[][], header: string[]): MeterReadings {
  const iDate = header.indexOf("data_lettura");
  const iEa = header.indexOf("ea1");
  if (iEa < 0) throw new Error("Intestazione del Portale Consumi incompleta: manca ea1");
  const iReason = header.indexOf("motivazione");
  const warnings: string[] = [];
  const entries = new Map<string, { replaces: boolean; row: Row }[]>();
  rows.slice(1).forEach((row, i) => {
    if (!row[iDate]?.trim()) return;
    let day: string;
    try {
      day = parseDay(row[iDate]);
    } catch (e) {
      throw new Error(`Riga ${i + 2}: ${(e as Error).message}`);
    }
    const replaces = iReason >= 0 && (row[iReason] ?? "").toLowerCase().includes("sost");
    entries.set(day, [...(entries.get(day) ?? []), { replaces, row: parseRow(row.slice(iEa, iEa + QUARTERS), day, warnings) }]);
  });
  const days = new Map<string, Row[]>();
  for (const [day, list] of entries) {
    const replacing = list.filter((x) => x.replaces);
    if (replacing.length) days.set(day, [replacing[replacing.length - 1].row]); // una lettura che ne corregge un'altra vale da sola
    else if (realQuarters(day) > QUARTERS && list.length === 2) days.set(day, list.map((x) => x.row)); // ottobre su due righe
    else days.set(day, [list[list.length - 1].row]);
  }
  return { days, source: "Portale Consumi", warnings };
}

/** Letture di un file; un errore con un messaggio leggibile se il formato non è riconosciuto. */
export function parseMeterFile(text: string): MeterReadings {
  if (text.length > MAX_CHARS) throw new Error("Il file supera 10 MB: non sembra un file di consumi.");
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.split(";")).filter((r) => r.some((c) => clean(c)));
  if (rows.length < 2) throw new Error("Il file è vuoto o ha solo l'intestazione.");
  const header = rows[0].map((c) => clean(c).toLowerCase());
  if (header[0] === "pod" && header.includes("data_lettura")) return portale(rows, header);
  const columns = header.slice(1, QUARTERS + 1);
  if (header[0] === "giorno" && columns.length === QUARTERS && columns[0] === "00:00-00:15" && columns.every((c) => COLUMN.test(c))) return eDistribuzione(rows);
  throw new Error("Formato non riconosciuto: servono il file letture.csv del Portale Consumi oppure la curva a quarti d'ora di e-distribuzione.");
}

/** Più file dello stesso contatore: un giorno ripetuto vale una volta, quello del file caricato dopo prevale. */
export function mergeReadings(list: MeterReadings[]): MeterReadings {
  const days = new Map<string, Row[]>();
  for (const r of list) for (const [day, rows] of r.days) days.set(day, rows);
  return { days, source: [...new Set(list.map((r) => r.source))].join(", "), warnings: list.flatMap((r) => r.warnings) };
}

/** Le colonne vere del giorno, ogni colonna con la sua riga: l'ora 2 esiste due volte a ottobre e mai a marzo. */
function hourlySamples(day: string, rows: Row[], warnings: string[]): { hour: number; values: (number | null)[] }[] {
  const quarters = realQuarters(day);
  const of = (row: Row, cols: number[]) => cols.map((c) => row[c]);
  const all = Array.from({ length: QUARTERS }, (_, i) => i);
  const groups: (number | null)[][] = Array.from({ length: 24 }, () => []);
  const samples: { hour: number; values: (number | null)[] }[] = [];
  const add = (row: Row, cols: number[]) => cols.forEach((c) => groups[Math.floor(c / 4)].push(row[c]));
  if (quarters === QUARTERS || rows.length > 2) {
    if (rows.length > 1) warnings.push(`${day}: ${rows.length} righe, usata l'ultima`);
    add(rows[rows.length - 1], all);
  } else if (quarters < QUARTERS) {
    add(rows[rows.length - 1], all.filter((c) => !CHANGE_HOUR.includes(c)));
  } else if (rows.length === 1) {
    warnings.push(`${day}: ritorno all'ora solare in una sola riga, un'ora letta una volta`);
    add(rows[0], all);
  } else {
    // ottobre: prima riga in ora legale fino alle 03:00, seconda in ora solare dalle 02:00
    add(rows[0], all.slice(0, 12));
    samples.push({ hour: 2, values: of(rows[1], CHANGE_HOUR) });
    add(rows[1], all.slice(12));
  }
  groups.forEach((values, hour) => {
    if (values.length) samples.push({ hour, values });
  });
  return samples;
}

/** Somme e conteggi per cella dei giorni indicati, con i giorni che hanno almeno un'ora misurata. */
function accumulate(r: MeterReadings, dayList: string[], warnings: string[]) {
  const sum = new Array<number>(CURVE_CELLS).fill(0);
  const count = new Array<number>(CURVE_CELLS).fill(0);
  const days: string[] = [];
  for (const day of dayList) {
    const [y, m, d] = day.split("-").map(Number);
    const type = dayType(y, m, d);
    let measured = false;
    for (const { hour, values } of hourlySamples(day, r.days.get(day)!, warnings)) {
      const known = values.filter((v): v is number => v !== null);
      if (!known.length) continue;
      const i = (type * 12 + (m - 1)) * 24 + hour;
      sum[i] += (known.reduce((a, b) => a + b, 0) * values.length) / known.length; // quarti mancanti: in proporzione
      count[i] += 1;
      measured = true;
    }
    if (measured) days.push(day);
  }
  return { shape: sum.map((s, i) => (count[i] ? s / count[i] : NaN)), days };
}

/** Celle senza misure, con le stesse regole di cersim: tipo di giorno assente dagli altri tipi, mese assente dagli altri mesi. */
function fillShape(shape: number[]): number[] {
  const at = (t: number, m: number, h: number) => (t * 12 + m) * 24 + h;
  const mean = (list: number[]) => {
    const known = list.filter(Number.isFinite);
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : NaN;
  };
  for (let t = 0; t < 3; t++) {
    // nessun giorno di questo tipo: la media degli altri tipi
    if (!MONTHS.some((m) => DAY_HOURS.some((h) => Number.isFinite(shape[at(t, m, h)]))))
      for (const m of MONTHS) for (const h of DAY_HOURS) shape[at(t, m, h)] = mean([0, 1, 2].map((x) => shape[at(x, m, h)]));
    // mese senza misure: la media degli altri mesi alla stessa ora
    for (const h of DAY_HOURS) {
      const byHour = mean(MONTHS.map((m) => shape[at(t, m, h)]));
      for (const m of MONTHS) if (!Number.isFinite(shape[at(t, m, h)])) shape[at(t, m, h)] = byHour;
    }
  }
  const overall = mean(shape);
  return shape.map((v) => Math.round((Number.isFinite(v) ? v : overall) * 1e5) / 1e5);
}

const MIN_YEAR_DAYS = 330; // come la curva completa del simulatore CER
const MAX_YEARS = 10;

/** Lo stesso giorno `months` mesi prima, fermo all'ultimo giorno del mese se quel giorno non c'è. */
function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate());
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

interface Shape {
  ore: number[];
  giorni: number;
  dal: string;
  al: string;
  anni: MeasuredYear[];
}

/**
 * Forma media degli ultimi 12 mesi: kWh medi per tipo di giorno, mese e ora civile. Le celle senza misure prendono
 * lo stesso mese dagli anni precedenti, dal più recente, poi le regole di cersim. Gli anni di misura (12 mesi a
 * ritroso dall'ultimo giorno) con almeno 330 giorni danno ciascuno il suo consumo annuo.
 */
function shapeFromReadings(r: MeterReadings, minDays: number, zeroMessage: string): Shape {
  const warnings = r.warnings;
  const sorted = [...r.days.keys()].sort();
  const last = sorted[sorted.length - 1];
  const windows: string[][] = [];
  for (const day of sorted) {
    let k = 0;
    while (k < MAX_YEARS && day <= monthsBefore(last, 12 * (k + 1))) k++;
    if (k < MAX_YEARS) (windows[k] ??= []).push(day);
  }
  const years = Array.from(windows, (list) => (list ? accumulate(r, list, warnings) : null));
  let main = years[0] ?? { shape: [], days: [] };
  if (main.days.length < minDays) main = accumulate(r, sorted, []); // ultimi 12 mesi troppo corti: tutti i giorni, come prima
  if (main.days.length < minDays) throw new Error(`Servono almeno ${minDays} giorni di misure: il file ne ha ${main.days.length}.`);
  const raw = [...main.shape];
  for (const older of years.slice(1))
    if (older) raw.forEach((v, i) => void (!Number.isFinite(v) && Number.isFinite(older.shape[i]) && (raw[i] = older.shape[i])));
  const ore = fillShape(raw);
  if (!ore.some((v) => v > 0)) throw new Error(zeroMessage);
  const anni: MeasuredYear[] = [];
  years.forEach((y, k) => {
    if (!y || y.days.length < MIN_YEAR_DAYS) return;
    const shape = k === 0 ? ore : fillShape([...y.shape]);
    anni.push({ dal: y.days[0], al: y.days[y.days.length - 1], giorni: y.days.length, kwh: curveAnnualKwh(shape) });
  });
  return { ore, giorni: main.days.length, dal: main.days[0], al: main.days[main.days.length - 1], anni };
}

/** Forma media dei prelievi, con gli anni di misura. */
export function curveFromReadings(r: MeterReadings, minDays = MIN_DAYS): MeasuredCurve {
  const s = shapeFromReadings(r, minDays, "Il file ha tutti i consumi a zero: controlla che sia il contatore giusto.");
  return { ore: s.ore, giorni: s.giorni, dal: s.dal, al: s.al, fonte: r.source.slice(0, 80), anni: s.anni };
}

/** Consumo annuo di una forma media sul calendario sintetico del progetto. */
export function curveAnnualKwh(ore: number[]): number {
  let sum = 0;
  for (let h = 0; h < HOURS; h++) sum += ore[curveCell(h)];
  return Math.round(sum * 10) / 10;
}

/** Curva da uno o più file dello stesso contatore, con gli avvisi di lettura. */
export function curveFromFiles(texts: string[]): { curve: MeasuredCurve; warnings: string[] } {
  const merged = mergeReadings(texts.map(parseMeterFile));
  const curve = curveFromReadings(merged);
  return { curve, warnings: merged.warnings };
}

/** Immissioni in rete da uno o più file dello stesso contatore: stesso formato e stesse regole dei prelievi. */
export function exportFromFiles(texts: string[]): { immissioni: MeasuredExport; warnings: string[] } {
  const merged = mergeReadings(texts.map(parseMeterFile));
  const s = shapeFromReadings(merged, MIN_DAYS, "Il file ha le immissioni tutte a zero: controlla che sia il file delle immissioni del contatore giusto.");
  return { immissioni: { ore: s.ore, giorni: s.giorni, dal: s.dal, al: s.al }, warnings: merged.warnings };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validCells = (ore: unknown) => Array.isArray(ore) && ore.length === CURVE_CELLS && ore.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
const validPeriod = (x: { dal?: unknown; al?: unknown; giorni?: unknown }) =>
  typeof x.dal === "string" && ISO_DAY.test(x.dal) && typeof x.al === "string" && ISO_DAY.test(x.al) && Number.isInteger(x.giorni) && (x.giorni as number) >= 0;

/** Errori di una curva letta da un file di progetto, che è un dato non fidato. */
export function measuredCurveErrors(c: unknown): string[] {
  const o = c as MeasuredCurve | null;
  if (o === null) return [];
  if (!o || typeof o !== "object" || !Array.isArray(o.ore) || o.ore.length !== CURVE_CELLS) return [`Curva misurata: servono ${CURVE_CELLS} valori.`];
  if (o.ore.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return ["Curva misurata: valori negativi o non numerici."];
  if (!o.ore.some((v) => v > 0)) return ["Curva misurata: tutta a zero."];
  const errors: string[] = [];
  const anni = o.anni as unknown;
  if (anni !== undefined && (!Array.isArray(anni) || anni.length > MAX_YEARS || !anni.every((a) => a && typeof a === "object" && validPeriod(a) && typeof a.kwh === "number" && Number.isFinite(a.kwh) && a.kwh >= 0)))
    errors.push("Curva misurata: anni di misura non validi.");
  const imm = o.immissioni as unknown;
  if (imm !== undefined && (!imm || typeof imm !== "object" || !validCells((imm as MeasuredExport).ore) || !validPeriod(imm as MeasuredExport)))
    errors.push(`Immissioni del contatore: servono ${CURVE_CELLS} valori non negativi e il periodo.`);
  return errors;
}
