import { batteryLife, batteryParams, batteryYears, simulateBattery } from "./battery";
import { batteryEstimate, batteryFixedCost, batteryReplacementEstimate, pvEstimate } from "./costs";
import type { PackageId, ProjectInput } from "./types";

/**
 * Taglia indicativa di FV e batteria, senza preventivo, sui consumi orari del pacchetto.
 * - Scelta economica (la proposta): la combinazione kWp × kWh con il VAN complessivo più alto rispetto alla situazione
 *   di riferimento del pacchetto, batteria assente compresa; se tutte hanno VAN negativo, conviene non fare nulla.
 * - Alternativa per autonomia: il gomito della curva dell'autosufficienza, prima i kWp e poi la batteria su quei kWp,
 *   con il costo in più e il VAN in meno rispetto alla scelta economica.
 * Il gomito dipende dagli estremi della curva: si fissano sui consumi del pacchetto, non sul tetto. Il FV si prova fino a
 * produrre il doppio dei consumi annui, la batteria fino al doppio del consumo di un giorno medio (entrambi al massimo
 * 20); poi il tetto limita i kWp.
 * Il valore di ogni taglia è il VAN dei soli flussi del componente nel pacchetto, con i costi stimati di costs.ts,
 * calcolato solo per le taglie che stanno sul tetto.
 */
export const KWP_MIN = 1;
export const KWP_STEP = 0.5;
export const KWP_MAX = 20;
export const CAPACITY_STEP = 2.5;
export const CAPACITY_MAX = 20;
/** Estremo della curva: produzione (FV) o capacità (batteria) pari a questo multiplo dei consumi annui o del giorno medio. */
export const CURVE_MULTIPLE = 2;

export interface SizingPoint {
  size: number; // kWp o kWh
  selfSufficiencyPct: number; // primo anno
  selfConsumptionPct: number;
  cycles: number; // cicli all'anno della batteria, 0 per il FV
  value: number | null; // VAN del componente con il prezzo tipico; null se la taglia non sta sul tetto
  valueAtZeroCost: number | null; // VAN senza il costo del componente (né investimento né sostituzioni a prezzo tipico)
}

/** Una combinazione della ricerca congiunta: VAN complessivo di FV e batteria rispetto al pacchetto senza di essi. */
export interface SizingCombo {
  kWp: number;
  capacity: number;
  npv: number;
  selfSufficiencyPct: number;
}

export interface PackageSizing {
  id: PackageId;
  maxKwp: number;
  curveMaxKwp: number; // estremo della curva del FV, dai consumi
  curveMaxCapacity: number; // estremo della curva della batteria, dai consumi
  pv: SizingPoint[]; // FV senza batteria, fino al più grande fra estremo della curva e tetto; vuoto con il FV esistente
  battery: SizingPoint[]; // batteria sui kWp dell'alternativa per autonomia
  kneeKwp: number | null; // gomito del FV, anche oltre il tetto
  combos: SizingCombo[]; // ricerca congiunta
  economic: SizingCombo; // VAN più alto: la proposta
  energetic: SizingCombo; // gomito: l'alternativa per autonomia
  allNegative: boolean; // tutte le combinazioni hanno VAN negativo: conviene non fare nulla
  breakEvenPerKwp: number | null; // €/kWp a cui il FV del gomito ha VAN zero
  breakEvenPerKwh: number | null; // €/kWh (parte per kWh) a cui la batteria del gomito ha VAN zero, con parte fissa e sostituzioni stimate
  chosen: { kWp: number; capacity: number }; // usata nel pacchetto: la scelta economica
}

export type Sizes = Map<PackageId, { kWp: number; capacity: number }>;

/** Indice del gomito: il punto più lontano dalla retta fra il primo e l'ultimo, con le due scale normalizzate. */
export function kneeIndex(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const dx = xs[n - 1] - xs[0];
  const dy = ys[n - 1] - ys[0];
  if (dx === 0 || dy === 0) return 0;
  let best = 0;
  let far = 0;
  for (let i = 1; i < n - 1; i++) {
    const d = (ys[i] - ys[0]) / dy - (xs[i] - xs[0]) / dx;
    if (d > far + 1e-9) ((far = d), (best = i));
  }
  return best;
}

/** kWp che stanno sul tetto, a passi di 0,5, al massimo 20. */
export function maxKwpForRoof(p: ProjectInput): number {
  const raw = p.pv.roofArea.value / p.pv.areaPerKwp.value;
  return Math.min(KWP_MAX, Math.floor(raw / KWP_STEP + 1e-9) * KWP_STEP);
}

export function sizesOf(ev: { sizing: PackageSizing[] | null }): Sizes | undefined {
  return ev.sizing ? new Map(ev.sizing.map((s) => [s.id, s.chosen])) : undefined;
}

interface Economy {
  elecPrice: number;
  exportPrice: number;
  rate: number;
  horizon: number;
}

const disc = (rate: number, t: number) => 1 / (1 + rate) ** t;
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

