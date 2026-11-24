import { describe, expect, it } from "vitest";
import { CLASS_MID, CLASS_PREMIUM, CLASS_UPPER, ENERGY_CLASSES, PRIMARY_FACTORS, classOfRatio, classPremium, evaluate, evaluateModel, exampleProject, packagePv, parseComuni, parseProjectFile, premiumColumn, primaryEnergy, pvProduction, q, toProjectFile, withHomeValue, type Evaluation, type PackageId, type ProjectInput } from "../src/engine";
import { evaluationForGoal } from "../src/ui/goals";
import before from "./fixtures/involucro-prima.json";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const climate = loadMilanoLegacy();
const comuni = parseComuni(readPublicJson("comuni.json"));
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((r) => r.id === id)!;
const scenario = () => {
  const p = exampleProject();
  p.economics.homeValue = { enabled: true, energyClass: "E", marketValue: q(300000, "ipotizzato", "Stima dell'utente") };
  return p;
};

function originalNumbers(p: ProjectInput, name: string) {
  const ev = evaluate(p, climate), ref = before.find((x) => x.name === name)!;
  expect(ev.ok).toBe(true);
  expect(ev.calibration?.factor ?? null).toBe(ref.calibrationFactor);
  for (const old of ref.packages) {
    const r = pk(ev, old.id as PackageId);
    expect(r.label).toBe(old.label);
    for (const key of ["heatNeed_kWh", "peak_kW", "gasSmc", "investment", "annualBenefit"] as const) expect(r[key]).toBeCloseTo(old[key], 9);
    expect(r.elec.import_kWh).toBeCloseTo(old.import_kWh, 9);
    if (old.npv === null) expect(r.cash?.npv ?? null).toBeNull();
    else expect(r.cash!.npv).toBeCloseTo(old.npv, 9);
  }
}

describe("Classi e premi del valore della casa", () => {
  it("rispetta i limiti compresi delle classi", () => {
    for (const [ratio, expected] of [[.4, "A4"], [.41, "A3"], [1, "A1"], [1.2, "B"], [2.6, "E"], [3.5, "F"], [3.51, "G"]] as const) expect(classOfRatio(ratio)).toBe(expected);
    expect(ENERGY_CLASSES).toEqual(["A4", "A3", "A2", "A1", "B", "C", "D", "E", "F", "G"]);
    expect(CLASS_UPPER.G).toBe(Infinity);
    expect(CLASS_MID.F).toBe(3.05);
  });
  it("usa i coefficienti pubblicati, anche B maggiore di A in zona AB", () => {
    expect(classPremium("E", "A1")).toBe(.282);
    expect(classPremium("E", "A4")).toBe(.282);
    expect(classPremium("E", "G")).toBe(0);
    expect(CLASS_PREMIUM.italia.D).toBe(.106);
    expect(classPremium("AB", "B")).toBeGreaterThan(classPremium("AB", "A1"));
    const p = exampleProject();
    expect(premiumColumn(p)).toBe("E");
    for (const zone of ["A", "B"] as const) { p.location.zone = zone; expect(premiumColumn(p)).toBe("AB"); }
    p.location.localOverride = { zone: "D", gg: 1800, alt: 122, source: "Atto locale dichiarato" };
    expect(premiumColumn(p)).toBe("D");
  });
  it("F → D: premio e attualizzazione calcolati a mano", () => {
    const p = scenario(); p.economics.homeValue.energyClass = "F";
    const ev = evaluateModel(p, climate);
    const gas = (value: number) => [{ service: "Riscaldamento" as const, carrier: "gas" as const, generator: "Caldaia", final_kWh: value }];
    const base = { ...pk(ev, "base"), services: gas(1000) };
    const work = { ...pk(ev, "W"), services: gas(1000 * 1.75 / 3.05) };
    const row = withHomeValue(p, climate, { ...ev, packages: [base, work] }).homeValue!.rows[0];
    const premium = Math.exp(.129 - .048) - 1;
    const eur = 300000 * premium, pv = eur / Math.pow(1.03, 20);
    expect(row.classAfter).toBe("D");
    expect(row.premiumPct).toBeCloseTo(premium * 100, 10);
    expect(row.premiumPct).toBeCloseTo(8.437, 3);
    expect(row.premiumEur).toBeCloseTo(eur, 8);
    expect(Math.abs(row.premiumEur! - 25311)).toBeLessThanOrEqual(1);
    expect(row.presentValue).toBeCloseTo(pv, 8);
    expect(Math.abs(row.presentValue! - 14014)).toBeLessThanOrEqual(1);
  });
});

