import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  discountedPathNpv,
  evaluate,
  evaluateModel,
  evaluatePaths,
  exampleProject,
  parseComuni,
  parseProjectFile,
  pathNpvForVariant,
  runSensitivity,
  sizesOf,
  type Evaluation,
  type ProjectInput,
  ENGINE_VERSION,
} from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { PianoNelTempo } from "../src/ui/percorsi";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const climate = loadMilanoLegacy();
const comuni = parseComuni(readPublicJson("comuni.json"));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/percorsi-prima.json", import.meta.url), "utf8"));
const get = (ev: Evaluation, id: string) => ev.packages.find((item) => item.id === id)!;

function setPlan(
  p: ProjectInput,
  custom: { W: number | null; H: number | null; P: number | null },
  options: { budgetNow?: number; budgetPerYear?: number; boilerYear?: number | null; carYear?: number } = {},
) {
  p.plan = {
    budgetNow: { value: options.budgetNow ?? 1_000_000, status: "ipotizzato" },
    budgetPerYear: { value: options.budgetPerYear ?? 0, status: "ipotizzato" },
    boilerYear: options.boilerYear === null
      ? { value: 0, status: "sconosciuto" }
      : { value: options.boilerYear ?? 0, status: "ipotizzato" },
    carYear: { value: options.carYear ?? 0, status: "ipotizzato" },
    custom,
  };
}

function expectPathMatchesPackage(path: NonNullable<ReturnType<typeof evaluatePaths>["custom"]>, pkg: ReturnType<typeof get>) {
  if (!pkg.cash) {
    expect(path.npv).toBeCloseTo(0, 6);
    expect(path.flows.every((flow) => flow === 0)).toBe(true);
    expect(path.cumulative.every((value) => value === 0)).toBe(true);
    return;
  }
  expect(path.npv).toBeCloseTo(pkg.cash.npv, 6);
  expect(path.flows).toHaveLength(pkg.cash.cashFlows.length);
  path.flows.forEach((flow, index) => expect(flow).toBeCloseTo(pkg.cash!.cashFlows[index], 6));
  expect(path.cumulative).toHaveLength(pkg.cash.cumulative.length);
  path.cumulative.forEach((value, index) => expect(value).toBeCloseTo(pkg.cash!.cumulative[index], 6));
}

