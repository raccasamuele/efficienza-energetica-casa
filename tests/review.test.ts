// Test aggiunti dopo la revisione con agenti: casi limite e definizioni condivise.
import { describe, expect, it } from "vitest";
import {
  HOURS,
  capacityW,
  cashFlow,
  evaluate,
  exampleProject,
  nonDominated,
  parseProjectFile,
  simulateHeatPump,
  toProjectFile,
  type PackageResult,
} from "../src/engine";
import { parseItalianNumber } from "../src/ui/fields";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pkg = (ev: ReturnType<typeof evaluate>, id: string) => ev.packages.find((x) => x.id === id) as PackageResult;

describe("dati «non so» e controlli di intervallo", () => {
  it("un valore «non so» fuori intervallo blocca il calcolo invece di produrre NaN", () => {
    const p = exampleProject();
    p.system.boilerEfficiency = { value: 0, status: "sconosciuto" };
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(false);
    expect(ev.issues.some((i) => i.severity === "errore" && i.message.includes("Rendimento"))).toBe(true);
  });
  it("T esterna di progetto sopra il setpoint è un errore", () => {
    const p = exampleProject();
    p.system.designOutdoorTemp = { value: 22, status: "sconosciuto" };
    expect(evaluate(p, milano).ok).toBe(false);
  });
  it("un campo nascosto non pertinente non blocca i risultati", () => {
    const p = exampleProject();
    p.building.bUpperUnheated = { value: 1.5, status: "ipotizzato" };
    p.building.upper = "coperturaPiana";
    expect(evaluate(p, milano).ok).toBe(true);
  });
  it("data di stagione non valida è un errore, non una stagione diversa", () => {
    const p = exampleProject();
    p.service.seasonEnd = { month: 13, day: 1 };
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(false);
  });
});

describe("stato documentato", () => {
  it("modalità documentata con soli valori ipotizzati resta esplorazione", () => {
    const p = exampleProject();
    p.mode = "documentata";
    p.tariffs.date = "2026-10";
    p.building.geometryMode = "aree";
    p.building.windowMode = "aree";
    expect(evaluate(p, milano).documented).toBe(false);
  });
});

describe("economia: voci mancanti ≠ zero", () => {
  it("sostituzione con importo sconosciuto rende l'economia incompleta", () => {
    const p = exampleProject();
    p.pv.replacements[0].amount = { value: 0, status: "sconosciuto" };
    expect(pkg(evaluate(p, milano), "P").economicsComplete).toBe(false);
  });
  it("potenza contrattuale con PDC sconosciuta rende l'economia incompleta", () => {
    const p = exampleProject();
    p.heatPump.newContractPower = { ...p.heatPump.newContractPower, status: "sconosciuto" };
    expect(pkg(evaluate(p, milano), "H").economicsComplete).toBe(false);
  });
  it("preventivo senza voci incluse non è completo", () => {
    const p = exampleProject();
    p.pv.cost.items = [];
    expect(pkg(evaluate(p, milano), "P").economicsComplete).toBe(false);
  });
  it("con ACS a gas la quota fissa resta anche se il consumo ACS è sconosciuto", () => {
    const p = exampleProject();
    p.system.cookingOnGas = false;
    p.system.acsGasSmc = { value: 0, status: "sconosciuto" };
    const h = pkg(evaluate(p, milano), "H");
    expect(h.costs.gasFixed).toBe(p.tariffs.gasFixed.value);
    expect(h.economicsComplete).toBe(false);
  });
  it("caldaia a fine vita: i pacchetti senza PDC usano il rendimento della caldaia nuova", () => {
    const p = exampleProject();
    const before = pkg(evaluate(p, milano), "base").gasSmc;
    p.heatPump.boilerEndOfLife = true;
    const ev = evaluate(p, milano);
    expect(pkg(ev, "base").gasSmc).toBeLessThan(before);
    expect(pkg(ev, "H").investment).toBeCloseTo(pkg(ev, "H").investmentTotal - p.heatPump.boilerReplacementCost.value, 6);
  });
});

