import { describe, expect, it } from "vitest";
import {
  batteryEstimate,
  batteryLife,
  batteryReplacementEstimate,
  evaluate,
  evaluateModel,
  exampleProject,
  exportConsumptionCurve,
  gridImportSeries,
  kneeIndex,
  maxKwpForRoof,
  parseProjectFile,
  pvEstimate,
  quoteSizeNotes,
  runSensitivity,
  sizesOf,
  toProjectFile,
  type Evaluation,
  type PackageId,
  type ProjectInput,
} from "../src/engine";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;
const sz = (ev: Evaluation, id: PackageId) => ev.sizing!.find((x) => x.id === id)!;

function indicative(battery = false, goal: ProjectInput["goal"] = "fv"): ProjectInput {
  const p = exampleProject();
  p.pv.sizing = "indicativa";
  p.battery.enabled = battery;
  p.goal = goal;
  return p;
}

/** Batteria economica: scenario costruito apposta perché convenga, solo per provare il caso. */
function cheapBattery(p: ProjectInput) {
  p.battery.pricePerKwh.value = 120;
  p.battery.fixedCost.value = 0;
  p.battery.retrofitFixedCost.value = 0;
  p.battery.replacementPerKwh.value = 60;
  p.battery.replacementFixed.value = 0;
  return p;
}

/** Lo stesso progetto con un preventivo pari alla stima, calcolato dal motore come farebbe l'utente. */
function asQuote(p: ProjectInput, kWp: number, capacity: number): number {
  const q = structuredClone(p);
  q.pv.sizing = "preventivo";
  q.pv.kWp.value = kWp;
  q.pv.cost = { ...q.pv.cost, items: [{ label: "FV", amount: { value: pvEstimate(p, kWp), status: "ipotizzato" }, status: "incluso" }], forSize: kWp };
  q.battery.enabled = capacity > 0;
  if (capacity > 0) {
    q.battery.capacityKwh.value = capacity;
    q.battery.cost = { ...q.battery.cost, items: [{ label: "Batteria", amount: { value: batteryEstimate(p, capacity), status: "ipotizzato" }, status: "incluso" }], forSize: capacity };
    const cycles = pk(evaluate(q, milano), "P").battery!.cyclesPerYear;
    const life = batteryLife(q.battery.lifeYears.value, q.battery.lifeCycles.value, cycles, 20);
    q.battery.replacements = life.replacementYears.map((year) => ({ label: "Sostituzione", year, amount: { value: batteryReplacementEstimate(p, capacity), status: "ipotizzato" } }));
  }
  return pk(evaluate(q, milano), "P").cash!.npv;
}

describe("Gomito di una curva", () => {
  it("su una curva che sale e si appiattisce trova il punto più lontano dalla corda", () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const ys = xs.map((x) => 1 - Math.exp(-x / 1.5));
    // calcolato a mano: y/y(8) − x/8 vale 0,364 a x = 1, 0,490 a x = 2, 0,494 a x = 3, 0,435 a x = 4
    expect(xs[kneeIndex(xs, ys)]).toBe(3);
  });
  it("una retta non ha gomito: si prende il primo punto; due punti: il primo", () => {
    expect(kneeIndex([1, 2, 3, 4], [10, 20, 30, 40])).toBe(0);
    expect(kneeIndex([1, 2], [5, 9])).toBe(0);
  });
});