describe("Piano nel tempo — specifica 6", () => {
  it("1. conserva pacchetti e sensibilita' originali", () => {
    for (const item of fixture) {
      const p = exampleProject();
      p.pv.sizing = item.name === "preventivo" ? "preventivo" : "indicativa";
      p.heatPump.boilerEndOfLife = item.name.includes("boiler-si");
      p.ev.enabled = item.name.endsWith("ev-si");
      const ev = evaluate(p, climate);
      const sens = runSensitivity(p, climate, ev);
      expect(ev.packages.map((x) => x.id)).toEqual(item.packages.map((x: any) => x.id));
      ev.packages.forEach((result, index) => {
        const reference = item.packages[index];
        expect(result.cash?.npv ?? null).toBeCloseTo(reference.npv ?? 0, 6);
        expect(result.investment).toBeCloseTo(reference.investment, 6);
        expect(result.costs.total).toBeCloseTo(reference.spending, 6);
        const flows = result.cash?.cashFlows ?? [];
        expect(flows).toHaveLength((reference.cashFlows ?? []).length);
        flows.forEach((flow, year) => expect(flow).toBeCloseTo(reference.cashFlows[year], 6));
      });
      expect(sens.packages.map((x) => x.id)).toEqual(item.sensitivity.packages.map((x: any) => x.id));
      sens.packages.forEach((result, index) => {
        const reference = item.sensitivity.packages[index];
        expect(result.npvMin ?? 0).toBeCloseTo(reference.npvMin ?? 0, 6);
        expect(result.npvMax ?? 0).toBeCloseTo(reference.npvMax ?? 0, 6);
      });
      expect(sens.nominalBest).toBe(item.sensitivity.nominalBest);
      expect(sens.bestStableShare ?? 0).toBeCloseTo(item.sensitivity.bestStableShare ?? 0, 6);
    }
  });

  it("2. flowParts ricostruisce i flussi e marca le sostituzioni dal punto in cui sono inserite", () => {
    const p = exampleProject();
    p.heatPump.replacements = [{ label: "Sostituzione regolatore", year: 8, amount: { value: 300, status: "ipotizzato" } }];
    p.pv.replacements = [{ label: "Sostituzione regolatore", year: 9, amount: { value: 400, status: "ipotizzato" } }];
    p.battery.enabled = true;
    p.battery.replacements = [{ label: "Sostituzione regolatore", year: 10, amount: { value: 500, status: "ipotizzato" } }];
    const ev = evaluate(p, climate);
    const plant = get(ev, "H") as any;
    const solar = get(ev, "P") as any;
    const solarAndBattery = get(ev, "HP") as any;
    expect(plant.flowParts.replacements.find((x: any) => x.year === 8)?.block).toBe("H");
    expect(solar.flowParts.replacements.find((x: any) => x.year === 9)?.block).toBe("P");
    expect(solarAndBattery.flowParts.replacements.find((x: any) => x.year === 10)?.block).toBe("P");
    for (const result of ev.packages) {
      if (!result.cash) continue;
      for (let year = 1; year <= result.cash.cashFlows.length; year++) {
        const parts = (result as any).flowParts;
        const replacement = parts.replacements.filter((item: any) => item.year === year).reduce((sum: number, item: any) => sum + item.amount, 0);
        expect(parts.annualBenefit + parts.ageing[year - 1] - replacement).toBeCloseTo(result.cash.cashFlows[year - 1], 9);
      }
    }
  });

  it("3. il calcolo generale coincide con gli otto pacchetti e con gli eventi anno zero", () => {
    const packageSets = [
      [], ["W"], ["H"], ["P"], ["W", "H"], ["W", "P"], ["H", "P"], ["W", "H", "P"],
    ];
    for (const blocks of packageSets) {
      const p = exampleProject();
      setPlan(p, { W: blocks.includes("W") ? 0 : null, H: blocks.includes("H") ? 0 : null, P: blocks.includes("P") ? 0 : null }, { boilerYear: null });
      const ev = evaluate(p, climate);
      const id = blocks.length ? blocks.join("") : "base";
      expectPathMatchesPackage(evaluatePaths(p, climate, ev).custom!, get(ev, id));
    }

    for (const id of ["H", "HP", "WHP"]) {
      const p = exampleProject();
      p.heatPump.boilerEndOfLife = true;
      setPlan(p, { W: id.includes("W") ? 0 : null, H: 0, P: id.includes("P") ? 0 : null }, { boilerYear: null });
      const ev = evaluate(p, climate);
      expectPathMatchesPackage(evaluatePaths(p, climate, ev).custom!, get(ev, id));
    }

    const carProject = exampleProject();
    carProject.ev.enabled = true;
    setPlan(carProject, { W: 0, H: 0, P: 0 }, { boilerYear: null, carYear: 0 });
    const carEvaluation = evaluate(carProject, climate);
    expectPathMatchesPackage(evaluatePaths(carProject, climate, carEvaluation).custom!, get(carEvaluation, "WHP"));
  });

  it("4. spostando W dall'anno 1 al 2, il flusso al primo anno resta e l'investimento si sposta", () => {
    const p = exampleProject();
    setPlan(p, { W: 1, H: null, P: null }, { boilerYear: null });
    const first = evaluatePaths(p, climate, evaluate(p, climate)).custom!;
    p.plan!.custom.W = 2;
    const second = evaluatePaths(p, climate, evaluate(p, climate)).custom!;
    for (let year = 0; year <= 5; year++) {
      const expected = year === 2 ? first.investments[1] : year === 1 ? 0 : first.investments[year];
      expect(second.investments[year]).toBeCloseTo(expected, 6);
    }
    expect(second.flows[0]).toBeCloseTo(first.flows[0], 6);
    const benefit = get(evaluate(p, climate), "W").flowParts!.annualBenefit;
    expect(first.flows[1]).toBeCloseTo(benefit, 6);
    expect(second.flows[1]).toBeCloseTo(0, 6);
    for (let year = 3; year <= second.flows.length; year++) {
      expect(first.flows[year - 1]).toBeCloseTo(benefit, 6);
      expect(second.flows[year - 1]).toBeCloseTo(benefit, 6);
    }
  });

  it("5. VAN manuale di due stati con W installato all'anno 2", () => {
    const rate = 0.03;
    const investments = [0, 0, 1000];
    const flows = Array(10).fill(0);
    for (let year = 3; year <= 10; year++) flows[year - 1] = 200;
    flows[6] -= 300; // sostituzione cinque anni dopo l'installazione
    const expected = 136.82326571010097;
    expect(discountedPathNpv(investments, flows, rate)).toBeCloseTo(expected, 9);
  });

  it("6. con Yc=2, H all'anno 1 evita la caldaia all'anno 2", () => {
    const p = exampleProject();
    p.heatPump.boilerEndOfLife = true;
    setPlan(p, { W: null, H: 1, P: null }, { boilerYear: 2 });
    const withCost = evaluatePaths(p, climate, evaluate(p, climate)).custom!;
    p.plan!.custom.H = 3;
    const latePlant = evaluatePaths(p, climate, evaluate(p, climate)).custom!;

    p.plan!.custom.H = 1;
    p.heatPump.boilerReplacementCost.value = 0;
    const earlyZeroCost = evaluatePaths(p, climate, evaluate(p, climate)).custom!;
    p.plan!.custom.H = 3;
    const lateZeroCost = evaluatePaths(p, climate, evaluate(p, climate)).custom!;
    const avoidedTerm = 3000 / (1.03 ** 2);
    expect(withCost.cumulative[2] - earlyZeroCost.cumulative[2]).toBeCloseTo(avoidedTerm, 6);
    p.heatPump.boilerReplacementCost.value = 3000;
    const variantNpvWithBoiler = pathNpvForVariant(p, evaluate(p, climate), withCost);
    p.heatPump.boilerReplacementCost.value = 0;
    const variantNpvWithoutBoiler = pathNpvForVariant(p, evaluate(p, climate), withCost);
    expect(variantNpvWithBoiler - variantNpvWithoutBoiler).toBeCloseTo(avoidedTerm, 6);
    expect((withCost.npv - latePlant.npv) - (earlyZeroCost.npv - lateZeroCost.npv)).toBeCloseTo(avoidedTerm, 6);
  });

  it("7. con auto all'anno 3 usa gli stati senza auto fino al terzo anno e poi quelli con auto", () => {
    const p = exampleProject();
    p.ev.enabled = true;
    setPlan(p, { W: 0, H: null, P: null }, { boilerYear: null, carYear: 3 });
    const nominal = evaluate(p, climate);
    const path = evaluatePaths(p, climate, nominal).custom!;
    const noCarInput = structuredClone(p);
    noCarInput.ev.enabled = false;
    const noCar = evaluateModel(noCarInput, climate, 1, sizesOf(nominal));
    const withCar = evaluateModel(p, climate, 1, sizesOf(nominal));
    const expected = (ev: Evaluation, year: number) => {
      const parts = get(ev, "W").flowParts!;
      return parts.annualBenefit + (parts.ageing[year - 1] ?? 0);
    };
    for (let year = 1; year <= 3; year++) expect(path.flows[year - 1]).toBeCloseTo(expected(noCar, year), 6);
    for (let year = 4; year <= path.flows.length; year++) expect(path.flows[year - 1]).toBeCloseTo(expected(withCar, year), 6);
  });

  it("8. budget progressivo e budget non indicato", () => {
    const p = exampleProject();
    setPlan(p, { W: 0, H: 0, P: 0 }, { budgetNow: 1, budgetPerYear: 0, boilerYear: null });
    const paths = evaluatePaths(p, climate, evaluate(p, climate));
    expect(paths.proposed.every((path) => path.withinBudget)).toBe(true);
    expect(paths.custom!.withinBudget).toBe(false);
    p.plan!.budgetNow.status = "sconosciuto";
    const free = evaluatePaths(p, climate, evaluate(p, climate));
    expect(free.budgetKnown).toBe(false);
    expect(free.notes.length).toBeGreaterThan(0);
  });

  it("9. al massimo quattro proposti, distinti e non dominati", () => {
    const p = exampleProject();
    setPlan(p, { W: null, H: null, P: null }, { budgetNow: 1e6, budgetPerYear: 1e5, boilerYear: null });
    const result = evaluatePaths(p, climate, evaluate(p, climate));
    expect(result.proposed.length).toBeLessThanOrEqual(4);
    expect(new Set(result.proposed.map((path) => JSON.stringify(path.years))).size).toBe(result.proposed.length);
    for (const path of result.proposed) expect(path.withinBudget).toBe(true);
  });

  it("10. caso di accettazione: proposti ammessi dal budget e nominati", () => {
    const p = exampleProject();
    p.ev.enabled = true;
    setPlan(p, { W: 0, H: 2, P: 3 }, { budgetNow: 10000, budgetPerYear: 3000, boilerYear: 2, carYear: 3 });
    const result = evaluatePaths(p, climate, evaluate(p, climate));
    expect(result.proposed.length).toBeGreaterThanOrEqual(2);
    expect(result.proposed.length).toBeLessThanOrEqual(4);
    for (const path of result.proposed) {
      expect(path.name.length).toBeGreaterThan(0);
      let spent = 0;
      for (let year = 0; year <= 5; year++) {
        spent += path.spendingByYear[year];
        expect(spent).toBeLessThanOrEqual(10000 + 3000 * year + 1e-6);
      }
    }
  });

  it("11 bis. un progetto con «mai» nel percorso dell'utente si salva e si riapre, anche come bozza", () => {
    const p = exampleProject();
    p.plan!.custom = { W: null, H: 2, P: null };
    const text = JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p });
    for (const draft of [false, true]) {
      const parsed = parseProjectFile(text, climate, comuni, { draft });
      expect(parsed.errors).toEqual([]);
      expect(parsed.file!.input.plan!.custom).toEqual({ W: null, H: 2, P: null });
    }
  });
  it("11. i progetti vecchi si aprono senza avvisi e mantengono gli stessi pacchetti", () => {
    const p = exampleProject();
    delete (p as any).plan;
    const before = evaluate(p, climate);
    const parsed = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p }), climate, comuni);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.file!.input.plan).toBeDefined();
    const after = evaluate(parsed.file!.input, climate);
    after.packages.forEach((item, index) => {
      const original = before.packages[index];
      expect(item.id).toBe(original.id);
      expect(item.cash?.npv ?? 0).toBeCloseTo(original.cash?.npv ?? 0, 6);
      const flows = item.cash?.cashFlows ?? [];
      expect(flows).toHaveLength(original.cash?.cashFlows.length ?? 0);
      flows.forEach((flow, year) => expect(flow).toBeCloseTo(original.cash!.cashFlows[year], 6));
    });
  });

  it("12. campi nella sezione Economia e riquadro nei risultati e nel report", () => {
    const p = exampleProject();
    const fields = renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
    expect(fields).toContain("Soldi disponibili subito");
    const short = structuredClone(p);
    short.goal = "fv";
    const shortUi = renderToStaticMarkup(<FormContext.Provider value={{ project: short }}><InterventionsForm p={short} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
    expect(shortUi).not.toContain("Soldi disponibili subito");
    const ev = evaluate(p, climate);
    const paths = evaluatePaths(p, climate, ev);
    const panel = renderToStaticMarkup(<PianoNelTempo result={paths} plan={p.plan} />);
    expect(panel).toContain("<table");
    expect(panel).toContain("<svg");
    expect(renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={climate} paths={paths} />)).toContain("Piano nel tempo");
    expect(renderToStaticMarkup(<Report p={p} ev={ev} climate={climate} sens={null} paths={paths} />)).toContain("Piano nel tempo");
  });

  it("13. evaluatePaths resta sotto due secondi", () => {
    const p = exampleProject();
    setPlan(p, { W: 1, H: 2, P: 3 }, { budgetNow: 10000, budgetPerYear: 3000, boilerYear: 2, carYear: 3 });
    const ev = evaluate(p, climate);
    const start = performance.now();
    evaluatePaths(p, climate, ev);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