describe("rientro e dominanza", () => {
  it("una sostituzione che riporta il cumulato in negativo: nessun rientro semplice", () => {
    const r = cashFlow({
      investment: 3000,
      annualSaving: 600,
      exportDelta: 0,
      maintenanceDelta: 0,
      replacements: [{ label: "x", year: 7, amount: { value: 8000, status: "ipotizzato" } }],
      horizon: 10,
      rate: 0.03,
    });
    expect(r.simplePayback).toBeNull();
    expect(r.discountedPayback).toBeNull();
    expect(r.crossings).toBeGreaterThan(1);
  });
  it("un pacchetto con beneficio negativo è dominato dal «non fare nulla»", () => {
    const fake = (id: string, investment: number, annualBenefit: number) =>
      ({ id, investment, annualBenefit, economicsComplete: true, cash: { npv: 0 } }) as unknown as PackageResult;
    const nd = nonDominated([fake("base", 0, 0), fake("W", 5000, -100), fake("P", 8000, 600)]);
    expect(nd.has("W" as never)).toBe(false);
    expect(nd.has("P" as never)).toBe(true);
  });
  it("il risparmio annuo include cessione e manutenzione e coincide fra le viste", () => {
    const ev = evaluate(exampleProject(), milano);
    const p = pkg(ev, "P");
    expect(p.annualBenefit).toBeCloseTo(p.annualSaving + p.costs.exportRevenue - p.costs.maintenanceDelta, 9);
  });
});

describe("PDC: recupero di inizio stagione limitato", () => {
  const p = exampleProject();
  p.heatPump.model = "parametrico";
  it("oltre il budget di recupero l'ora è sottodimensionata (nessun rinvio illimitato)", () => {
    const q = new Array<number>(HOURS).fill(0);
    const recovery = new Array<boolean>(HOURS).fill(false);
    const budget = new Array<number>(HOURS).fill(0);
    const h0 = 7000;
    for (let k = 0; k < 72; k++) recovery[h0 + k] = true;
    budget[h0] = 1000; // 1 kWh rinviabile
    q[h0] = capacityW(milano.series.tAir[h0], p.heatPump) + 5000; // 5 kWh oltre la potenza
    const r = simulateHeatPump(q, milano, p.heatPump, p.system, recovery, budget);
    expect(r.ok).toBe(false);
    expect(r.hoursUndersized).toBe(1);
  });
  it("entro il budget l'energia rinviata viene fornita dopo (conservata)", () => {
    const q = new Array<number>(HOURS).fill(0);
    const recovery = new Array<boolean>(HOURS).fill(false);
    const budget = new Array<number>(HOURS).fill(0);
    const h0 = 7000;
    for (let k = 0; k < 72; k++) recovery[h0 + k] = true;
    const cap = capacityW(milano.series.tAir[h0], p.heatPump);
    budget[h0] = 3000;
    q[h0] = cap + 2000;
    const r = simulateHeatPump(q, milano, p.heatPump, p.system, recovery, budget);
    expect(r.ok).toBe(true);
    expect(r.elec[h0 + 1]).toBeGreaterThan(0); // il deficit è fornito all'ora successiva
  });
});

describe("import di dati non fidati", () => {
  it("rifiuta valori enumerati non ammessi invece di far crashare il calcolo", () => {
    for (const patch of [
      (f: ReturnType<typeof toProjectFile>) => ((f.input.consumption as { profile: string }).profile = "foo"),
      (f: ReturnType<typeof toProjectFile>) => ((f.input.pv as { plane: string }).plane = "XX"),
      (f: ReturnType<typeof toProjectFile>) => ((f.input.windows.cost.items[0] as { status: string }).status = "boh"),
    ]) {
      const f = toProjectFile(exampleProject(), milano);
      patch(f);
      expect(parseProjectFile(JSON.stringify(f), milano).errors.length).toBeGreaterThan(0);
    }
  });
  it("completa i campi aggiunti in versioni successive con un avviso", () => {
    const f = toProjectFile(exampleProject(), milano) as unknown as { input: { heatPump: Record<string, unknown> } };
    delete f.input.heatPump.replacementBoilerEfficiency;
    const r = parseProjectFile(JSON.stringify(f), milano);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toContain("replacementBoilerEfficiency");
  });
});

describe("numeri scritti all'italiana", () => {
  it.each([
    ["12.000", 12000],
    ["1.234,56", 1234.56],
    ["0,125", 0.125],
    ["0.125", 0.125],
    ["1.5", 1.5],
    ["-5", -5],
    ["−7,5", -7.5],
    ["2 700", 2700],
  ])("%s → %d", (txt, v) => expect(parseItalianNumber(txt)).toBeCloseTo(v, 9));
  it.each(["", "abc", "1,2,3", "1.2.3,4,5"])("«%s» non è un numero", (txt) => expect(parseItalianNumber(txt)).toBeNull());
});
