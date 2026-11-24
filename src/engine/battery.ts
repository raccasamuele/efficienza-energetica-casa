import type { Balance } from "./electric";
import type { ProjectInput } from "./types";

/**
 * Batteria domestica, passo orario, lato in corrente alternata della casa.
 * Si carica solo dal surplus del FV e si scarica solo verso i consumi: niente rete, orari o previsioni.
 * Dentro l'ora non si vedono picchi e cali, quindi l'autoconsumo può risultare più alto del vero.
 */
export interface BatteryParams {
  capacity_kWh: number; // capacità utile dell'anno, già ridotta dal calo
  power_kW: number; // potenza massima, uguale in carica e in scarica
  roundTripPct: number; // rendimento di andata e ritorno, diviso in parti uguali fra carica e scarica
  reservePct: number; // carica minima, % della capacità utile
}

export interface BatteryBalance extends Balance {
  direct_kWh: number; // produzione usata subito in casa
  charge_kWh: number; // energia entrata nella batteria, lato casa
  discharge_kWh: number; // energia uscita dalla batteria verso la casa
  losses_kWh: number;
  socStart_kWh: number;
  socEnd_kWh: number;
  capacity_kWh: number;
  cycles: number; // cicli equivalenti: energia scaricata / capacità utile
}

export interface BatteryHourly {
  direct: number[];
  charge: number[];
  discharge: number[];
  export: number[];
  import: number[];
  soc: number[]; // Wh a fine ora
}

/**
 * Un anno ora per ora. Con `warmup` si simula prima l'anno una volta e si parte dalla carica del 31 dicembre;
 * con `start` (Wh) si parte da una carica data, per esempio quella di fine dell'anno prima.
 */
export function simulateBattery(demand: number[], pv: number[], b: BatteryParams, opts: { warmup?: boolean; hourly?: boolean; start?: number; pvScale?: number } = {}): { balance: BatteryBalance; hourly?: BatteryHourly } {
  const scale = opts.pvScale;
  const n = demand.length;
  const cap = b.capacity_kWh * 1000;
  const floor = (cap * b.reservePct) / 100;
  const pMax = b.power_kW * 1000;
  const eta = Math.sqrt(b.roundTripPct / 100);
  const keep = !!opts.hourly;
  const run = (start: number, record: boolean) => {
    let soc = start;
    let d = 0, p = 0, s = 0, im = 0, ex = 0, peak = 0, dir = 0, ch = 0, dis = 0;
    const h_ = record ? { direct: new Array<number>(n), charge: new Array<number>(n), discharge: new Array<number>(n), export: new Array<number>(n), import: new Array<number>(n), soc: new Array<number>(n) } : null;
    for (let h = 0; h < n; h++) {
      const dh = demand[h];
      // con pvScale la produzione si scala qui, senza copiare la serie (la ricerca delle taglie ne prova molte)
      const ph = pv ? (scale === undefined ? pv[h] : pv[h] * scale) : 0;
      const direct = Math.min(dh, ph);
      const surplus = ph - direct;
      const deficit = dh - direct;
      let charge = 0;
      let discharge = 0;
      if (surplus > 0 && cap > 0) {
        charge = Math.max(0, Math.min(surplus, pMax, (cap - soc) / eta));
        soc += charge * eta;
      } else if (deficit > 0 && cap > 0) {
        discharge = Math.max(0, Math.min(deficit, pMax, (soc - floor) * eta));
        soc -= discharge / eta;
      }
      const i = deficit - discharge;
      d += dh;
      p += ph;
      s += direct + discharge;
      im += i;
      ex += surplus - charge;
      dir += direct;
      ch += charge;
      dis += discharge;
      if (i > peak) peak = i;
      if (h_) {
        h_.direct[h] = direct;
        h_.charge[h] = charge;
        h_.discharge[h] = discharge;
        h_.export[h] = surplus - charge;
        h_.import[h] = i;
        h_.soc[h] = soc;
      }
    }
    return { soc, d, p, s, im, ex, peak, dir, ch, dis, h_ };
  };
  const start = opts.start !== undefined ? Math.min(cap, Math.max(floor, opts.start)) : opts.warmup === false || cap === 0 ? floor : run(floor, false).soc;
  const r = run(start, keep);
  const balance: BatteryBalance = {
    demand_kWh: r.d / 1000,
    pv_kWh: r.p / 1000,
    self_kWh: r.s / 1000,
    import_kWh: r.im / 1000,
    export_kWh: r.ex / 1000,
    importPeak_W: r.peak,
    direct_kWh: r.dir / 1000,
    charge_kWh: r.ch / 1000,
    discharge_kWh: r.dis / 1000,
    losses_kWh: (r.ch - r.dis - (r.soc - start)) / 1000,
    socStart_kWh: start / 1000,
    socEnd_kWh: r.soc / 1000,
    capacity_kWh: b.capacity_kWh,
    cycles: b.capacity_kWh > 0 ? r.dis / 1000 / b.capacity_kWh : 0,
  };
  return keep && r.h_ ? { balance, hourly: r.h_ } : { balance };
}

