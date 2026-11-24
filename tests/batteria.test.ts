import { describe, expect, it } from "vitest";
import {
  balance,
  evaluate,
  exampleProject,
  otherUsesDemand,
  pvProduction,
  simulateBattery,
  type BatteryParams,
  type Evaluation,
  type PackageId,
  type ProjectInput,
} from "../src/engine";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;
const BAT: BatteryParams = { capacity_kWh: 10, power_kW: 5, roundTripPct: 90, reservePct: 5 };
const yearDemand = () => otherUsesDemand(exampleProject());
const yearPv = () => pvProduction(milano, "S35", 4);

/** Un giorno: consumo costante e sole dalle 9 alle 14 comprese. */
function day(demandW: number, pvW: number) {
  const demand = new Array<number>(24).fill(demandW);
  const pv = new Array<number>(24).fill(0).map((_, h) => (h >= 9 && h <= 14 ? pvW : 0));
  return { demand, pv };
}

function withBattery(p = exampleProject()): ProjectInput {
  p.battery.enabled = true;
  return p;
}

describe("Batteria: bilancio ora per ora", () => {
  const demand = yearDemand();
  const pv = yearPv();
  const r = simulateBattery(demand, pv, BAT, { hourly: true });
  const hr = r.hourly!;

  it("conserva l'energia in ogni ora, dal lato della produzione e da quello dei consumi", () => {
    for (let h = 0; h < demand.length; h++) {
      expect(Math.abs(pv[h] - (hr.direct[h] + hr.charge[h] + hr.export[h]))).toBeLessThan(1e-9 * Math.max(1, pv[h]));
      expect(Math.abs(demand[h] - (hr.direct[h] + hr.discharge[h] + hr.import[h]))).toBeLessThan(1e-9 * Math.max(1, demand[h]));
      for (const x of [hr.direct[h], hr.charge[h], hr.discharge[h], hr.export[h], hr.import[h]]) expect(x).toBeGreaterThanOrEqual(0);
      expect(hr.charge[h] > 0 && hr.discharge[h] > 0).toBe(false);
    }
  });

  it("tiene lo stato di carica fra la riserva e la capacità e rispetta la potenza", () => {
    const min = (BAT.capacity_kWh * 1000 * BAT.reservePct) / 100;
    for (let h = 0; h < demand.length; h++) {
      expect(hr.soc[h]).toBeGreaterThanOrEqual(min - 1e-6);
      expect(hr.soc[h]).toBeLessThanOrEqual(BAT.capacity_kWh * 1000 + 1e-6);
      expect(hr.charge[h]).toBeLessThanOrEqual(BAT.power_kW * 1000 + 1e-9);
      expect(hr.discharge[h]).toBeLessThanOrEqual(BAT.power_kW * 1000 + 1e-9);
    }
  });

  it("perdite = energia caricata − energia scaricata − variazione della carica", () => {
    const b = r.balance;
    expect(b.losses_kWh).toBeCloseTo(b.charge_kWh - b.discharge_kWh - (b.socEnd_kWh - b.socStart_kWh), 9);
    expect(b.losses_kWh).toBeGreaterThan(0);
    // con un anno di preriscaldamento lo stato iniziale è quello di fine anno
    expect(b.socEnd_kWh).toBeCloseTo(b.socStart_kWh, 1);
    expect(b.cycles).toBeCloseTo(b.discharge_kWh / BAT.capacity_kWh, 9);
  });

  it("i totali sono le somme delle ore", () => {
    const sum = (a: number[]) => a.reduce((s, x) => s + x, 0) / 1000;
    const b = r.balance;
    expect(b.import_kWh).toBeCloseTo(sum(hr.import), 6);
    expect(b.export_kWh).toBeCloseTo(sum(hr.export), 6);
    expect(b.charge_kWh).toBeCloseTo(sum(hr.charge), 6);
    expect(b.discharge_kWh).toBeCloseTo(sum(hr.discharge), 6);
    expect(b.self_kWh).toBeCloseTo(sum(hr.direct) + sum(hr.discharge), 6);
    expect(b.self_kWh + b.import_kWh).toBeCloseTo(b.demand_kWh, 6);
  });

  it("non aumenta mai il prelievo né l'immissione rispetto al solo FV", () => {
    for (let h = 0; h < demand.length; h++) {
      expect(hr.import[h]).toBeLessThanOrEqual(Math.max(demand[h] - pv[h], 0) + 1e-9);
      expect(hr.export[h]).toBeLessThanOrEqual(Math.max(pv[h] - demand[h], 0) + 1e-9);
    }
    expect(r.balance.import_kWh).toBeLessThan(balance(demand, pv).import_kWh);
  });

  it("con capacità zero il bilancio è identico a quello senza batteria, numero per numero", () => {
    const zero = simulateBattery(demand, pv, { ...BAT, capacity_kWh: 0 });
    const plain = balance(demand, pv);
    for (const k of Object.keys(plain) as (keyof typeof plain)[]) expect(zero.balance[k]).toBe(plain[k]);
    expect(zero.balance.charge_kWh).toBe(0);
    expect(zero.balance.discharge_kWh).toBe(0);
    expect(zero.balance.losses_kWh).toBe(0);
  });
});

