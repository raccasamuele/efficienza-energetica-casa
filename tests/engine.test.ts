import { describe, expect, it } from "vitest";
import {
  HOURS,
  balance,
  buildEnvelope,
  capacityW,
  cashFlow,
  computeGeometry,
  cop,
  evaluate,
  exampleProject,
  exchangeSeries,
  exchangeSplit,
  flowTemperature,
  footprintPerimeter,
  localHour,
  nonFinitePaths,
  parseProjectFile,
  rcStep,
  residualDemand,
  runSensitivity,
  seasonMask,
  simulateHeatPump,
  simulateThermal,
  summarizeCost,
  toProjectFile,
  validateClimate,
  type ProjectInput,
} from "../src/engine";
import { constantClimate, loadMilano, steady5R1C } from "./helpers";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const milano = loadMilano();

describe("A — solutore RC", () => {
  it("decadimento libero coincide con la soluzione esponenziale", () => {
    const H = 300, C = 2e7, tOut = 0, T0 = 20;
    let T = T0;
    for (let k = 1; k <= 48; k++) {
      T = rcStep(T, H, H * tOut, 0, C, 3600, null).tNext;
      const exact = tOut + (T0 - tOut) * Math.exp((-H * 3600 * k) / C);
      expect(rel(T, exact)).toBeLessThan(1e-6);
    }
  });

  it("all'equilibrio la potenza è H·(Tset − Teq)", () => {
    const H = 250, C = 1e7, tOut = 5, G = 400, tSet = 20;
    const r = rcStep(tSet, H, H * tOut, G, C, 3600, tSet);
    expect(rel(r.qHeat, H * (tSet - tOut) - G)).toBeLessThan(1e-6);
    expect(Math.abs(r.tNext - tSet)).toBeLessThan(1e-9);
  });

  it("limite H → 0 continuo con la formula generale", () => {
    const C = 1e7, G = 500;
    const a = rcStep(18, 1e-7, 0, G, C, 3600, null).tNext;
    const b = rcStep(18, 0, 0, G, C, 3600, null).tNext;
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
    expect(b).toBeCloseTo(18 + (G * 3600) / C, 12);
    const h = rcStep(18, 0, 0, 0, C, 3600, 20);
    expect(h.qHeat).toBeCloseTo((2 * C) / 3600, 6);
  });

  it("parametri non validi sono errori", () => {
    expect(() => rcStep(20, 100, 0, 0, 0, 3600, null)).toThrow();
    expect(() => rcStep(20, -1, 0, 0, 1e7, 3600, null)).toThrow();
    expect(() => rcStep(20, NaN, 0, 0, 1e7, 3600, null)).toThrow();
  });
});