/** Capacità utile nell'anno t (da 1): cala ogni anno e torna piena nell'anno di una sostituzione. */
export function batteryCapacityInYear(capacity_kWh: number, fadePct: number, t: number, replacementYears: number[]): number {
  const last = Math.max(1, ...replacementYears.filter((y) => y <= t));
  return capacity_kWh * Math.max(0, 1 - (fadePct / 100) * (t - last));
}

/**
 * Prelievi ed immissioni di ogni anno (kWh), con il calo della capacità, le sostituzioni e il degrado del FV: il
 * bilancio orario si rifà anno per anno, e ogni anno parte dalla carica di fine dell'anno prima.
 */
export function batteryYears(demand: number[], pv: number[], b: BatteryParams, fadePct: number, replacementYears: number[], pvDegradationPct: number, years: number, pvScale = 1): { import_kWh: number[]; export_kWh: number[] } {
  let soc: number | undefined;
  const out = { import_kWh: new Array<number>(years), export_kWh: new Array<number>(years) };
  for (let t = 1; t <= years; t++) {
    const f = (1 - Math.max(0, pvDegradationPct) / 100) ** (t - 1);
    const s = pvScale * f;
    const r = simulateBattery(demand, pv, { ...b, capacity_kWh: batteryCapacityInYear(b.capacity_kWh, fadePct, t, replacementYears) }, { ...(soc === undefined ? {} : { start: soc }), ...(s === 1 ? {} : { pvScale: s }) }).balance;
    soc = r.socEnd_kWh * 1000;
    out.import_kWh[t - 1] = r.import_kWh;
    out.export_kWh[t - 1] = r.export_kWh;
  }
  return out;
}

/** Variazione del flusso di ogni anno rispetto al primo (€), dagli anni di `batteryYears`. */
export function batteryYearlyFlows(demand: number[], pv: number[], b: BatteryParams, fadePct: number, replacementYears: number[], pvDegradationPct: number, years: number, elecPrice: number, exportPrice: number): number[] {
  const y = batteryYears(demand, pv, b, fadePct, replacementYears, pvDegradationPct, years);
  const value = (i: number) => -y.import_kWh[i] * elecPrice + y.export_kWh[i] * exportPrice;
  const first = value(0);
  const flows = new Array<number>(years).fill(0);
  for (let t = 2; t <= years; t++) flows[t - 1] = value(t - 1) - first;
  return flows;
}

/** Anno di fine vita (anni di calendario o cicli, il primo che arriva) e anni entro l'orizzonte in cui sostituirla. */
export function batteryLife(lifeYears: number, lifeCycles: number, cyclesPerYear: number, horizon: number): { endOfLifeYear: number; replacementYears: number[] } {
  const byCycles = cyclesPerYear > 0 ? lifeCycles / cyclesPerYear : Infinity;
  const life = Math.max(1, Math.min(lifeYears, byCycles));
  const out: number[] = [];
  for (let y = life; y < horizon; y += life) out.push(Math.ceil(y));
  return { endOfLifeYear: life, replacementYears: [...new Set(out)].filter((y) => y < horizon) };
}

/** Parametri della batteria del progetto nel primo anno. */
export function batteryParams(p: ProjectInput): BatteryParams {
  const b = p.battery;
  return { capacity_kWh: b.capacityKwh.value, power_kW: b.powerKw.value, roundTripPct: b.roundTripPct.value, reservePct: b.reservePct.value };
}

/**
 * La batteria entra nei pacchetti con la lettera P: con un FV nuovo se l'utente la sceglie, con un FV esistente sempre.
 * Con la taglia indicativa la capacità la sceglie il modello, pacchetto per pacchetto.
 */
export function batteryActive(p: ProjectInput): boolean {
  return (p.existingPv.present || p.battery.enabled) && (p.pv.sizing === "indicativa" || p.battery.capacityKwh.value > 0);
}