describe("Batteria: giornate calcolate a mano", () => {
  // rendimento 81% = 90% in carica × 90% in scarica
  const hand = (p: Partial<BatteryParams>) => simulateBattery(day(1000, 4000).demand, day(1000, 4000).pv, { capacity_kWh: 10, power_kW: 5, roundTripPct: 81, reservePct: 0, ...p }, { warmup: false, hourly: true });

  it("sole pieno: si riempie a mezzogiorno e si svuota la sera", () => {
    const r = hand({});
    const b = r.balance;
    // surplus 3 kW per sei ore: tre ore intere, poi 1,9 kWh di spazio = 2,111 kWh caricati
    expect(b.charge_kWh).toBeCloseTo(9 + 1.9 / 0.9, 9);
    expect(b.export_kWh).toBeCloseTo(18 - (9 + 1.9 / 0.9), 9);
    // la sera nove ore da 1 kW svuotano esattamente 10 kWh di carica
    expect(b.discharge_kWh).toBeCloseTo(9, 9);
    expect(b.import_kWh).toBeCloseTo(9, 9); // dalle 0 alle 8, batteria vuota
    expect(b.socEnd_kWh).toBeCloseTo(0, 9);
    expect(b.losses_kWh).toBeCloseTo(9 + 1.9 / 0.9 - 9, 9);
    expect(r.hourly!.export[12]).toBeCloseTo(3000 - 1900 / 0.9, 9);
    expect(r.hourly!.soc[12]).toBeCloseTo(10000, 9);
  });

  it("potenza limitata a 0,5 kW: carica e scarica lente", () => {
    const b = hand({ power_kW: 0.5 }).balance;
    expect(b.charge_kWh).toBeCloseTo(3, 9);
    expect(b.export_kWh).toBeCloseTo(15, 9);
    // 2,7 kWh in batteria escono come 2,43 kWh: quattro ore da 0,5 kW e una da 0,43
    expect(b.discharge_kWh).toBeCloseTo(2.43, 9);
    expect(b.import_kWh).toBeCloseTo(9 + 9 - 2.43, 9);
  });

  it("riserva del 20%: lo stesso giorno con 2 kWh che non si usano", () => {
    const b = hand({ reservePct: 20 }).balance;
    expect(b.socStart_kWh).toBeCloseTo(2, 9);
    expect(b.charge_kWh).toBeCloseTo(8 / 0.9, 9);
    expect(b.discharge_kWh).toBeCloseTo(7.2, 9);
    expect(b.socEnd_kWh).toBeCloseTo(2, 9);
  });

  it("cielo coperto: produzione sempre sotto il consumo, la batteria resta ferma", () => {
    const { demand, pv } = day(1000, 500);
    const b = simulateBattery(demand, pv, { capacity_kWh: 10, power_kW: 5, roundTripPct: 81, reservePct: 0 }, { warmup: false }).balance;
    expect(b.charge_kWh).toBe(0);
    expect(b.discharge_kWh).toBe(0);
    expect(b.import_kWh).toBeCloseTo(24 - 3, 9);
    expect(b.export_kWh).toBe(0);
  });
});

/** Implementazione indipendente e semplice, in kWh e con un ramo per caso. */
function naive(demandW: number[], pvW: number[], cap: number, powerKw: number, rtPct: number, reservePct: number) {
  const eta = Math.sqrt(rtPct / 100);
  const floor = (cap * reservePct) / 100;
  const run = (start: number) => {
    let soc = start;
    let imp = 0;
    let exp = 0;
    let out = 0;
    for (let h = 0; h < demandW.length; h++) {
      const net = (pvW[h] - demandW[h]) / 1000;
      if (net > 0) {
        const room = (cap - soc) / eta;
        const c = Math.min(net, powerKw, room);
        soc += c * eta;
        exp += net - c;
      } else {
        const need = -net;
        const available = (soc - floor) * eta;
        const d = Math.min(need, powerKw, available);
        soc -= d / eta;
        out += d;
        imp += need - d;
      }
    }
    return { soc, imp, exp, out };
  };
  const first = run(floor);
  return run(first.soc);
}

describe("Batteria: confronto con un'implementazione indipendente su un anno", () => {
  it("prelievi, immissioni e scarica coincidono", () => {
    const demand = yearDemand();
    const pv = yearPv();
    for (const params of [BAT, { capacity_kWh: 5, power_kW: 2.5, roundTripPct: 85, reservePct: 10 }, { capacity_kWh: 15, power_kW: 3, roundTripPct: 95, reservePct: 0 }]) {
      const engine = simulateBattery(demand, pv, params).balance;
      const ref = naive(demand, pv, params.capacity_kWh, params.power_kW, params.roundTripPct, params.reservePct);
      expect(engine.import_kWh).toBeCloseTo(ref.imp, 6);
      expect(engine.export_kWh).toBeCloseTo(ref.exp, 6);
      expect(engine.discharge_kWh).toBeCloseTo(ref.out, 6);
      expect(engine.socEnd_kWh).toBeCloseTo(ref.soc, 6);
    }
  });
});

