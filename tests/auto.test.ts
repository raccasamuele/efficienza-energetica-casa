import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, batteryParams, evaluate, exampleProject, exportEnergyProfile, localHour, packageSeries, parseComuni, parseProjectFile, primaryEnergy, q, simulateBattery, toProjectFile, type ProjectInput } from "../src/engine";
import before from "./fixtures/auto-prima.json";
import { loadMilanoLegacy, readPublicJson } from "./helpers";
import { packageConsumptionCurve } from "../src/engine/profilo";

const climate = loadMilanoLegacy(), comuni = parseComuni(readPublicJson("comuni.json"));
const auto = () => import("../src/engine/auto");
const on = () => { const p = exampleProject(); p.ev.enabled = true; return p; };
const zero = (n = 8760) => Array<number>(n).fill(0);
const fixtureProject = (name: string) => {
  const p = exampleProject();
  if (name === "fv-esistente") p.existingPv.present = true;
  if (name === "batteria") p.battery.enabled = true;
  if (name === "scaldacqua-pdc") { p.dhw.replace = true; p.dhw.newType = "pdc"; }
  if (name === "split") p.cooling.today = "split";
  return p;
};
function closeTree(actual: unknown, expected: unknown) {
  if (typeof expected === "number") expect(actual).toBeCloseTo(expected, 6);
  else if (Array.isArray(expected)) { expect(actual).toHaveLength(expected.length); expected.forEach((v, i) => closeTree((actual as unknown[])[i], v)); }
  else if (expected && typeof expected === "object") for (const [k, v] of Object.entries(expected)) closeTree((actual as Record<string, unknown>)[k], v);
  else expect(actual).toEqual(expected);
}

/** I profili delle fixture sono della versione 1: dalla 2 Casa aggiunge il prezzo variabile dell'elettricità. */
const conBolletta = (p: ProjectInput) => ({ versione: 2, bolletta: { eur_kwh: p.tariffs.elecPrice.value, stato: p.tariffs.elecPrice.status } });

describe("Auto elettrica: compatibilità", () => {
  for (const old of before) it(`spenta: ${old.name}, pacchetti e profilo originali`, () => {
    const p = fixtureProject(old.name); expect(p.ev.enabled).toBe(false);
    const ev = evaluate(p, climate); expect(ev.ok).toBe(true);
    for (const r of ev.packages) {
      const ref = old.packages.find((x) => x.id === r.id)!;
      closeTree({ id: r.id, npv: r.cash?.npv ?? null, bill: r.costs.total, import_kWh: r.elec.import_kWh, export_kWh: r.elec.export_kWh, investment: r.investment, pvKwp: r.pvKwp, batteryKwh: r.battery?.capacity_kWh ?? null }, ref);
      expect(r.ev).toBeUndefined();
    }
    closeTree(exportEnergyProfile(p, climate, ev.packages, new Date("2026-11-05T00:00:00Z")), { ...old.profile, motore: `casa-1R1C ${ENGINE_VERSION}`, ...conBolletta(p) });
  });
  it("salvataggio senza input.ev: nessun avviso né cambiamento", () => {
    const p = exampleProject(), f = toProjectFile(p, climate);
    delete (f.input as Partial<ProjectInput>).ev;
    const result = parseProjectFile(JSON.stringify(f), climate, comuni);
    expect(result.errors).toEqual([]); expect(result.warnings).toEqual([]);
    expect(result.file!.input.ev.enabled).toBe(false);
    closeTree(evaluate(result.file!.input, climate).packages, evaluate(exampleProject(), climate).packages);
  });
});

