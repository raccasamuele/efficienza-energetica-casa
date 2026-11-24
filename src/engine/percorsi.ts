import { evaluateModel, type Evaluation, type PackageResult } from "./scenarios";
import { sizesOf } from "./sizing";
import type { ClimatePackage } from "./climate";
import type { PackageId, PlanInput, ProjectInput } from "./types";

export interface PathResult {
  name: string;
  years: { W: number | null; H: number | null; P: number | null };
  investments: number[];
  flows: number[];
  cumulative: number[];
  npv: number;
  withinBudget: boolean;
  spendingByYear: number[];
  discountedPayback: number | null;
  stability?: { min: number; max: number; best: number; total: number; indistinguishable: boolean };
}

export interface PathsResult {
  proposed: PathResult[];
  custom: PathResult | null;
  budgetKnown: boolean;
  notes: string[];
}

type Block = "W" | "H" | "P";
type Years = PathResult["years"];
type ScenarioKey = "oldNoCar" | "newNoCar" | "oldCar" | "newCar";
type Evaluations = Partial<Record<ScenarioKey, Evaluation>>;

const BLOCKS: Block[] = ["W", "H", "P"];
const PACKAGE_ID: Record<string, PackageId> = {
  "": "base",
  W: "W",
  H: "H",
  P: "P",
  WH: "WH",
  WP: "WP",
  HP: "HP",
  WHP: "WHP",
};
const BLOCK_NAME: Record<Block, string> = {
  W: "involucro",
  H: "impianto",
  P: "FV e batteria",
};

function packageFor(ev: Evaluation, state: Block[]): PackageResult {
  const key = BLOCKS.filter((block) => state.includes(block)).join("");
  const id = PACKAGE_ID[key] ?? "base";
  const result = ev.packages.find((item) => item.id === id);
  if (!result) throw new Error(`Pacchetto ${id} assente dalla valutazione.`);
  return result;
}

function packageIsUsable(result: PackageResult): boolean {
  return result.valid && (result.id === "base" || (result.economicsComplete && !!result.cash));
}

function isKnown(q: { status: string }): boolean {
  return q.status !== "sconosciuto";
}

function pathName(years: Years): string {
  return BLOCKS.map((block) => {
    const year = years[block];
    if (year === null) return `${BLOCK_NAME[block]} mai`;
    if (year === 0) return `subito ${BLOCK_NAME[block]}`;
    const unit = year === 1 ? "anno" : "anni";
    return `${BLOCK_NAME[block]} fra ${year} ${unit}`;
  }).join(", ");
}

function stateBeforeYear(years: Years, year: number): Block[] {
  return BLOCKS.filter((block) => years[block] !== null && years[block]! < year);
}

function stateAfterYear(years: Years, year: number): Block[] {
  return BLOCKS.filter((block) => years[block] !== null && years[block]! <= year);
}

function boilerYear(p: ProjectInput, plan: PlanInput): number | null {
  if (isKnown(plan.boilerYear)) return plan.boilerYear.value;
  return p.heatPump.boilerEndOfLife ? 0 : null;
}

function carYear(p: ProjectInput, plan: PlanInput): number {
  return p.ev.enabled && isKnown(plan.carYear) ? plan.carYear.value : 0;
}

function scenarioKey(boilerNew: boolean, carPresent: boolean): ScenarioKey {
  if (boilerNew) return carPresent ? "newCar" : "newNoCar";
  return carPresent ? "oldCar" : "oldNoCar";
}

function scenarioEvaluation(
  p: ProjectInput,
  climate: ClimatePackage,
  main: Evaluation,
  sizes: ReturnType<typeof sizesOf>,
  boilerNew: boolean,
  carPresent: boolean,
  cache: Evaluations,
): Evaluation {
  const key = scenarioKey(boilerNew, carPresent);
  const cached = cache[key];
  if (cached) return cached;

  const matchesMain = p.heatPump.boilerEndOfLife === boilerNew && p.ev.enabled === carPresent;
  if (matchesMain) {
    cache[key] = main;
    return main;
  }

  const input = structuredClone(p);
  input.heatPump.boilerEndOfLife = boilerNew;
  input.ev.enabled = carPresent;
  const evaluation = evaluateModel(input, climate, 1, sizes);
  cache[key] = evaluation;
  return evaluation;
}

