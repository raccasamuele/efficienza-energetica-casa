/**
 * Confronto con EnergyPlus (livello B): lato motore.
 * Legge validazione/energyplus/casi.json, calcola U e capacità con le regole dichiarate, lancia simulateThermal
 * per tutti i casi (clima × sopra × involucro × serramenti × sole) e scrive:
 *   validazione/energyplus/motore.json            risultati del motore (annui e mensili in ora solare locale)
 *   validazione/energyplus/generati/stagione_<clima>.csv   maschera della stagione per EnergyPlus (8760 righe, ora locale)
 * Uso: npx vite-node scripts/validazione/motore.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { HOURS, unpackClimate, type ClimatePackage } from "../../src/engine/climate";
import { exampleProject } from "../../src/engine/example";
import { SEASON_BY_ZONE } from "../../src/engine/location";
import { seasonMask, simulateThermal } from "../../src/engine/thermal";
import type { BuildingInput, Orientation, Q, ServiceInput } from "../../src/engine/types";

const ROOT = resolve(__dirname, "../..");
const DIR = process.env.CASA_VALIDATION_DIR ? resolve(process.env.CASA_VALIDATION_DIR) : resolve(ROOT, "validazione/energyplus");
const casi = JSON.parse(readFileSync(resolve(ROOT, "validazione/energyplus/casi.json"), "utf-8"));
type Strato = { spessore: number; lambda: number; rho: number; c: number };
const MAT: Record<string, Strato> = casi.materiali;

const RSE = 0.04;
/** U secondo UNI EN ISO 6946, strati dall'esterno all'interno. */
export function uValue(strati: string[], rsi: number): number {
  return 1 / (RSE + rsi + strati.reduce((s, k) => s + MAT[k].spessore / MAT[k].lambda, 0));
}
/** Capacità areica interna (J/m²K), regola dei 10 cm; strati dal lato interno verso l'esterno. */
export function kappaInterna(dallInterno: string[]): number {
  let profondita = 0;
  let k = 0;
  for (const id of dallInterno) {
    const m = MAT[id];
    if (m.lambda < 0.1) break;
    const d = Math.min(m.spessore, 0.1 - profondita);
    if (d <= 0) break;
    k += m.rho * m.c * d;
    profondita += d;
  }
  return k;
}

const box = casi.box;
const L: number = box.lato_m;
const Hn: number = box.altezza_netta_m;
const floorArea = L * L;
const win: Record<Orientation, number> = box.finestre_m2;
const ORS: Orientation[] = ["N", "E", "S", "O"];
const wallNet: Record<Orientation, number> = { N: 0, E: 0, S: 0, O: 0 };
for (const o of ORS) wallNet[o] = L * Hn - win[o];

/** Fattore b del sottotetto (UNI EN ISO 13789) e quota delle falde in Hue: Hue di falde, timpani e ricambi; Hiu del solaio. */
function sottotetto(st: { tetto: string[]; timpani: string[]; pendenza_gradi: number; ricambi_h: number }, hIu: number): { b: number; share: number } {
  const rad = (st.pendenza_gradi * Math.PI) / 180;
  const rise = (L / 2) * Math.tan(rad);
  const falde = 2 * L * (L / 2 / Math.cos(rad));
  const timpani = 2 * 0.5 * L * rise;
  const volume = (L * L * rise) / 2;
  const hFalde = uValue(st.tetto, 0.1) * falde;
  const hUe = hFalde + uValue(st.timpani, 0.13) * timpani + (1200 * st.ricambi_h * volume) / 3600;
  return { b: hUe / (hIu + hUe), share: hFalde / hUe };
}

const withV = (q: Q, value: number): Q => ({ ...q, value, status: "misurato", source: "validazione EnergyPlus" });

function loadClimate(id: string, senzaSole: boolean): ClimatePackage {
  const p = unpackClimate(JSON.parse(readFileSync(resolve(ROOT, `public/data/packages/${id}.json`), "utf-8")), { temperatureCorrection: false }) as ClimatePackage;
  if (!senzaSole) return p;
  const zero = new Array<number>(HOURS).fill(0);
  return { ...p, series: { ...p.series, ghi: zero, facade: { N: zero, E: zero, S: zero, O: zero }, ...(p.series.facadeGlazing ? { facadeGlazing: { N: zero, E: zero, S: zero, O: zero } } : {}) } };
}

/** Riga UTC i → indice dell'ora solare locale (UTC+1) i+1. */
const lst = (i: number) => (i + 1) % HOURS;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthOfRecord: number[] = [];
MONTH_DAYS.forEach((d, m) => { for (let k = 0; k < d * 24; k++) monthOfRecord.push(m); });