describe("Modello orario dell'auto", () => {
  for (const winter of [0, 20]) it(`energia e bilancio periodico, inverno ${winter}%`, async () => {
    const p = on(); p.ev.winterExtraPct = q(winter);
    const r = (await auto()).simulateEv(p.ev, null, zero());
    const days = Array.from({ length: 365 }, (_, d) => d).filter((d) => d % 7 < 5);
    const weighted = days.reduce((s, d) => s + (d < 59 || d >= 334 ? 1 + winter / 100 : 1), 0);
    const need = 12000 / days.length * .17 * weighted;
    expect(r.need_kWh).toBeCloseTo(need, 6);
    expect(r.unmet_kWh).toBeCloseTo(0, 6);
    expect(r.home_kWh).toBeCloseTo((need * .9 + r.socEnd_kWh - r.socStart_kWh) * 1.05, 6);
    expect(r.losses_kWh).toBeCloseTo(r.home_kWh * .05 / 1.05, 6);
  });
  for (const strategy of ["arrivo", "notte"] as const) it(`due giorni a mano: ${strategy}`, async () => {
    const p = on(); Object.assign(p.ev, { strategy, kmYear: q(100), consumptionKwh100: q(20), winterExtraPct: q(0), outsideSharePct: q(0), daysPerWeek: q(7) });
    // Due giorni d'uso: 50 km/giorno = 10 kWh, 10,5 kWh dalla presa.
    const r = (await auto()).simulateEv(p.ev, null, zero(48), strategy, { warmup: false });
    const expected = zero(48);
    for (const d of [0, 1]) {
      if (strategy === "arrivo") { expected[d * 24 + 17] = 3700; expected[d * 24 + 18] = 3700; expected[d * 24 + 19] = 3100; }
    }
    if (strategy === "notte") { expected[22] = 3700; expected[23] = 3700; expected[24] = 3100; expected[46] = 3700; expected[47] = 3700; }
    r.elec.forEach((v, h) => expect(v).toBeCloseTo(expected[h], 6));
  });
  it("notte: solo dalle 23 alle 7; minimo garantito e mancanza quando la carica non basta", async () => {
    const p = on(), { simulateEv } = await auto();
    const n = simulateEv(p.ev, null, zero(), "notte");
    n.elec.forEach((v, h) => { if (localHour(h) >= 7 && localHour(h) < 23) expect(v).toBeCloseTo(0, 6); });
    const s = simulateEv(p.ev, null, zero(), "sole");
    expect(s.unmetDays).toBe(0); expect(s.unmet_kWh).toBeCloseTo(0, 6);
    let soc = s.socStart_kWh;
    const needs = (await auto()).evNeed(p.ev).needs;
    s.elec.forEach((v, h) => {
      const d = Math.floor(h / 24);
      if (d % 7 < 5 && localHour(h) === 8) {
        expect(soc).toBeGreaterThanOrEqual(25 - 1e-6);
        soc -= needs[d] / 1000 * .9;
      }
      soc += v / 1000 / 1.05;
    });
    p.ev.kmYear = q(100000); p.ev.carBatteryKwh = q(10); p.ev.chargerKw = q(1.4);
    const low = simulateEv(p.ev, null, zero(), "sole");
    expect(low.unmetDays).toBeGreaterThan(0); expect(low.unmet_kWh).toBeGreaterThan(0);
  });
  it("sole: soglia 1,4 kW e priorità casa → auto → batteria", async () => {
    const p = on(); p.ev.minDepartPct = q(0); p.ev.returnHour = q(10);
    const house = Array<number>(48).fill(1000), pv = zero(48);
    pv[11] = 2399; pv[12] = 4000;
    const car = (await auto()).simulateEv(p.ev, pv, house, "sole", { warmup: false });
    expect(car.elec[11]).toBeCloseTo(0, 6); expect(car.elec[12]).toBeCloseTo(3000, 6);
    const b = simulateBattery(house.map((x, h) => x + car.elec[h]), pv, batteryParams(p), { hourly: true, warmup: false }).hourly!;
    expect(b.charge[12]).toBeCloseTo(0, 6); expect(b.direct[12]).toBeCloseTo(4000, 6);
  });
});