describe("A — involucro e simulazione annua", () => {
  it("stagione 15/10–15/4 in ora locale = 4392 ore", () => {
    expect(seasonMask(exampleProject().service).filter(Boolean).length).toBe(4392);
  });

  it("clima costante senza sole: regime della rete 5R1C risolto a mano", () => {
    const p = exampleProject();
    const clim = constantClimate(0);
    const env = buildEnvelope(p.building, p.service, clim);
    const th = simulateThermal(p.building, p.service, clim);
    expect(th.ok).toBe(true);
    const n = 4392; // fissato a mano: un errore nella maschera non può compensarsi
    // clima costante: scambio dell'ora (vento, cielo) costante per ogni nodo (motori 0.6.0 e 0.7.0)
    const x = exchangeSplit(env, clim);
    for (const k of ["ve", "w", "op"] as const) expect(new Set(x[k].H).size === 1 && new Set(x[k].B).size === 1).toBe(true);
    const { B } = exchangeSeries(env, clim);
    expect(B[0]).toBeLessThan(0); // a 0 °C senza sole la perdita verso il cielo abbassa la temperatura equivalente
    const hx = { Hve: x.ve.H[0], Bve: x.ve.B[0], Hw: x.w.H[0], Bw: x.w.B[0], Hop: x.op.H[0], Bop: x.op.B[0] };
    const ss = steady5R1C(hx, env.Am, env.Af, env.internalGainW, 0, 20);
    // in pieno inverno (gennaio) il passo orario è al regime: stessa potenza della soluzione a mano
    expect(rel(th.qHeat[500], ss.phi)).toBeLessThan(1e-9);
    expect(Math.abs(th.tIndoor[500] - 20)).toBeLessThan(1e-9);
    // regime: la potenza è quella che esce dai tre rami
    const out = hx.Hve * (ss.thetaAir - hx.Bve / hx.Hve) + hx.Hw * (ss.thetaS - hx.Bw / hx.Hw) + ss.Hem * (ss.thetaM - hx.Bop / hx.Hop);
    expect(rel(ss.phi + env.internalGainW * (1 - hx.Hw / (9.1 * 4.5 * env.Af) * 0.5), out)).toBeLessThan(1e-9);
    // in tutta la stagione: regime più il recupero della massa nelle prime ore (entro l'1%)
    expect(rel(th.heatNeed_kWh * 1000, n * ss.phi)).toBeLessThan(0.01);
  });

  it("apporti interni elevati → nessun carico", () => {
    const p = exampleProject();
    const th = simulateThermal(p.building, { ...p.service, internalGains: { ...p.service.internalGains, value: 1000 } }, constantClimate(15));
    expect(th.heatNeed_kWh).toBe(0);
  });

  it("U finestre maggiore → più energia, a parità di tutto il resto (senza sole)", () => {
    const p = exampleProject();
    const clim = constantClimate(2);
    const a = simulateThermal(p.building, p.service, clim).heatNeed_kWh;
    const b = simulateThermal({ ...p.building, uWindow: { ...p.building.uWindow, value: 5 } }, p.service, clim).heatNeed_kWh;
    expect(b).toBeGreaterThan(a);
  });

  it("warm-up converge sul TMY di Milano e dà valori finiti e plausibili", () => {
    const p = exampleProject();
    const th = simulateThermal(p.building, p.service, milano);
    expect(th.ok).toBe(true);
    expect(th.converged).toBe(true);
    expect(th.cycles).toBeLessThanOrEqual(10);
    expect(th.qHeat.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    const perM2 = th.heatNeed_kWh / p.building.floorArea.value;
    expect(perM2).toBeGreaterThan(30);
    expect(perM2).toBeLessThan(400);
  });

  it("confine con unità riscaldata = scambio nullo", () => {
    const p = exampleProject();
    const a = buildEnvelope({ ...p.building, upper: "riscaldato" }, p.service, milano);
    expect(a.exchanges.some((e) => e.label.includes("Soffitto") || e.label.includes("Copertura"))).toBe(false);
  });
});

describe("A — geometria", () => {
  it("perimetri delle forme", () => {
    expect(footprintPerimeter("quadrata", 100)).toBeCloseTo(40, 9);
    expect(footprintPerimeter("rettangolare", 50)).toBeCloseTo(30, 9); // 10 × 5
    expect(footprintPerimeter("L", 300)).toBeCloseTo(80, 9); // s = 10
    expect(footprintPerimeter("ferroCavallo", 500)).toBeCloseTo(120, 9);
  });
  it("in modalità aree le finestre non vengono sottratte di nuovo", () => {
    const p = exampleProject();
    const b = { ...p.building, geometryMode: "aree" as const, windowMode: "aree" as const };
    b.wallArea = { N: { ...b.wallArea.N, value: 40 }, E: { ...b.wallArea.E, value: 30 }, S: { ...b.wallArea.S, value: 40 }, O: { ...b.wallArea.O, value: 30 } };
    b.windowArea = { N: { ...b.windowArea.N, value: 3 }, E: { ...b.windowArea.E, value: 3 }, S: { ...b.windowArea.S, value: 6 }, O: { ...b.windowArea.O, value: 3 } };
    const g = computeGeometry(b);
    expect(g.externalWall.S).toBe(40);
    expect(g.windows.S).toBe(6);
  });
});

describe("C — pompa di calore parametrica", () => {
  const p = exampleProject();
  p.heatPump.model = "parametrico";
  it("curva climatica passa per il punto di progetto", () => {
    expect(flowTemperature(-5, 55, -5)).toBeCloseTo(55, 9);
    expect(flowTemperature(25, 55, -5)).toBe(25);
  });
  it("COP segue Carnot ridotto e resta nei limiti", () => {
    const c = cop(7, 35, p.heatPump);
    const expected = (0.45 * (40 + 273.15)) / (40 + 273.15 - (2 + 273.15));
    expect(c).toBeCloseTo(Math.min(8, expected), 9);
    expect(cop(-30, 80, p.heatPump)).toBeGreaterThanOrEqual(1);
  });
  it("potenza insufficiente → scenario non valido, nessun risparmio fittizio", () => {
    const q = new Array<number>(HOURS).fill(0);
    q[100] = capacityW(milano.series.tAir[100], p.heatPump) * 2;
    const r = simulateHeatPump(q, milano, p.heatPump, p.system);
    expect(r.ok).toBe(false);
    expect(r.hoursUndersized).toBe(1);
    expect(r.elec[100]).toBe(0);
  });
  it("fuori dominio (mandata oltre il massimo) → non valido", () => {
    const q = new Array<number>(HOURS).fill(0);
    const tMin = Math.min(...milano.series.tAir);
    q[milano.series.tAir.indexOf(tMin)] = 1000;
    const sys = { ...p.system, designFlowTemp: { ...p.system.designFlowTemp, value: 75 } };
    const r = simulateHeatPump(q, milano, p.heatPump, sys);
    expect(r.ok).toBe(false);
    expect(r.hoursOutOfDomain).toBe(1);
  });
});

describe("D — clima e bilancio elettrico", () => {
  it("il pacchetto di Milano supera i controlli", () => {
    expect(validateClimate(milano)).toEqual([]);
  });
  it("ora locale con ora legale del calendario sintetico", () => {
    expect(localHour(0)).toBe(1); // 1 gennaio 00 UTC → 01 locale
    expect(localHour(24 * 180 + 12)).toBe(14); // estate: UTC+2
  });
  it("profilo residuo conserva il totale annuo", () => {
    for (const pr of ["diurno", "serale", "distribuito"] as const) {
      const d = residualDemand(2700, pr);
      expect(rel(d.reduce((a, b) => a + b, 0) / 1000, 2700)).toBeLessThan(1e-9);
    }
  });
  it("bilancio FV chiuso: autoconsumo+import = domanda, autoconsumo+export = produzione", () => {
    const d = residualDemand(3000, "diurno");
    const pv = milano.series.pvAc.S35.map((x) => x * 3);
    const b = balance(d, pv);
    expect(rel(b.self_kWh + b.import_kWh, b.demand_kWh)).toBeLessThan(1e-6);
    expect(rel(b.self_kWh + b.export_kWh, b.pv_kWh)).toBeLessThan(1e-6);
  });
  it("sole zero → nessuna produzione né export", () => {
    const b = balance(residualDemand(2000, "serale"), constantClimate(10).series.pvAc.S35);
    expect(b.pv_kWh).toBe(0);
    expect(b.export_kWh).toBe(0);
  });
});

describe("A — contabilità ed economia", () => {
  it("VAN con flussi costanti coincide con la formula dell'annualità", () => {
    const r = cashFlow({ investment: 10000, annualSaving: 1000, exportDelta: 0, maintenanceDelta: 0, replacements: [], horizon: 20, rate: 0.03 });
    const annuity = (1 - Math.pow(1.03, -20)) / 0.03;
    expect(rel(r.npv, -10000 + 1000 * annuity)).toBeLessThan(1e-9);
    expect(r.simplePayback).toBeCloseTo(10, 9);
  });
  it("risparmio nullo o negativo: nessuna divisione, recupero non raggiunto", () => {
    expect(cashFlow({ investment: 5000, annualSaving: 0, exportDelta: 0, maintenanceDelta: 0, replacements: [], horizon: 20, rate: 0.03 }).simplePayback).toBeNull();
    expect(cashFlow({ investment: 5000, annualSaving: -100, exportDelta: 0, maintenanceDelta: 0, replacements: [], horizon: 20, rate: 0.03 }).discountedPayback).toBeNull();
    expect(cashFlow({ investment: 0, annualSaving: -100, exportDelta: 0, maintenanceDelta: 0, replacements: [], horizon: 20, rate: 0.03 }).simplePayback).toBeNull();
  });
  it("voce sconosciuta → economia incompleta; mancante ≠ zero", () => {
    const p = exampleProject();
    p.windows.cost.items[1].status = "sconosciuto";
    const s = summarizeCost(p.windows.cost);
    expect(s.complete).toBe(false);
    const ev = evaluate(p, milano);
    const w = ev.packages.find((x) => x.id === "W")!;
    expect(w.economicsComplete).toBe(false);
    expect(w.cash).toBeUndefined();
  });
});

describe("Registro servizi e pacchetti", () => {
  const ev = evaluate(exampleProject(), milano);
  it("valutazione dell'esempio riuscita con 8 pacchetti", () => {
    expect(ev.ok).toBe(true);
    expect(ev.packages.map((x) => x.id)).toEqual(["base", "W", "H", "P", "WH", "HP", "WHP", "WP"]);
  });
  it("ogni pacchetto ha esattamente un servizio di riscaldamento", () => {
    for (const r of ev.packages) expect(r.services.filter((s) => s.service === "Riscaldamento").length).toBe(1);
  });
  it("quota fissa gas resta con PDC se ACS/cucina restano a gas", () => {
    const h = ev.packages.find((x) => x.id === "H")!;
    expect(h.gasSmc).toBeGreaterThan(0);
    expect(h.costs.gasFixed).toBeGreaterThan(0);
  });
  it("quota fissa gas sparisce se nessun servizio resta a gas", () => {
    const p = exampleProject();
    p.system.acsOnGas = false;
    p.system.cookingOnGas = false;
    const h = evaluate(p, milano).packages.find((x) => x.id === "H")!;
    expect(h.gasSmc).toBe(0);
    expect(h.costs.gasFixed).toBe(0);
  });
  it("PCS e PCI coerenti danno gli stessi Smc", () => {
    const p = exampleProject();
    const a = evaluate(p, milano).packages[0].gasSmc;
    const etaPcs = (p.system.boilerEfficiency.value * p.system.gasPci.value) / p.system.gasPcs.value;
    p.system.efficiencyBasis = "PCS";
    p.system.boilerEfficiency = { ...p.system.boilerEfficiency, value: etaPcs };
    const b = evaluate(p, milano).packages[0].gasSmc;
    expect(rel(a, b)).toBeLessThan(1e-9);
  });
  it("FV+PDC ricalcola la domanda: bilancio chiuso sul pacchetto combinato", () => {
    const hp = ev.packages.find((x) => x.id === "HP")!;
    expect(rel(hp.elec.self_kWh + hp.elec.import_kWh, hp.elec.demand_kWh)).toBeLessThan(1e-6);
    const h = ev.packages.find((x) => x.id === "H")!;
    if (h.valid) expect(hp.elec.demand_kWh).toBeCloseTo(h.elec.demand_kWh, 6);
  });
  it("nessun NaN o Infinity in nessun campo numerico dei risultati", () => {
    expect(nonFinitePaths(ev.packages)).toEqual([]);
  });
  it("sensibilità calcolabile e con varianti valide", () => {
    const s = runSensitivity(exampleProject(), milano, ev);
    expect(s.variants.length).toBeGreaterThan(10);
    expect(s.packages.length).toBe(7);
  });
});

describe("F — export/import", () => {
  it("round-trip conserva l'input", () => {
    const p = exampleProject();
    const text = JSON.stringify(toProjectFile(p, milano));
    const r = parseProjectFile(text, milano);
    expect(r.errors).toEqual([]);
    expect(r.file!.input).toEqual(JSON.parse(JSON.stringify(p)) as ProjectInput);
  });
  it("rifiuta JSON non valido, schema diverso e valori non numerici", () => {
    expect(parseProjectFile("{", milano).errors.length).toBe(1);
    expect(parseProjectFile(JSON.stringify({ schemaVersion: 99 }), milano).errors.length).toBe(1);
    const f = toProjectFile(exampleProject(), milano) as unknown as { input: { building: { floorArea: { value: unknown } } } };
    f.input.building.floorArea.value = "<img src=x>";
    expect(parseProjectFile(JSON.stringify(f), milano).errors.length).toBeGreaterThan(0);
  });
});