describe("Ricerca congiunta della scelta economica", () => {
  it("con il preventivo nessuna ricerca e risultati invariati", () => {
    const ev = evaluate(exampleProject(), milano);
    expect(ev.sizing).toBeNull();
    expect(pk(ev, "P").pvKwp).toBe(4);
  });

  it("coincide con una griglia esaustiva indipendente, calcolata dal motore combinazione per combinazione", () => {
    const p = cheapBattery(indicative(true));
    p.pv.roofArea.value = 8.25; // 1,5 kWp al massimo: griglia piccola, provata tutta
    const s = sz(evaluate(p, milano), "P");
    expect(new Set(s.combos.map((c) => c.kWp))).toEqual(new Set([1, 1.5]));
    let best = { kWp: 0, capacity: 0, npv: -Infinity };
    for (const c of s.combos) {
      const npv = asQuote(p, c.kWp, c.capacity);
      expect(c.npv).toBeCloseTo(npv, 3);
      if (npv > best.npv) best = { kWp: c.kWp, capacity: c.capacity, npv };
    }
    expect({ kWp: s.economic.kWp, capacity: s.economic.capacity }).toEqual({ kWp: best.kWp, capacity: best.capacity });
    expect(s.economic.capacity).toBeGreaterThan(0);
  }, 120_000);

  it("batteria assente quando è la scelta economica migliore; il pacchetto e la curva CER restano senza accumulo", () => {
    const p = indicative(true);
    const ev = evaluate(p, milano);
    const s = sz(ev, "P");
    expect(s.economic.capacity).toBe(0);
    expect(s.allNegative).toBe(false);
    expect(s.combos.some((c) => c.capacity > 0)).toBe(true);
    expect(pk(ev, "P").battery).toBeUndefined();
    expect(pk(ev, "P").pvKwp).toBe(s.economic.kWp);
    const f = exportConsumptionCurve(p, milano, pk(ev, "P"));
    expect(f.versione).toBe(2);
    expect(f.fv_sottratto_kwp).toBe(s.economic.kWp);
    // l'alternativa per autonomia ha una batteria e un VAN più basso
    expect(s.energetic.capacity).toBeGreaterThan(0);
    expect(s.energetic.npv).toBeLessThan(s.economic.npv);
  });

  it("nessun intervento quando tutte le alternative sono peggiori: lo dice chiaramente", () => {
    const p = indicative(true);
    p.pv.pricePerKwp.value = 5000;
    const ev = evaluate(p, milano);
    const s = sz(ev, "P");
    expect(s.allNegative).toBe(true);
    expect(s.combos.every((c) => c.npv < 0)).toBe(true);
    expect(pk(ev, "P").conditions.join(" ")).toContain("conviene non fare nulla");
  });

  it("i kWp non superano mai il tetto, il gomito non dipende dal tetto", () => {
    const p = indicative();
    p.pv.roofArea.value = 11;
    expect(maxKwpForRoof(p)).toBe(2);
    const s = sz(evaluate(p, milano), "P");
    expect(Math.max(...s.combos.map((c) => c.kWp))).toBe(2);
    expect(s.economic.kWp).toBeLessThanOrEqual(2);
    expect(s.energetic.kWp).toBe(Math.min(s.kneeKwp!, 2));
    p.pv.roofArea.value = 200;
    expect(sz(evaluate(p, milano), "P").kneeKwp).toBe(s.kneeKwp);
    p.pv.roofArea.value = 4;
    expect(evaluate(p, milano).ok).toBe(false);
  });

  it("FV esistente: kWp fissi, si ottimizza solo l'accumulo con la parte fissa da batteria aggiunta", () => {
    const p = cheapBattery(indicative(false, "batteria"));
    p.existingPv.present = true;
    p.battery.retrofitFixedCost.value = 300;
    const ev = evaluate(p, milano);
    const s = sz(ev, "P");
    expect(new Set(s.combos.map((c) => c.kWp))).toEqual(new Set([p.existingPv.kWp.value]));
    expect(s.pv).toEqual([]);
    expect(s.economic.capacity).toBeGreaterThan(0);
    expect(pk(ev, "P").investment).toBeCloseTo(120 * s.economic.capacity + 300, 6);
  });

  it("nel percorso FV si cerca solo il pacchetto mostrato; nel quadro completo tutti quelli con il FV", () => {
    expect(evaluate(indicative(true, "fv"), milano).sizing!.map((x) => x.id)).toEqual(["P"]);
    expect(evaluate(indicative(true, "completo"), milano).sizing!.map((x) => x.id).sort()).toEqual(["HP", "P", "WHP", "WP"]);
  });
});