describe("Energia primaria non rinnovabile", () => {
  it("base, H e HP: gas dei servizi e FV della stessa ora, senza cucina", () => {
    const p = exampleProject(), ev = evaluate(p, climate);
    const base = pk(ev, "base"), h = pk(ev, "H"), hp = pk(ev, "HP");
    const gas = (r: typeof base) => r.services.filter((s) => s.carrier === "gas" && (s.service === "Riscaldamento" || s.service === "ACS")).reduce((sum, s) => sum + s.final_kWh, 0);
    const pv = pvProduction(climate, p.pv.plane, hp.pvKwp, p.pv.lossPct.value);
    expect(PRIMARY_FACTORS).toEqual({ gas: 1.05, elettricita: 1.95 });
    expect(primaryEnergy(p, climate, base)).toBeCloseTo(gas(base) * 1.05, 9);
    expect(primaryEnergy(p, climate, h)).toBeCloseTo(gas(h) * 1.05 + h.hp!.elec.reduce((sum, x) => sum + Math.max(0, x), 0) / 1000 * 1.95, 9);
    const hand = gas(hp) * 1.05 + hp.hp!.elec.reduce((sum, x, i) => sum + Math.max(0, x - pv[i]), 0) / 1000 * 1.95;
    expect(primaryEnergy(p, climate, hp)).toBeCloseTo(hand, 9);
    expect(primaryEnergy(p, climate, hp)).toBeLessThan(primaryEnergy(p, climate, h));
    const extra = { ...hp, services: [...hp.services, { service: "Cucina" as const, carrier: "gas" as const, generator: "Gas", final_kWh: 999999 }] };
    expect(primaryEnergy(p, climate, extra)).toBe(primaryEnergy(p, climate, hp));
  });
  it("FV esistente e raffrescamento: assegna la produzione prima ai servizi, ignora altri usi e batteria", () => {
    const p = exampleProject(); p.existingPv.present = true; p.cooling.today = "split";
    const ev = evaluate(p, climate), r = pk(ev, "H"), pv = packagePv(climate, p, false)!;
    const gas = r.services.filter((s) => s.carrier === "gas" && s.service !== "Cucina").reduce((sum, s) => sum + s.final_kWh, 0);
    const elec = pv.reduce((sum, production, i) => sum + Math.max(0, r.hp!.elec[i] + r.cooling!.elec[i] - production), 0);
    expect(primaryEnergy(p, climate, r)).toBeCloseTo(gas * 1.05 + elec / 1000 * 1.95, 9);
    const battery = pk(ev, "HP");
    expect(primaryEnergy(p, climate, battery)).toBe(primaryEnergy(p, climate, r));
  });
});