describe("Integrazione nei pacchetti", () => {
  for (const strategy of ["sole", "arrivo"] as const) it(`conservazione oraria e attribuzione: ${strategy}`, async () => {
    const p = on(); p.ev.strategy = strategy; p.battery.enabled = true;
    const ev = evaluate(p, climate); expect(ev.ok).toBe(true); expect(ev.packages).toHaveLength(8);
    for (const r of ev.packages) {
      expect(r.ev!.strategy).toBe(strategy);
      const s = packageSeries(p, climate, r), house = s.demand.map((x, h) => x - r.ev!.elec[h]);
      const bat = simulateBattery(s.demand, s.pv ?? zero(), { ...batteryParams(p), capacity_kWh: r.battery?.capacity_kWh ?? 0 }, { hourly: true }).hourly!;
      for (let h = 0; h < 8760; h++) {
        expect(s.pv?.[h] ?? 0).toBeCloseTo(bat.direct[h] + bat.charge[h] + bat.export[h], 6);
        expect(house[h] + r.ev!.elec[h]).toBeCloseTo(bat.direct[h] + bat.discharge[h] + bat.import[h], 6);
      }
      expect(r.ev!.fromPv_kWh + r.ev!.fromBattery_kWh + r.ev!.fromGrid_kWh).toBeCloseTo(r.ev!.home_kWh, 6);
      expect(r.ev!.fromGrid_kWh).toBeGreaterThanOrEqual(-1e-6);
      expect(r.services.filter((s) => s.service === "Auto elettrica (ricarica a casa)")).toHaveLength(1);
      expect(s.demand.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(r.elec.demand_kWh, 6);
    }
  });
  it("costo marginale, contratto, carburante, investimento e beneficio batteria senza doppio conteggio", async () => {
    const p = on(); p.battery.enabled = true; p.ev.contractPower = q(8);
    const off = structuredClone(p); off.ev.enabled = false;
    const a = evaluate(p, climate), b = evaluate(off, climate), api = await auto();
    a.packages.forEach((r, i) => {
      const old = b.packages[i];
      expect(r.investment).toBeCloseTo(old.investment, 6);
      const delta = (r.elec.import_kWh - old.elec.import_kWh) * p.tariffs.elecPrice.value - (r.elec.export_kWh - old.elec.export_kWh) * p.tariffs.exportPrice.value + r.costs.elecPower - old.costs.elecPower;
      expect(r.ev!.marginalCost).toBeCloseTo(delta, 6);
      expect(api.evStrategies(p, climate, r)).toHaveLength(3);
      const fuel = api.evFuelComparison(p, r.ev!);
      expect(fuel.fuel).toBeCloseTo(12000 * .065 * 1.8, 6);
      expect(fuel.ev).toBeCloseTo(delta + (r.ev!.outside_kWh + r.ev!.unmet_kWh) * .6, 6);
      if (r.battery) {
        expect(r.ev!.batteryBenefit!.withCar).toBeCloseTo((r.battery.without.elec.import_kWh - r.elec.import_kWh) * p.tariffs.elecPrice.value - (r.battery.without.elec.export_kWh - r.elec.export_kWh) * p.tariffs.exportPrice.value, 6);
        expect(r.ev!.batteryBenefit!.withoutCar).toBeCloseTo((old.battery!.without.elec.import_kWh - old.elec.import_kWh) * p.tariffs.elecPrice.value - (old.battery!.without.elec.export_kWh - old.elec.export_kWh) * p.tariffs.exportPrice.value, 6);
      }
    });
    expect(api.evCost(p).total).toBeCloseTo(1400 + (8 - p.tariffs.contractPower.value) * 80, 6);
  });
  it("energia primaria e valore della casa esclusi dall'auto", () => {
    const p = on(); p.economics.homeValue.enabled = true; p.economics.homeValue.energyClass = "E"; p.economics.homeValue.marketValue = q(300000);
    const off = structuredClone(p); off.ev.enabled = false;
    const a = evaluate(p, climate), b = evaluate(off, climate);
    a.packages.forEach((r, i) => expect(primaryEnergy(p, climate, r)).toBeCloseTo(primaryEnergy(off, climate, b.packages[i]), 6));
    a.homeValue!.rows.forEach((r, i) => { for (const k of ["ep_kWh", "premiumPct", "premiumEur", "presentValue"] as const) expect(r[k]).toBeCloseTo(b.homeValue!.rows[i][k]!, 6); });
  });
  it("scorporo annuo e errore se gli altri usi non bastano", async () => {
    const p = on(), api = await auto(); p.consumption.electricityKwh = q(10000); p.ev.alreadyInConsumption = true;
    const r = evaluate(p, climate).packages[0];
    expect(r.otherUses_kWh).toBeCloseTo(10000 - api.evNeed(p.ev).home_kWh * 1.05, 6);
    p.consumption.electricityKwh = q(100); expect(evaluate(p, climate).ok).toBe(false);
  });
  it("profilo: auto negli altri usi senza chiavi nuove negli scenari", () => {
    const p = on(), ev = evaluate(p, climate), profile = exportEnergyProfile(p, climate, ev.packages);
    expect(profile.versione).toBe(2); // la 2 aggiunge solo il prezzo della bolletta
    profile.scenari.forEach((s) => expect(Object.keys(s.consumi.usi!).every((k) => ["altri_usi_kwh", "pompa_di_calore_kwh", "raffrescamento_kwh"].includes(k))).toBe(true));
    profile.scenari.forEach((s, i) => expect(s.consumi.usi!.altri_usi_kwh).toBeCloseTo(Math.round((ev.packages[i].otherUses_kWh + ev.packages[i].ev!.home_kWh) * 10) / 10, 6));
    for (const r of ev.packages) expect(packageConsumptionCurve(p, climate, r).kwh_annui).toBeCloseTo(Math.round(r.elec.import_kWh * 10) / 10, 6);
  });
  it("importazione: enum, interi e coerenza delle percentuali controllati", () => {
    const p = on(); p.ev.daysPerWeek = q(3.5); p.ev.minDepartPct = q(90);
    expect(evaluate(p, climate).ok).toBe(false);
    const f = toProjectFile(p, climate); (f.input.ev as { strategy: string }).strategy = "libera";
    expect(parseProjectFile(JSON.stringify(f), climate, comuni).errors.some((s) => s.includes("ev.strategy"))).toBe(true);
  });
  it("taglia indicativa e FV esistente: confronto delle strategie coerente col pacchetto", async () => {
    const api = await auto(), p = on(); p.goal = "fv"; p.ev.strategy = "sole"; p.pv.sizing = "indicativa";
    for (const existing of [false, true]) {
      p.existingPv.present = existing;
      const result = evaluate(p, climate); expect(result.ok).toBe(true);
      const r = result.packages.find((x) => x.id === "P")!;
      const selected = api.evStrategies(p, climate, r).find((s) => s.strategy === "sole")!;
      for (const key of ["home_kWh", "fromPv_kWh", "fromBattery_kWh", "marginalCost", "peak_W"] as const) expect(selected[key]).toBeCloseTo(r.ev![key], 6);
      expect(r.conditions.some((s) => s.startsWith("Auto elettrica:") && s.includes("riferimento"))).toBe(true);
    }
  });
});
