import { describe, expect, it } from "vitest";
import {
  cashFlow,
  checkCashFlow,
  defaultVariants,
  evaluate,
  exampleProject,
  gridImportSeries,
  parseProjectFile,
  pvDegradationFlows,
  pvProduction,
  toProjectFile,
  type Evaluation,
  type PackageId,
  type ProjectInput,
} from "../src/engine";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;
const project = (loss: number, degradation: number) => {
  const p = exampleProject();
  p.pv.lossPct.value = loss;
  p.pv.degradationPct.value = degradation;
  return p;
};

describe("Fotovoltaico: perdite, ombre e degrado", () => {
  it("con perdite e degrado a zero i conti restano quelli di prima", () => {
    const ev = evaluate(project(0, 0), milano);
    expect(pk(ev, "P").elec.pv_kWh).toBeCloseTo(5489, 0);
    expect(pk(ev, "P").cash!.npv).toBeCloseTo(796, 0);
    expect(new Set(pk(ev, "P").cash!.cashFlows.filter((_, i) => i !== 11)).size).toBe(1);
  });

  it("le perdite riducono la produzione e valgono come meno kWp allo stesso costo", () => {
    const zero = evaluate(project(0, 0), milano);
    const loss = evaluate(project(15, 0), milano);
    expect(pk(loss, "P").elec.pv_kWh).toBeCloseTo(pk(zero, "P").elec.pv_kWh * 0.85, 6);
    const lessKwp = project(0, 0);
    lessKwp.pv.kWp.value *= 0.85;
    expect(pk(loss, "P").cash!.npv).toBeCloseTo(pk(evaluate(lessKwp, milano), "P").cash!.npv, 6);
    expect(pk(loss, "P").cash!.npv).toBeLessThan(0);
    expect(pk(loss, "H").cash!.npv).toBe(pk(zero, "H").cash!.npv);
  });

  it("il degrado abbassa i flussi anno dopo anno e lascia uguale il primo", () => {
    const zero = pk(evaluate(project(0, 0), milano), "P");
    const aged = pk(evaluate(project(0, 0.5), milano), "P");
    expect(aged.cash!.cashFlows[0]).toBeCloseTo(zero.cash!.cashFlows[0], 9);
    expect(aged.cash!.cashFlows[9]).toBeLessThan(aged.cash!.cashFlows[1]);
    expect(aged.cash!.npv).toBeLessThan(zero.cash!.npv);
    expect(aged.annualBenefit).toBeCloseTo(zero.annualBenefit, 9);
  });

  it("flussi del degrado: zero il primo anno, poi perdite crescenti pari al bilancio ricalcolato", () => {
    const demand = new Array(8760).fill(1000);
    const pv = pvProduction(milano, "S35", 4);
    const flows = pvDegradationFlows(demand, pv, 1, 3, 0.3, 0.1);
    expect(flows).toHaveLength(3);
    expect(flows[0]).toBe(0);
    expect(flows[1]).toBeLessThan(0);
    expect(flows[2]).toBeLessThan(flows[1]);
    let imp0 = 0, exp0 = 0, imp1 = 0, exp1 = 0;
    for (let h = 0; h < 8760; h++) {
      imp0 += Math.max(demand[h] - pv[h], 0);
      exp0 += Math.max(pv[h] - demand[h], 0);
      imp1 += Math.max(demand[h] - pv[h] * 0.99, 0);
      exp1 += Math.max(pv[h] * 0.99 - demand[h], 0);
    }
    expect(flows[1]).toBeCloseTo(((imp0 - imp1) * 0.3 + (exp1 - exp0) * 0.1) / 1000, 6);
    expect(pvDegradationFlows(demand, pv, 0, 3, 0.3, 0.1)).toEqual([0, 0, 0]);
  });

  it("il controllo del flusso di cassa tiene conto dei flussi annui", () => {
    const input = { investment: 100, annualSaving: 50, exportDelta: 0, maintenanceDelta: 0, replacements: [], horizon: 3, rate: 0.03, yearlyDelta: [0, -1, -2] };
    const r = cashFlow(input);
    expect(r.cashFlows).toEqual([50, 49, 48]);
    expect(checkCashFlow(r, input)).toBe(true);
    expect(checkCashFlow(r, { ...input, yearlyDelta: undefined })).toBe(false);
  });

  it("la curva per la CER tiene conto delle perdite", () => {
    const pSeries = (p: ProjectInput) => gridImportSeries(p, milano, pk(evaluate(p, milano), "P")).reduce((a, b) => a + b, 0);
    expect(pSeries(project(30, 0))).toBeGreaterThan(pSeries(project(0, 0)));
    const e = pk(evaluate(project(30, 0), milano), "P");
    expect(pSeries(project(30, 0)) / 1000).toBeCloseTo(e.elec.import_kWh, 6);
  });

  it("la sensibilità prova una produzione più bassa del 15%", () => {
    const p = project(0, 0);
    const v = defaultVariants(p).find((x) => x.id === "pvprod-")!;
    expect(v.label).toContain("−15%");
    expect(v.apply(p).pv.lossPct.value).toBeCloseTo(15, 9);
    const q = project(38, 0);
    expect(defaultVariants(q).find((x) => x.id === "pvprod-")!.apply(q).pv.lossPct.value).toBe(40);
  });

  it("valori fuori intervallo sono errori", () => {
    expect(evaluate(project(50, 0), milano).ok).toBe(false);
    expect(evaluate(project(0, 3), milano).ok).toBe(false);
  });

  it("un progetto salvato senza i nuovi campi si apre con i predefiniti e lo segnala", () => {
    const f = toProjectFile(exampleProject(), milano) as unknown as { input: { pv: Record<string, unknown> } };
    delete f.input.pv.lossPct;
    delete f.input.pv.degradationPct;
    const r = parseProjectFile(JSON.stringify(f), milano);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.pv.lossPct.value).toBe(0);
    expect(r.file!.input.pv.degradationPct.value).toBe(0.5);
    expect(r.warnings.join(" ")).toContain("pv.lossPct");
  });
});