describe("Scenario separato e compatibilità", () => {
  for (const name of ["esempio", "split", "serramenti"]) it(`scenario spento: ${name} identico alla fixture`, () => {
    const p = exampleProject();
    if (name === "split") p.cooling.today = "split";
    if (name === "serramenti") p.goal = "serramenti";
    originalNumbers(p, name);
    expect(evaluate(p, climate).homeValue).toBeNull();
    expect(evaluate(p, climate).homeValueNote).toBeNull();
  });
  it("scenario acceso: stessi pacchetti e nessun valore aggiunto nel calcolo del modello", () => {
    const p = scenario(), on = evaluate(p, climate);
    p.economics.homeValue.enabled = false;
    const off = evaluate(p, climate);
    expect(on.packages).toEqual(off.packages);
    expect(on.calibration).toEqual(off.calibration);
    expect(on.homeValue!.rows.map((r) => r.id)).toEqual(on.packages.filter((r) => r.valid && r.id !== "base").map((r) => r.id));
    expect(evaluateModel({ ...p, economics: { ...p.economics, homeValue: { ...p.economics.homeValue, enabled: true } } }, climate).homeValue).toBeNull();
    for (const row of on.homeValue!.rows) expect(row.npvWithValue).toBeCloseTo(row.npv! + row.presentValue!, 9);
  });
  it("esempio E: W, H e WH non peggiorano la classe", () => {
    const p = scenario(), ev = evaluate(p, climate);
    for (const id of ["W", "H", "WH"] as const) {
      const row = ev.homeValue!.rows.find((r) => r.id === id)!;
      expect(ENERGY_CLASSES.indexOf(row.classAfter)).toBeLessThanOrEqual(ENERGY_CLASSES.indexOf("E"));
    }
  });
  it("il cappotto non peggiora la classe di W e il percorso serramenti filtra le righe", () => {
    const p = scenario(), first = evaluate(p, climate).homeValue!.rows.find((r) => r.id === "W")!;
    p.envelope.walls.enabled = true;
    const ev = evaluate(p, climate), after = ev.homeValue!.rows.find((r) => r.id === "W")!;
    expect(ENERGY_CLASSES.indexOf(after.classAfter)).toBeLessThanOrEqual(ENERGY_CLASSES.indexOf(first.classAfter));
    expect(evaluationForGoal(ev, "serramenti").homeValue!.rows.map((r) => r.id)).toEqual(["W"]);
  });
  it("ipotesi F e valore sconosciuto o nullo: percentuali senza euro", () => {
    const p = scenario(); p.economics.homeValue.energyClass = "nonSo"; p.economics.homeValue.marketValue.status = "sconosciuto";
    const ev = evaluate(p, climate);
    expect(ev.homeValue!.classAssumed).toBe(true);
    for (const row of ev.homeValue!.rows) {
      expect(row.classBefore).toBe("F");
      expect(Number.isFinite(row.premiumPct)).toBe(true);
      expect([row.premiumEur, row.presentValue, row.npvWithValue]).toEqual([null, null, null]);
    }
    p.economics.homeValue.marketValue = q(0);
    expect(evaluate(p, climate).homeValue!.rows.every((r) => r.premiumEur === null)).toBe(true);
  });
  it("economia incompleta, pacchetti bloccati e base primaria nulla", () => {
    const p = scenario(); p.windows.cost.items[0].status = "sconosciuto";
    const ev = evaluate(p, climate), w = ev.homeValue!.rows.find((r) => r.id === "W")!;
    expect(w.npv).toBeNull(); expect(w.npvWithValue).toBeNull(); expect(w.presentValue).not.toBeNull();
    const invalid = { ...pk(ev, "H"), valid: false };
    expect(withHomeValue(p, climate, { ...ev, packages: [pk(ev, "base"), invalid] }).homeValue!.rows).toEqual([]);
    const noHeat = { ...pk(ev, "base"), services: [], hp: undefined, cooling: undefined };
    const empty = withHomeValue(p, climate, { ...ev, packages: [noHeat] });
    expect(empty.homeValue).toBeNull();
    expect(empty.homeValueNote).toBe("Senza riscaldamento a gas o elettrico nel modello non si può stimare la classe dopo i lavori.");
    expect(withHomeValue(p, climate, { ...evaluateModel(p, climate), ok: false }).homeValue).toBeNull();
  });
  it("incentivo e taratura restano separati dal valore", () => {
    const p = scenario(); p.consumption.gasSmcObserved = q(2000, "documentato", "Bolletta");
    const nominal = evaluate(p, climate);
    Object.assign(p.economics.incentive, { enabled: true, source: "Regola dell'utente", date: "2026-11-05" });
    p.economics.incentive.windowsPct = q(50);
    const ev = evaluate(p, climate);
    expect(ev.homeValue).toEqual(nominal.homeValue);
    expect(ev.incentive).not.toBeNull();
    expect(ev.calibration).toEqual(nominal.calibration);
    expect(ev.homeValue!.rows.find((r) => r.id === "W")!.npv).toBe(pk(ev, "W").cash!.npv);
  });
  it("progetto precedente senza avvisi, enum e intervallo del valore", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), climate)));
    delete file.input.economics.homeValue;
    const parsed = parseProjectFile(JSON.stringify(file), climate, comuni);
    expect(parsed.errors).toEqual([]); expect(parsed.warnings).toEqual([]);
    originalNumbers(parsed.file!.input, "esempio");
    const bad = JSON.parse(JSON.stringify(toProjectFile(scenario(), climate)));
    bad.input.economics.homeValue.energyClass = "Z";
    expect(parseProjectFile(JSON.stringify(bad), climate, comuni).errors.join(" ")).toContain("energyClass");
    const p = scenario(); p.economics.homeValue.marketValue.value = -1;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni).errors.join(" ")).toContain("Valore di mercato della casa");
    p.economics.homeValue.enabled = false;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni).errors).toEqual([]);
  });
});