function requiredBoilerStates(yc: number | null, horizon: number): boolean[] {
  if (yc === null || yc >= horizon) return [false];
  if (yc === 0) return [true];
  return [false, true];
}

function requiredCarStates(p: ProjectInput, ya: number, horizon: number): boolean[] {
  if (!p.ev.enabled) return [false];
  if (ya === 0) return [true];
  if (ya >= horizon) return [false];
  return [false, true];
}

function getFlowParts(result: PackageResult) {
  return result.flowParts;
}

function spendingWithinBudget(
  spending: number[],
  plan: PlanInput,
): boolean {
  if (!isKnown(plan.budgetNow) || !isKnown(plan.budgetPerYear)) return true;

  let spent = 0;
  for (let year = 0; year <= 5; year++) {
    spent += spending[year];
    const available = plan.budgetNow.value + year * plan.budgetPerYear.value;
    if (spent > available + 1e-6) return false;
  }
  return true;
}

function discountedPayback(cumulative: number[], initialInvestment: number, flows: number[]): number | null {
  if (initialInvestment <= 0 && flows.every((flow) => flow > 0)) return 0;
  for (let year = 1; year < cumulative.length; year++) {
    const before = cumulative[year - 1];
    const after = cumulative[year];
    if (before < 0 && after >= 0) return year - 1 + -before / (after - before);
  }
  return null;
}

function addBoilerEvent(
  flows: number[],
  years: Years,
  yc: number | null,
  cost: number,
): number {
  if (yc === null || years.H === null || years.H > yc) return 0;
  if (yc > 0 && yc <= flows.length) flows[yc - 1] += cost;
  return yc === 0 ? cost : 0;
}

/** Anno 0 è oggi; lo stato dell'anno t comprende i blocchi installati prima di t. */
function calculatePath(
  p: ProjectInput,
  years: Years,
  evaluations: Evaluations,
  grossEvaluation: Evaluation,
): PathResult {
  const plan = p.plan!;
  const horizon = Math.round(p.economics.horizonYears.value);
  const rate = p.economics.realDiscountRate.value;
  const yc = boilerYear(p, plan);
  const ya = carYear(p, plan);
  const investments = Array(6).fill(0) as number[];
  const flows = Array(horizon).fill(0) as number[];
  const spending = Array(6).fill(0) as number[];

  // Gli investimenti sono lordi, ricavati da investmentTotal: l'evento caldaia è separato.
  let previousState: Block[] = [];
  for (let year = 0; year <= 5; year++) {
    const nextState = stateAfterYear(years, year);
    const previousPackage = packageFor(grossEvaluation, previousState);
    const nextPackage = packageFor(grossEvaluation, nextState);
    investments[year] = nextPackage.investmentTotal - previousPackage.investmentTotal;
    previousState = nextState;
  }

  // I benefici partono dall'anno successivo all'installazione.
  for (let year = 1; year <= horizon; year++) {
    const state = stateBeforeYear(years, year);
    const boilerNew = yc !== null && year > yc;
    const carPresent = p.ev.enabled && year > ya;
    const evaluation = evaluations[scenarioKey(boilerNew, carPresent)];
    if (!evaluation) throw new Error("Valutazione di stato necessaria mancante.");

    const parts = getFlowParts(packageFor(evaluation, state));
    if (!parts) continue;
    flows[year - 1] = parts.annualBenefit;

    if (state.includes("P") && years.P !== null) {
      flows[year - 1] += parts.ageing[year - years.P - 1] ?? 0;
    }

    for (const block of state) {
      for (const replacement of parts.replacements) {
        if (replacement.block === block && replacement.year === year - years[block]!) {
          flows[year - 1] -= replacement.amount;
        }
      }
    }
  }

  const avoidsBoiler = yc !== null && years.H !== null && years.H <= yc;
  const boilerCost = avoidsBoiler ? p.heatPump.boilerReplacementCost.value : 0;
  const yearZeroEvent = addBoilerEvent(flows, years, yc, boilerCost);

  for (let year = 0; year <= 5; year++) {
    spending[year] = Math.max(0, investments[year]);
  }
  if (yc !== null && !avoidsBoiler && yc <= 5) {
    spending[yc] += p.heatPump.boilerReplacementCost.value;
  }

  const cumulative = [-investments[0] + yearZeroEvent];
  for (let year = 1; year <= horizon; year++) {
    const investment = year <= 5 ? investments[year] : 0;
    const flow = flows[year - 1];
    const previous = cumulative[year - 1];
    cumulative.push(previous + (flow - investment) / (1 + rate) ** year);
  }
  const npv = discountedPathNpv(investments, flows, rate) + yearZeroEvent;

  return {
    name: pathName(years),
    years: { ...years },
    investments,
    flows,
    cumulative,
    npv,
    withinBudget: spendingWithinBudget(spending, plan),
    spendingByYear: spending,
    discountedPayback: discountedPayback(cumulative, investments[0] - yearZeroEvent, flows),
  };
}