/** Prelievi e immissioni di ogni anno senza batteria, con il degrado del FV; `scale` moltiplica la produzione. */
function plainYears(demand: number[], pv: number[] | null, degradationPct: number, years: number, scale = 1) {
  const out = { import_kWh: new Array<number>(years), export_kWh: new Array<number>(years) };
  for (let t = 1; t <= years; t++) {
    const f = scale * (1 - Math.max(0, degradationPct) / 100) ** (t - 1);
    let im = 0;
    let ex = 0;
    for (let h = 0; h < demand.length; h++) {
      const net = demand[h] - (pv ? pv[h] * f : 0);
      if (net > 0) im += net;
      else ex -= net;
    }
    out.import_kWh[t - 1] = im / 1000;
    out.export_kWh[t - 1] = ex / 1000;
  }
  return out;
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const upToStep = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;

/** Estremo della curva del FV: i kWp che producono il doppio dei consumi annui, almeno tre punti, al massimo 20. */
export function curveMaxKwp(demand: number[], pvPerKwp: number[]): number {
  const yieldKwh = sum(pvPerKwp);
  if (!(yieldKwh > 0)) return KWP_MAX;
  return Math.min(KWP_MAX, Math.max(KWP_MIN + 2 * KWP_STEP, upToStep((CURVE_MULTIPLE * sum(demand)) / yieldKwh, KWP_STEP)));
}

/** Estremo della curva della batteria: il doppio del consumo di un giorno medio, almeno tre punti, al massimo 20 kWh. */
export function curveMaxCapacity(demand: number[]): number {
  return Math.min(CAPACITY_MAX, Math.max(2 * CAPACITY_STEP, upToStep((CURVE_MULTIPLE * sum(demand)) / 1000 / (demand.length / 24), CAPACITY_STEP)));
}

function sweepPv(demand: number[], pvPerKwp: number[], p: ProjectInput, maxKwp: number, upTo: number, e: Economy): SizingPoint[] {
  const out: SizingPoint[] = [];
  const noPv = plainYears(demand, null, 0, e.horizon);
  const replacements = p.pv.replacements.reduce((s, r) => s + r.amount.value * disc(e.rate, r.year), 0);
  for (let k = KWP_MIN; k <= Math.max(upTo, maxKwp) + 1e-9; k += KWP_STEP) {
    const first = plainYears(demand, pvPerKwp, 0, 1, k);
    const pvKwh = (sum(pvPerKwp) * k) / 1000;
    let v: number | null = null;
    if (k <= maxKwp + 1e-9) {
      const y = plainYears(demand, pvPerKwp, p.pv.degradationPct.value, e.horizon, k);
      v = -replacements;
      for (let t = 1; t <= e.horizon; t++) v += disc(e.rate, t) * ((noPv.import_kWh[t - 1] - y.import_kWh[t - 1]) * e.elecPrice + y.export_kWh[t - 1] * e.exportPrice - p.pv.maintenanceDelta.value);
    }
    const demandKwh = noPv.import_kWh[0];
    out.push({ size: k, selfSufficiencyPct: pct(demandKwh - first.import_kWh[0], demandKwh), selfConsumptionPct: pct(pvKwh - first.export_kWh[0], pvKwh), cycles: 0, value: v === null ? null : v - pvEstimate(p, k), valueAtZeroCost: v });
  }
  return out;
}

/** Valore attuale delle sostituzioni della batteria, con il costo di sostituzione proprio (non quello iniziale). */
function replacementsPv(p: ProjectInput, capacity: number, years: number[], rate: number): number {
  return years.reduce((s, y) => s + batteryReplacementEstimate(p, capacity) * disc(rate, y), 0);
}

/**
 * Batteria da 0 all'estremo della curva sullo stesso FV (`pv` × `scale`). Il valore è quello della sola batteria:
 * flussi rispetto allo stesso FV senza accumulo, meno costo stimato e sostituzioni a fine vita operativa.
 */
function sweepBattery(demand: number[], pv: number[], scale: number, p: ProjectInput, pvDegradationPct: number, upTo: number, e: Economy): SizingPoint[] {
  const plain = plainYears(demand, pv, pvDegradationPct, e.horizon, scale);
  const demandKwh = sum(demand) / 1000;
  const pvKwh = (sum(pv) * scale) / 1000;
  const out: SizingPoint[] = [{ size: 0, selfSufficiencyPct: pct(demandKwh - plain.import_kWh[0], demandKwh), selfConsumptionPct: pct(pvKwh - plain.export_kWh[0], pvKwh), cycles: 0, value: 0, valueAtZeroCost: 0 }];
  const b = p.battery;
  for (let c = CAPACITY_STEP; c <= upTo + 1e-9; c += CAPACITY_STEP) {
    const params = { ...batteryParams(p), capacity_kWh: c };
    const year1 = simulateBattery(demand, pv, params, scale === 1 ? {} : { pvScale: scale }).balance;
    const life = batteryLife(b.lifeYears.value, b.lifeCycles.value, year1.cycles, e.horizon);
    const y = batteryYears(demand, pv, params, b.fadePctPerYear.value, life.replacementYears, pvDegradationPct, e.horizon, scale);
    let v = 0;
    for (let t = 1; t <= e.horizon; t++)
      v += disc(e.rate, t) * ((plain.import_kWh[t - 1] - y.import_kWh[t - 1]) * e.elecPrice - (plain.export_kWh[t - 1] - y.export_kWh[t - 1]) * e.exportPrice - b.maintenanceDelta.value);
    out.push({
      size: c,
      selfSufficiencyPct: pct(year1.demand_kWh - year1.import_kWh, year1.demand_kWh),
      selfConsumptionPct: pct(year1.pv_kWh - year1.export_kWh, year1.pv_kWh),
      cycles: year1.cycles,
      value: v - batteryEstimate(p, c) - replacementsPv(p, c, life.replacementYears, e.rate),
      valueAtZeroCost: v,
    });
  }
  return out;
}

const knee = (points: SizingPoint[], upTo: number) => {
  const curve = points.filter((x) => x.size <= upTo + 1e-9);
  return curve.length ? curve[kneeIndex(curve.map((x) => x.size), curve.map((x) => x.selfSufficiencyPct))].size : null;
};

/**
 * Taglie di un pacchetto, dai suoi consumi orari. `pvPerKwp` è la produzione di 1 kWp nuovo; con il FV esistente
 * `existingPv` è la sua produzione, i kWp restano quelli e si cerca solo l'accumulo.
 */
export function sizePackage(id: PackageId, demand: number[], pvPerKwp: number[], existingPv: number[] | null, p: ProjectInput, withBattery: boolean): PackageSizing {
  const e: Economy = { elecPrice: p.tariffs.elecPrice.value, exportPrice: p.tariffs.exportPrice.value, rate: p.economics.realDiscountRate.value, horizon: Math.max(1, Math.round(p.economics.horizonYears.value)) };
  const maxKwp = existingPv ? 0 : maxKwpForRoof(p);
  const upToKwp = curveMaxKwp(demand, pvPerKwp);
  const upToCapacity = curveMaxCapacity(demand);
  const degradation = existingPv ? 0 : p.pv.degradationPct.value;
  const pv = existingPv ? [] : sweepPv(demand, pvPerKwp, p, maxKwp, upToKwp, e);
  const kneeKwp = knee(pv, upToKwp);

  // ricerca congiunta: ogni kWp che sta sul tetto con ogni capacità (0 compresa); con il FV esistente solo l'accumulo
  const kWps = existingPv ? [p.existingPv.kWp.value] : pv.filter((x) => x.value !== null).map((x) => x.size);
  const sweeps = new Map<number, SizingPoint[]>();
  const combos: SizingCombo[] = [];
  for (const k of kWps) {
    const pvPoint = pv.find((x) => x.size === k);
    const pvValue = existingPv ? 0 : pvPoint!.value!;
    const bat = withBattery ? sweepBattery(demand, existingPv ?? pvPerKwp, existingPv ? 1 : k, p, degradation, upToCapacity, e) : [];
    sweeps.set(k, bat);
    combos.push({ kWp: k, capacity: 0, npv: pvValue, selfSufficiencyPct: existingPv ? bat[0]?.selfSufficiencyPct ?? 0 : pvPoint!.selfSufficiencyPct });
    for (const b of bat) if (b.size > 0) combos.push({ kWp: k, capacity: b.size, npv: pvValue + b.value!, selfSufficiencyPct: b.selfSufficiencyPct });
  }
  const economic = combos.reduce((a, x) => (x.npv > a.npv + 1e-9 ? x : a));

  // alternativa energetica: gomito del FV (limitato dal tetto), poi gomito della batteria su quei kWp
  const kE = existingPv ? p.existingPv.kWp.value : Math.min(kneeKwp ?? KWP_MIN, maxKwp);
  const battery = sweeps.get(kE) ?? [];
  const cE = withBattery ? knee(battery, upToCapacity) ?? 0 : 0;
  const energetic = combos.find((x) => x.kWp === kE && x.capacity === cE) ?? economic;

  const atKnee = existingPv ? undefined : pv.find((x) => x.size === kE);
  let breakEvenPerKwh: number | null = null;
  if (cE > 0) {
    const point = battery.find((x) => x.size === cE)!;
    const life = batteryLife(p.battery.lifeYears.value, p.battery.lifeCycles.value, point.cycles, e.horizon);
    breakEvenPerKwh = Math.max(0, ((point.valueAtZeroCost ?? 0) - batteryFixedCost(p) - replacementsPv(p, cE, life.replacementYears, e.rate)) / cE);
  }
  return {
    id,
    maxKwp,
    curveMaxKwp: upToKwp,
    curveMaxCapacity: upToCapacity,
    pv,
    battery,
    kneeKwp,
    combos,
    economic,
    energetic,
    allNegative: economic.npv < 0,
    breakEvenPerKwp: atKnee?.valueAtZeroCost != null ? Math.max(0, atKnee.valueAtZeroCost / atKnee.size) : null,
    breakEvenPerKwh,
    chosen: { kWp: economic.kWp, capacity: economic.capacity },
  };
}