describe("Costi coerenti fra dimensionamento e flussi", () => {
  it("investimento del pacchetto dal modello di costo; VAN uguale alla combinazione scelta", () => {
    const p = cheapBattery(indicative(true));
    const ev = evaluate(p, milano);
    const s = sz(ev, "P");
    const r = pk(ev, "P");
    expect(r.investment).toBeCloseTo(pvEstimate(p, s.economic.kWp) + batteryEstimate(p, s.economic.capacity), 6);
    expect(r.cash!.npv).toBeCloseTo(s.economic.npv, 3);
  });

  it("la sostituzione costa moduli e manodopera, non l'installazione iniziale", () => {
    expect(batteryEstimate(exampleProject(), 5)).toBe(5 * 600 + 700);
    expect(batteryReplacementEstimate(exampleProject(), 5)).toBe(5 * 450 + 300);
    const retro = exampleProject();
    retro.existingPv.present = true;
    expect(batteryEstimate(retro, 5)).toBe(5 * 600 + 1500);
  });

  it("l'esempio con il preventivo ha la batteria da 5 kWh con gli stessi scenari di costo", () => {
    const p = exampleProject();
    const total = p.battery.cost.items.filter((it) => it.status === "incluso").reduce((a, it) => a + it.amount.value, 0);
    expect(p.battery.capacityKwh.value).toBe(5);
    expect(total).toBe(batteryEstimate(p, 5));
    expect(p.battery.cost.forSize).toBe(5);
    expect(p.battery.replacements).toEqual([expect.objectContaining({ year: 15, amount: expect.objectContaining({ value: batteryReplacementEstimate(p, 5) }) })]);
  });
});

describe("Garanzia, degrado e vita operativa", () => {
  const withBattery = () => {
    const p = exampleProject();
    p.battery.enabled = true;
    return p;
  };
  it("la sostituzione cade a fine vita operativa, non a fine garanzia; la garanzia non cambia i conti", () => {
    const r = pk(evaluate(withBattery(), milano), "P").battery!;
    expect(r.replacementYears).toEqual([15]);
    expect(r.uncoveredReplacementYears).toEqual([]);
    const shorter = withBattery();
    shorter.battery.warrantyYears.value = 5;
    expect(pk(evaluate(shorter, milano), "P").cash!.npv).toBe(pk(evaluate(withBattery(), milano), "P").cash!.npv);
  });
  it("con una vita operativa di 10 anni la sostituzione inserita a 15 non basta: avviso", () => {
    const p = withBattery();
    p.battery.lifeYears.value = 10;
    const r = pk(evaluate(p, milano), "P");
    expect(r.battery!.replacementYears).toEqual([10]);
    expect(r.conditions.join(" ")).toMatch(/fine vita verso l'anno 10/);
  });
  it("il degrado è un'ipotesi separata: cambiarlo cambia il VAN, non la vita né le sostituzioni", () => {
    const a = withBattery();
    const b = withBattery();
    b.battery.fadePctPerYear.value = 0;
    const ra = pk(evaluate(a, milano), "P");
    const rb = pk(evaluate(b, milano), "P");
    expect(rb.cash!.npv).toBeGreaterThan(ra.cash!.npv);
    expect(rb.battery!.replacementYears).toEqual(ra.battery!.replacementYears);
  });
  it("beneficio marginale della taglia successiva = differenza del motore fra le due capacità", () => {
    const r = pk(evaluate(withBattery(), milano), "P");
    const q = withBattery();
    q.battery.capacityKwh.value = 7.5;
    const r2 = pk(evaluate(q, milano), "P");
    expect(r.battery!.nextStep.capacity).toBe(7.5);
    expect(r.battery!.nextStep.extraBenefit).toBeCloseTo(r2.annualBenefit - r.annualBenefit, 6);
    expect(r.battery!.nextStep.extraBenefit).toBeGreaterThan(0);
  });
});

describe("Preventivo da riverificare", () => {
  it("se la capacità cambia dopo il preventivo c'è un avviso persistente, gli importi restano quelli dell'utente", () => {
    const p = exampleProject();
    p.battery.enabled = true;
    expect(quoteSizeNotes(p)).toEqual([]);
    p.battery.capacityKwh.value = 10;
    expect(quoteSizeNotes(p)).toHaveLength(1);
    const r = pk(evaluate(p, milano), "P");
    expect(r.conditions.join(" ")).toContain("vanno riverificati");
    expect(r.battery!.investment).toBe(3700);
    p.battery.cost.forSize = 10;
    expect(quoteSizeNotes(p)).toEqual([]);
    p.battery.cost.forSize = 0;
    expect(quoteSizeNotes(p)).toEqual([]);
    p.pv.kWp.value = 6;
    expect(quoteSizeNotes(p)[0]).toContain("FV");
  });
  it("nessun avviso con la taglia indicativa", () => {
    const p = indicative(true);
    p.battery.capacityKwh.value = 12;
    expect(quoteSizeNotes(p)).toEqual([]);
  });
});

describe("Compatibilità con i progetti precedenti", () => {
  it("un file del motore 0.4 si apre senza reinterpretare preventivo, vita e degrado salvati", () => {
    const old = exampleProject() as unknown as { battery: Record<string, unknown> & { cost: Record<string, unknown> }; pv: { cost: Record<string, unknown> }; windows: { cost: Record<string, unknown> }; heatPump: { cost: Record<string, unknown> } };
    old.battery.enabled = true;
    old.battery.capacityKwh = { value: 10, status: "ipotizzato" };
    old.battery.lifeYears = { value: 10, status: "ipotizzato" };
    old.battery.fadePctPerYear = { value: 3, status: "ipotizzato" };
    for (const k of ["warrantyYears", "fixedCost", "retrofitFixedCost", "replacementPerKwh", "replacementFixed"]) delete old.battery[k];
    for (const c of [old.battery.cost, old.pv.cost, old.windows.cost, old.heatPump.cost]) delete c.forSize;
    const file = { ...toProjectFile(old as unknown as ProjectInput, milano), engineVersion: "0.4.0" };
    const r = parseProjectFile(JSON.stringify(file), milano);
    expect(r.errors).toEqual([]);
    const input = r.file!.input;
    expect(input.battery.capacityKwh.value).toBe(10);
    expect(input.battery.lifeYears.value).toBe(10);
    expect(input.battery.fadePctPerYear.value).toBe(3);
    expect(input.battery.cost.forSize).toBe(0);
    expect(quoteSizeNotes(input)).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/warrantyYears/);
  });
  it("un file senza la scelta della taglia si apre con il preventivo", () => {
    const file = toProjectFile(exampleProject(), milano) as unknown as { input: { pv: Record<string, unknown> } };
    delete file.input.pv.sizing;
    expect(parseProjectFile(JSON.stringify(file), milano).file!.input.pv.sizing).toBe("preventivo");
  });
});