export function discountedPathNpv(investments: number[], flows: number[], rate: number): number {
  let value = 0;
  for (let year = 0; year < investments.length; year++) {
    value -= investments[year] / (1 + rate) ** year;
  }
  for (let year = 1; year <= flows.length; year++) {
    value += flows[year - 1] / (1 + rate) ** year;
  }
  return value;
}

export function pathNpvForVariant(p: ProjectInput, ev: Evaluation, path: PathResult): number {
  const plan = p.plan!;
  const years = path.years;
  const rate = p.economics.realDiscountRate.value;
  const horizon = Math.round(p.economics.horizonYears.value);
  const yc = boilerYear(p, plan);
  const investments = Array(6).fill(0) as number[];
  const flows = Array(horizon).fill(0) as number[];

  let previousState: Block[] = [];
  for (let year = 0; year <= 5; year++) {
    const nextState = stateAfterYear(years, year);
    investments[year] = packageFor(ev, nextState).investmentTotal - packageFor(ev, previousState).investmentTotal;
    previousState = nextState;
  }

  for (let year = 1; year <= horizon; year++) {
    const state = stateBeforeYear(years, year);
    const parts = getFlowParts(packageFor(ev, state));
    if (!parts) continue;
    flows[year - 1] = parts.annualBenefit;
    if (state.includes("P") && years.P !== null) flows[year - 1] += parts.ageing[year - years.P - 1] ?? 0;
    for (const block of state) {
      for (const replacement of parts.replacements) {
        if (replacement.block === block && replacement.year === year - years[block]!) {
          flows[year - 1] -= replacement.amount;
        }
      }
    }
  }

  const avoidsBoiler = yc !== null && years.H !== null && years.H <= yc;
  const yearZeroEvent = addBoilerEvent(flows, years, yc, avoidsBoiler ? p.heatPump.boilerReplacementCost.value : 0);
  return discountedPathNpv(investments, flows, rate) + yearZeroEvent;
}