mkdirSync(resolve(DIR, "generati"), { recursive: true });
const out: unknown[] = [];
const base = exampleProject();
for (const clima of casi.climi) {
  const season = SEASON_BY_ZONE[clima.zona as keyof typeof SEASON_BY_ZONE];
  const service: ServiceInput = {
    ...base.service,
    setpoint: withV(base.service.setpoint, box.setpoint_C),
    internalGains: withV(base.service.internalGains, box.apporti_interni_W_m2),
    seasonStart: season.start,
    seasonEnd: season.end,
  };
  const mask = seasonMask(service);
  const sched = new Array<number>(HOURS).fill(0);
  for (let i = 0; i < HOURS; i++) sched[lst(i)] = mask[i] ? 1 : 0;
  writeFileSync(resolve(DIR, `generati/stagione_${clima.id}.csv`), sched.join("\n") + "\n");

  for (const sopra of casi.sopra.filter((x: { id: string }) => !process.env.CASA010_ATTIC_ONLY || x.id === "sottotetto")) for (const inv of casi.involucri) {
    const uWall = uValue(inv.parete, 0.13);
    // copertura piana e solaio verso il sottotetto: stessi strati; verso il sottotetto Rse = Rsi = 0,10
    const uUpper = sopra.id === "sottotetto" ? 1 / (1 / uValue(inv.copertura, 0.1) - RSE + 0.1) : uValue(inv.copertura, 0.1);
    // capacità: pareti e soffitto dal lato interno (ordine inverso), pavimento dall'alto (ordine dato)
    const kWall = kappaInterna([...inv.parete].reverse());
    const kCeil = kappaInterna(sopra.id === "piano" ? [...inv.pavimento].reverse() : [...inv.copertura].reverse());
    const kFloor = kappaInterna(inv.pavimento);
    const wallTot = ORS.reduce((s, o) => s + wallNet[o], 0);
    const kappa = (kWall * wallTot + kCeil * floorArea + kFloor * floorArea) / floorArea; // J/m²K riferiti al pavimento
    const att = sopra.id === "sottotetto" ? sottotetto(sopra, uUpper * floorArea) : { b: 0, share: 0 };
    const bAttic = att.b;
    const upper = sopra.id === "piana" ? "coperturaPiana" : sopra.id === "sottotetto" ? "sottotetto" : "riscaldato";
    const suffix = sopra.id === "piana" ? "" : `_${sopra.id}`;
    for (const serr of process.env.CASA010_ATTIC_ONLY ? ["oggi"] as const : ["oggi", "nuovi"] as const) {
      const w = inv[`serramenti_${serr}`];
      for (const senzaSole of process.env.CASA010_ATTIC_ONLY ? [false, true] as const : [false, true] as const) {
        const b0 = base.building;
        const b: BuildingInput = {
          ...b0,
          geometryMode: "aree",
          floorArea: withV(b0.floorArea, floorArea),
          floors: withV(b0.floors, 1),
          netStoreyHeight: withV(b0.netStoreyHeight, Hn),
          wallArea: { N: withV(b0.wallArea.N, wallNet.N), E: withV(b0.wallArea.E, wallNet.E), S: withV(b0.wallArea.S, wallNet.S), O: withV(b0.wallArea.O, wallNet.O) },
          adjacentWallArea: withV(b0.adjacentWallArea, 0),
          upperArea: withV(b0.upperArea, floorArea),
          lowerArea: withV(b0.lowerArea, floorArea),
          windowMode: "aree",
          windowArea: { N: withV(b0.windowArea.N, win.N), E: withV(b0.windowArea.E, win.E), S: withV(b0.windowArea.S, win.S), O: withV(b0.windowArea.O, win.O) },
          upper,
          bUpperUnheated: withV(b0.bUpperUnheated, bAttic || b0.bUpperUnheated.value),
          atticRoofShare: withV(b0.atticRoofShare, att.share || b0.atticRoofShare.value),
          unheatedUpper: process.env.CASA010_ATTIC_ONLY ? { ...b0.unheatedUpper, mode: "locale" as const } : b0.unheatedUpper,
          lower: "riscaldato",
          sides: "isolato",
          uWall: withV(b0.uWall, uWall),
          uUpper: withV(b0.uUpper, uUpper),
          uWindow: withV(b0.uWindow, w.U),
          gWindow: withV(b0.gWindow, w.g),
          frameFraction: withV(b0.frameFraction, 0),
          thermalBridgeDeltaU: withV(b0.thermalBridgeDeltaU, 0),
          airChange: withV(b0.airChange, inv.ricambi_h),
          heatCapacityPerArea: withV(b0.heatCapacityPerArea, kappa / 1000),
          shadingFactor: withV(b0.shadingFactor, 1),
        };
        const clim = loadClimate(clima.id, senzaSole);
        const rad = Math.PI / 6;
        const rise = (L / 2) * Math.tan(rad);
        const roofArea = 2 * L * (L / 2 / Math.cos(rad));
        const gableArea = L * rise;
        const volumeU = (L * L * rise) / 2;
        const hue = sopra.id === "sottotetto" ? uValue(sopra.tetto, 0.1) * roofArea + uValue(sopra.timpani, 0.13) * gableArea + (1200 * sopra.ricambi_h * volumeU) / 3600 : 0;
        const floorU = process.env.CASA010_ATTIC_ONLY && sopra.id === casi.interventi_010.isolamento_solaio_sottotetto.sopra ? casi.interventi_010.isolamento_solaio_sottotetto.uFinale_W_m2K : undefined;
        if (process.env.CASA010_ATTIC_ONLY) {
          const areaOut = roofArea + gableArea;
          b.unheatedUpper = { ...b.unheatedUpper, areaOut: withV(b.unheatedUpper.areaOut, areaOut), uOut: withV(b.unheatedUpper.uOut, (hue - 1200 * sopra.ricambi_h * volumeU / 3600) / areaOut), volume: withV(b.unheatedUpper.volume, volumeU), airChange: withV(b.unheatedUpper.airChange, sopra.ricambi_h) };
        }
        const baseline = process.env.CASA010_ATTIC_ONLY ? simulateThermal(b, service, clim) : null;
        const upgrade = floorU === undefined ? undefined : { upper: { uAfter: floorU, share: 1, bridgeAfter: b.thermalBridgeDeltaU.value } };
        const r = simulateThermal(b, service, clim, undefined, upgrade);
        if (!r.ok) throw new Error(`${clima.id} ${sopra.id} ${inv.id} ${serr} ${senzaSole}: ${r.errors.join("; ")}`);
        // per informazione: il valore preimpostato del motore (b = 0,9)
        const hiuToday = (uUpper + b.thermalBridgeDeltaU.value) * floorArea;
        const hiuAfter = ((floorU ?? uUpper) + b.thermalBridgeDeltaU.value) * floorArea;
        const hue0 = hiuAfter * bAttic / (1 - bAttic);
        const bFixed = hue0 / (hiuToday + hue0);
        const r09 = sopra.id === "sottotetto" ? simulateThermal({ ...b, unheatedUpper: { ...b.unheatedUpper, mode: "fattoreB" }, bUpperUnheated: withV(b0.bUpperUnheated, bFixed) }, service, clim, undefined, upgrade) : null;
        const monthly = new Array<number>(12).fill(0);
        for (let i = 0; i < HOURS; i++) monthly[monthOfRecord[lst(i)]] += r.qHeat[i] / 1000;
        out.push({
          ...(process.env.CASA010_ATTIC_ONLY ? { hueScatola_W_K: +hue.toFixed(4), fabbisogno_locale_oggi_kWh: +baseline!.heatNeed_kWh.toFixed(2), fabbisogno_locale_kWh: +r.heatNeed_kWh.toFixed(2) } : {}),
          id: `${clima.id}_${inv.id}_${serr}_${senzaSole ? "senzasole" : "sole"}${suffix}`,
          clima: clima.id, sopra: sopra.id, involucro: inv.id, serramenti: serr, sole: !senzaSole,
          uParete: +uWall.toFixed(4), uSopra: +uUpper.toFixed(4), kappa_kJ_m2K: +(kappa / 1000).toFixed(2),
          ...(bAttic ? { b: +bAttic.toFixed(3), quotaTetto: +att.share.toFixed(3), fabbisogno_b09_kWh: +r09!.heatNeed_kWh.toFixed(2) } : {}),
          H_W_K: +r.envelope.H.toFixed(2),
          fabbisogno_kWh: +r.heatNeed_kWh.toFixed(2),
          mensile_kWh: monthly.map((v) => +v.toFixed(2)),
          picco_W: +r.peak_W.toFixed(0),
        });
      }
    }
  }
}
writeFileSync(resolve(DIR, "motore.json"), JSON.stringify({ generato: "scripts/validazione/motore.ts", casi: out }, null, 1) + "\n");
console.log(`${out.length} casi scritti in validazione/energyplus/motore.json`);