describe("Batteria nei pacchetti", () => {
  const off = evaluate(exampleProject(), milano);
  const on = evaluate(withBattery(), milano);

  it("senza batteria i pacchetti sono quelli di oggi; con capacità zero anche", () => {
    expect(pk(off, "P").battery).toBeUndefined();
    const zero = withBattery();
    zero.battery.capacityKwh.value = 0;
    const ev = evaluate(zero, milano);
    for (const id of ["base", "W", "H", "P", "WH", "HP", "WHP", "WP"] as PackageId[]) {
      expect(pk(ev, id).elec).toEqual(pk(off, id).elec);
      expect(pk(ev, id).cash?.npv).toBe(pk(off, id).cash?.npv);
    }
  });

  it("i pacchetti senza FV non cambiano accendendo la batteria", () => {
    for (const id of ["base", "W", "H", "WH"] as PackageId[]) {
      expect(pk(on, id).elec).toEqual(pk(off, id).elec);
      expect(pk(on, id).cash?.npv).toBe(pk(off, id).cash?.npv);
      expect(pk(on, id).battery).toBeUndefined();
    }
  });

  it("VAN della batteria = VAN con la batteria − VAN dello stesso pacchetto senza", () => {
    for (const id of ["P", "HP", "WHP", "WP"] as PackageId[]) {
      const r = pk(on, id);
      const b = r.battery!;
      expect(b.without.npv).toBe(pk(off, id).cash!.npv);
      expect(b.npvBattery).toBeCloseTo(r.cash!.npv - pk(off, id).cash!.npv, 9);
      expect(r.elec.import_kWh).toBeLessThan(pk(off, id).elec.import_kWh);
      expect(r.investment).toBeCloseTo(pk(off, id).investment + b.investment, 9);
    }
  });

  it("dà autoconsumo, autosufficienza, cicli, energia passata e anni di sostituzione", () => {
    const b = pk(on, "P").battery!;
    const e = pk(on, "P").elec;
    expect(b.selfConsumptionPct).toBeCloseTo(((e.pv_kWh - e.export_kWh) / e.pv_kWh) * 100, 9);
    expect(b.selfSufficiencyPct).toBeCloseTo(((e.demand_kWh - e.import_kWh) / e.demand_kWh) * 100, 9);
    expect(b.selfConsumptionPct).toBeGreaterThan(b.without.selfConsumptionPct);
    expect(b.cyclesPerYear).toBeGreaterThan(50);
    expect(b.cyclesPerYear).toBeLessThan(366);
    expect(b.throughput_kWh).toBeCloseTo(b.cyclesPerYear * exampleProject().battery.capacityKwh.value, 6);
    expect(b.endOfLifeYear).toBeGreaterThan(0);
    expect(b.replacementYears.every((y) => y > 0 && y <= 20)).toBe(true);
  });

  it("il calo della capacità riduce il VAN; la sostituzione lo riporta alla capacità piena", () => {
    const flat = withBattery();
    flat.battery.fadePctPerYear.value = 0;
    flat.battery.replacements = [];
    const faded = withBattery();
    faded.battery.replacements = [];
    const replaced = withBattery();
    const f = pk(evaluate(flat, milano), "P").cash!;
    const g = pk(evaluate(faded, milano), "P").cash!;
    expect(g.npv).toBeLessThan(f.npv);
    expect(g.cashFlows[0]).toBeCloseTo(f.cashFlows[0], 9);
    expect(g.cashFlows[9]).toBeLessThan(g.cashFlows[1]);
    const year = replaced.battery.replacements[0].year;
    const r = pk(evaluate(replaced, milano), "P").cash!;
    // nell'anno della sostituzione si paga la batteria nuova, ma l'energia torna quella del primo anno (al netto del degrado FV)
    expect(r.cashFlows[year]).toBeGreaterThan(g.cashFlows[year]);
  });

  it("costo sconosciuto: niente VAN e voce mancante con il nome della batteria", () => {
    const p = withBattery();
    p.battery.cost.items[0].status = "sconosciuto";
    const r = pk(evaluate(p, milano), "P");
    expect(r.cash).toBeUndefined();
    expect(r.economicsMissing.some((m) => m.startsWith("Batteria"))).toBe(true);
  });

  it("incentivo della batteria: percentuale indicata dall'utente sul solo costo della batteria", () => {
    const p = withBattery();
    Object.assign(p.economics.incentive, { enabled: true, source: "regola di prova", date: "2026-11" });
    p.economics.incentive.batteryPct = { value: 50, status: "ipotizzato" };
    p.economics.incentive.years.value = 10;
    const ev = evaluate(p, milano);
    const row = ev.incentive!.rows.find((x) => x.id === "P")!;
    const batteryCost = pk(ev, "P").battery!.investment;
    expect(row.total).toBeCloseTo(batteryCost * 0.5, 9);
    expect(ev.incentive!.rows.find((x) => x.id === "H")!.total).toBe(0);
  });
});