export function evaluatePaths(p: ProjectInput, climate: ClimatePackage, ev: Evaluation): PathsResult {
  const plan = p.plan ?? {
    budgetNow: { value: 0, status: "sconosciuto" },
    budgetPerYear: { value: 0, status: "sconosciuto" },
    boilerYear: { value: 0, status: "sconosciuto" },
    carYear: { value: 0, status: "ipotizzato" },
    custom: { W: null, H: null, P: null },
  } as PlanInput;
  const input = { ...p, plan };
  const yc = boilerYear(input, plan);
  const ya = carYear(input, plan);
  const horizon = Math.round(p.economics.horizonYears.value);
  const boilerStates = requiredBoilerStates(yc, horizon);
  const carStates = requiredCarStates(p, ya, horizon);
  const sizes = sizesOf(ev);
  const evaluations: Evaluations = {};

  // Si calcolano soltanto gli stati presenti nel calendario; ev viene riusata quando coincide.
  for (const boilerNew of boilerStates) {
    for (const carPresent of carStates) {
      scenarioEvaluation(p, climate, ev, sizes, boilerNew, carPresent, evaluations);
    }
  }
  const grossEvaluation = Object.values(evaluations)[0] ?? ev;

  const active = BLOCKS.filter((block) => {
    const result = ev.packages.find((item) => item.id === block);
    return !!result && packageIsUsable(result);
  });
  const choices: (number | null)[] = [null, 0, 1, 2, 3, 4, 5];
  const feasible: PathResult[] = [];

  function enumerate(index: number, years: Years): void {
    if (index === active.length) {
      if (Object.values(years).every((year) => year === null)) return;
      const path = calculatePath(input, years, evaluations, grossEvaluation);
      if (path.withinBudget) feasible.push(path);
      return;
    }

    const block = active[index];
    for (const year of choices) {
      enumerate(index + 1, { ...years, [block]: year });
    }
  }

  enumerate(0, { W: null, H: null, P: null });

  const nonDominated = feasible.filter((path) => !feasible.some((other) => {
    if (other === path) return false;
    const noWorse = other.npv >= path.npv - 1e-6 && other.spendingByYear[0] <= path.spendingByYear[0] + 1e-6;
    const strictlyBetter = other.npv > path.npv + 1e-6 || other.spendingByYear[0] < path.spendingByYear[0] - 1e-6;
    return noWorse && strictlyBetter;
  }));

  const ranked = [...nonDominated].sort((a, b) => b.npv - a.npv);
  const proposed: PathResult[] = [];
  const addProposed = (path: PathResult | undefined) => {
    if (!path) return;
    if (proposed.some((item) => JSON.stringify(item.years) === JSON.stringify(path.years))) return;
    if (proposed.some((item) => Math.abs(item.npv - path.npv) <= 1)) return;
    proposed.push(path);
  };

  addProposed(ranked[0]);
  addProposed([...nonDominated].sort((a, b) => a.spendingByYear[0] - b.spendingByYear[0])[0]);
  for (const path of ranked) {
    if (proposed.length >= 4) break;
    addProposed(path);
  }

  // Il percorso dell'utente passa per gli stati dei suoi anni: se uno di questi pacchetti non ha i conti completi
  // (costi sconosciuti), mancherebbero i risparmi ma resterebbero i costi noti, e il VAN verrebbe solo negativo.
  const incomplete = BLOCKS.filter((block) => plan.custom[block] !== null && !active.includes(block));
  const customUsable = [0, 1, 2, 3, 4, 5].every((year) => {
    const state = stateAfterYear(plan.custom, year);
    return !state.length || packageIsUsable(packageFor(ev, state));
  });
  const custom = customUsable ? calculatePath(input, plan.custom, evaluations, grossEvaluation) : null;
  const budgetKnown = isKnown(plan.budgetNow) && isKnown(plan.budgetPerYear);
  const missing = incomplete.map((block) => BLOCK_NAME[block]);
  const notes = [
    ...(budgetKnown ? [] : ["Budget non indicato: i percorsi proposti non hanno un vincolo di spesa."]),
    ...(customUsable ? [] : [`Il tuo percorso (${pathName(plan.custom)}) non si calcola: ${missing.length ? `mancano i costi di ${missing.join(" e ")}` : "una combinazione di interventi non ha i conti completi"}. Completa i preventivi oppure togli quegli interventi dal percorso.`]),
  ];
  return { proposed, custom, budgetKnown, notes };
}

/** Stabilità con le stesse varianti della sensibilità, senza modificare le valutazioni ricevute. */
export function pathsWithStability(p: ProjectInput, climate: ClimatePackage, ev: Evaluation, samples: readonly Evaluation[]): PathsResult {
  const result = evaluatePaths(p, climate, ev);
  const shown = [...result.proposed, ...(result.custom ? [result.custom] : [])];
  const rows = shown.map((path) => samples.map((v) => pathNpvForVariant(p, v, path)));
  const ranges = rows.map((a, i) => a.length ? { min: Math.min(...a), max: Math.max(...a) } : { min: shown[i].npv, max: shown[i].npv });
  const bestCounts = shown.map((_path, i) => samples.reduce((count, v) => {
    const values = shown.map((path) => pathNpvForVariant(p, v, path));
    const best = Math.max(...values);
    return count + (values[i] >= best - 1e-6 ? 1 : 0);
  }, 0));
  const bestRange = ranges[0];
  shown.forEach((path, i) => {
    const r = ranges[i];
    path.stability = { ...r, best: bestCounts[i], total: samples.length, indistinguishable: r.min <= bestRange.max && r.max >= bestRange.min };
  });
  return result;
}