describe("Taglia indicativa nel resto del calcolo", () => {
  it("con le taglie fissate il calcolo non le cambia; la curva CER usa la taglia scelta", () => {
    const p = cheapBattery(indicative(true));
    const ev = evaluate(p, milano);
    const q = structuredClone(p);
    q.pv.roofArea.value = 200;
    const fixed = evaluateModel(q, milano, 1, sizesOf(ev));
    expect(pk(fixed, "P").pvKwp).toBe(pk(ev, "P").pvKwp);
    const f = exportConsumptionCurve(p, milano, pk(ev, "P"));
    expect(f.batteria_kwh).toBe(sz(ev, "P").economic.capacity);
    expect(gridImportSeries(p, milano, pk(ev, "P")).reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(pk(ev, "P").elec.import_kWh, 6);
  });

  it("la sensibilità dà l'intervallo della scelta fra i tre profili e prova gli scenari della batteria", () => {
    const p = indicative(true);
    const ev = evaluate(p, milano);
    const sens = runSensitivity(p, milano, ev, ["base", "P"]);
    expect(sens.sizeRange!.find((x) => x.id === "P")).toBeDefined();
    expect(sens.variants.map((v) => v.id)).toEqual(expect.arrayContaining(["bprice400", "bprice900", "blife10", "blife20", "bfade1", "bfade3"]));
  }, 120_000);

  it("nel percorso FV casa e caldaia non spostano la scelta né il VAN, senza condizionatori", () => {
    const a = indicative(true);
    const b = structuredClone(a);
    b.building.uWall.value *= 1.8;
    b.building.floorArea.value = 180;
    b.system.boilerEfficiency.value = 0.75;
    expect(sz(evaluate(b, milano), "P").chosen).toEqual(sz(evaluate(a, milano), "P").chosen);
    expect(pk(evaluate(b, milano), "P").cash!.npv).toBeCloseTo(pk(evaluate(a, milano), "P").cash!.npv, 6);
  });
});
