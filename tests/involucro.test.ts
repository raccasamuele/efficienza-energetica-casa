import { describe, expect, it } from "vitest";
import { addQuote, buildEnvelope, checkProject, defaultVariants, envelopeBreakdown, envelopeCost, envelopeLabel, envelopeUpgrade, evaluate, exampleProject, insulatedU, insulationApplies, insulationName, insulationPriceType, INSULATION_CHECKLIST, INSULATION_KINDS, parseComuni, parseProjectFile, quotesApply, compareQuotes, simulateThermal, summarizeCost, toProjectFile, type Evaluation, type PackageId, type ProjectInput } from "../src/engine";
import before from "./fixtures/involucro-prima.json";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const climate = loadMilanoLegacy();
const comuni = parseComuni(readPublicJson("comuni.json"));
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((r) => r.id === id)!;
const wallArea = 2 * (Math.sqrt(60 / 2) + 2 * Math.sqrt(60 / 2)) * 6 - 15;
const active = () => { const p = exampleProject(); p.envelope.walls.enabled = true; return p; };
// motore 0.6.0: pareti esterne e serramenti divisi per orientamento («Pareti esterne N» …), qui sommati
const exchange = (p: ProjectInput, label: string, upgraded = true) => buildEnvelope(p.building, p.service, climate, upgraded ? envelopeUpgrade(p) : undefined).exchanges
  .filter((r) => r.label === label || r.label.startsWith(`${label} `)).reduce((s, r) => s + r.H, 0);

function originalNumbers(p: ProjectInput, name: string, labels = true) {
  const ev = evaluate(p, climate);
  expect(ev.ok).toBe(true);
  const ref = before.find((x) => x.name === name)!;
  expect(ev.calibration?.factor ?? null).toBe(ref.calibrationFactor);
  for (const old of ref.packages) {
    const r = pk(ev, old.id as PackageId);
    if (labels) expect(r.label).toBe(old.label);
    for (const key of ["heatNeed_kWh", "peak_kW", "gasSmc", "investment", "annualBenefit"] as const) expect(r[key]).toBeCloseTo(old[key], 9);
    expect(r.elec.import_kWh).toBeCloseTo(old.import_kWh, 9);
    if (old.npv === null) expect(r.cash?.npv ?? null).toBeNull();
    else expect(r.cash!.npv).toBeCloseTo(old.npv, 9);
  }
}

describe("Isolamento: formule e superfici indipendenti", () => {
  it("U a mano, U finale e spessore nullo", () => {
    const p = exampleProject();
    for (const [kind, u, cm, lambda, expected] of [["walls", .95, 12, .035, .223154], ["roof", 1.1, 20, .04, .169231], ["floor", 1, 8, .034, .298246]] as const) {
      const m = p.envelope[kind];
      const hand = 1 / (1 / u + (cm / 100) / lambda);
      expect(hand).toBeCloseTo(expected, 6);
      expect(insulatedU(u, m)).toBe(hand);
      m.thicknessCm.value = 0;
      expect(insulatedU(u, m)).toBe(u);
      m.method = "uFinale";
      expect(insulatedU(u, m)).toBe(m.uFinal.value);
    }
  });
  it("scambio di pareti, quota, ponti e sottotetto; adiacenze invariate", () => {
    const p = active();
    const u = 1 / (1 / .95 + .12 / .035);
    expect(wallArea).toBeCloseTo(182.180, 3);
    expect(exchange(p, "Pareti esterne")).toBeCloseTo((u + .1) * wallArea, 9);
    expect(exchange(p, "Pareti esterne")).toBeCloseTo(58.872, 2);
    const base = buildEnvelope(p.building, p.service, climate).exchanges;
    for (const r of base.filter((r) => !r.label.startsWith("Pareti esterne"))) expect(exchange(p, r.label)).toBe(r.H);
    p.envelope.walls.sharePct.value = 50;
    expect(exchange(p, "Pareti esterne")).toBeCloseTo((.5 * (u + .1) + .5 * 1.05) * wallArea, 9);
    expect(exchange(p, "Pareti esterne")).toBeCloseTo(125.081, 2);
    p.envelope.walls.sharePct.value = 100;
    p.envelope.walls.bridges = "valore";
    p.envelope.walls.bridgeDeltaU.value = .03;
    expect(exchange(p, "Pareti esterne")).toBeCloseTo((u + .03) * wallArea, 9);
    p.envelope.roof.enabled = true;
    const hiuToday = (p.building.uUpper.value + p.building.thermalBridgeDeltaU.value) * 60;
    const hueAttic = hiuToday * p.building.bUpperUnheated.value / (1 - p.building.bUpperUnheated.value);
    const hiuAfter = (1 / (1 / 1.1 + .2 / .04) + .1) * 60;
    expect(exchange(p, "Soffitto verso sottotetto")).toBeCloseTo(hiuAfter * hueAttic / (hiuAfter + hueAttic), 9);
    p.building.sides = "unLato";
    expect(exchange(p, "Pareti verso adiacenze non riscaldate")).toBe(exchange(p, "Pareti verso adiacenze non riscaldate", false));
    p.envelope.floor.enabled = true;
    const hiuFloorToday = (p.building.uLower.value + p.building.thermalBridgeDeltaU.value) * 60;
    const hueFloor = hiuFloorToday * p.building.bLowerUnheated.value / (1 - p.building.bLowerUnheated.value);
    const hiuFloorAfter = (1 / (1 + .08 / .034) + .1) * 60;
    expect(exchange(p, "Pavimento verso locale non riscaldato")).toBeCloseTo(hiuFloorAfter * hueFloor / (hiuFloorAfter + hueFloor), 9);
    p.building.lower = "esterno";
    expect(exchange(p, "Pavimento verso esterno")).toBeCloseTo((1 / (1 + .08 / .034) + .1) * 60, 9);
    p.envelope.walls.sharePct.value = 200;
    expect(envelopeUpgrade(p).walls!.share).toBe(1);
    expect(Object.keys(envelopeUpgrade(p, ["roof"]))).toEqual(["upper"]);
  });
  it("applicabilità, nomi e prezzo dipendono dai confini", () => {
    const p = exampleProject();
    expect(insulationName(p, "roof").short).toBe("Sottotetto");
    expect(insulationPriceType(p, "roof")).toBe("sottotetto");
    p.building.upper = "coperturaPiana";
    expect(insulationName(p, "roof").long).toBe("Isolamento del tetto");
    expect(insulationPriceType(p, "roof")).toBe("copertura");
    p.building.upper = "riscaldato";
    p.building.lower = "terreno";
    expect(insulationApplies(p, "roof")).toBe(false);
    expect(insulationApplies(p, "floor")).toBe(false);
    expect(insulationApplies(p, "walls")).toBe(true);
  });
});

describe("Compatibilità con la fixture immutabile", () => {
  for (const name of ["esempio", "split", "serramenti"]) it(name, () => {
    const p = exampleProject();
    if (name === "split") p.cooling.today = "split";
    if (name === "serramenti") p.goal = "serramenti";
    originalNumbers(p, name);
    for (const kind of INSULATION_KINDS) { p.envelope[kind].enabled = true; p.envelope[kind].thicknessCm.value = 0; p.envelope[kind].pricePerM2.value = 0; }
    originalNumbers(p, name, false);
    for (const kind of INSULATION_KINDS) { p.envelope[kind].thicknessCm.value = 12; p.envelope[kind].sharePct.value = 0; }
    originalNumbers(p, name, false);
  });
  it("importa il progetto senza envelope senza avvisi", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), climate)));
    delete file.input.envelope;
    const parsed = parseProjectFile(JSON.stringify(file), climate, comuni);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.file!.input.envelope.windows).toBe(true);
    originalNumbers(parsed.file!.input, "esempio");
  });
});

describe("Pacchetti, economia e confronto dei lavori", () => {
  it("integra il cappotto solo in W e usa il costo comune", () => {
    const p = active(), ev = evaluate(p, climate), old = evaluate(exampleProject(), climate);
    expect(pk(ev, "W").heatNeed_kWh).toBeLessThan(pk(old, "W").heatNeed_kWh);
    for (const id of ["H", "P"] as const) expect(pk(ev, id).heatNeed_kWh).toBe(pk(old, id).heatNeed_kWh);
    expect(pk(ev, "W").label).toBe("Involucro (serramenti, cappotto)");
    expect(pk(ev, "WH").label).toBe("Involucro + PDC");
    expect(pk(ev, "W").investment).toBeCloseTo(summarizeCost(p.windows.cost).total + 160 * wallArea, 9);
    expect(envelopeCost(p, "walls").area_m2).toBe(wallArea);
    expect(pk(ev, "W").conditions.join(" ")).toContain("scenario, non preventivo");
    p.envelope.windows = false;
    expect(pk(evaluate(p, climate), "W").label).toBe("Cappotto");
    expect(pk(evaluate(p, climate), "WHP").label).toBe("Cappotto + PDC + FV");
    expect(quotesApply(p, "windows")).toBe(false);
    p.windows.maintenanceDelta.status = "sconosciuto";
    p.windows.maintenanceDelta.value = 999;
    p.windows.cost.items[0].status = "sconosciuto";
    expect(pk(evaluate(p, climate), "W").economicsComplete).toBe(true);
    expect(pk(evaluate(p, climate), "W").costs.maintenanceDelta).toBe(0);
    p.envelope.walls.costMode = "preventivo";
    p.envelope.walls.cost.items.forEach((it, i) => { it.status = "incluso"; it.amount.value = i * 100; });
    expect(pk(evaluate(p, climate), "W").investment).toBe(summarizeCost(p.envelope.walls.cost).total);
  });
  it("involucro vuoto bloccato senza cambiare il fabbisogno", () => {
    const p = exampleProject(); p.envelope.windows = false;
    const ev = evaluate(p, climate);
    for (const id of ["W", "WH", "WHP", "WP"] as const) {
      expect(pk(ev, id).valid).toBe(false);
      expect(pk(ev, id).blockers).toContain("Involucro vuoto: scegli almeno un lavoro (serramenti o isolamento) nel passo Interventi.");
      expect(pk(ev, id).heatNeed_kWh).toBe(pk(ev, "base").heatNeed_kWh);
    }
    expect(ev.thermal!.windows).toBe(ev.thermal!.base);
  });
  it("prezzo sconosciuto e incentivo sull'intero involucro", () => {
    const p = active(); p.envelope.walls.pricePerM2.status = "sconosciuto";
    expect(pk(evaluate(p, climate), "W").economicsMissing).toContain("Cappotto: prezzo per m²");
    p.envelope.walls.pricePerM2.status = "ipotizzato";
    Object.assign(p.economics.incentive, { enabled: true, source: "Scenario", date: "2026-11-05" });
    p.economics.incentive.windowsPct.value = 50;
    const ev = evaluate(p, climate);
    expect(ev.incentive!.rows.find((r) => r.id === "W")!.total).toBe(pk(ev, "W").investment / 2);
  });
  it("ogni lavoro da solo, prima della taratura, e gas della caldaia di riferimento", () => {
    const p = active(); p.envelope.roof.enabled = true;
    const ev = evaluate(p, climate), breakdown = envelopeBreakdown(p, climate, ev)!;
    expect(breakdown.parts).toHaveLength(3);
    for (const part of breakdown.parts) expect(part.heatSaved_kWh).toBeGreaterThan(0);
    // motore 0.6.0: con lo scambio esterno dell'ora i lavori non sono più per forza sottoadditivi (scarto 0,04% sull'esempio);
    // motore 0.7.0: con la rete a due nodi l'insieme risparmia l'1,8% più della somma sull'esempio
    expect(breakdown.sumOfParts_kWh).toBeGreaterThanOrEqual(breakdown.together.heatSaved_kWh * 0.97);
    const hand = simulateThermal(p.building, p.service, climate, undefined, envelopeUpgrade(p, ["walls"]));
    expect(breakdown.parts.find((x) => x.id === "walls")!.heatSaved_kWh).toBe(ev.thermal!.base.heatNeed_kWh - hand.heatNeed_kWh);
    expect(breakdown.together.cost).toBe(pk(ev, "W").investment);
    p.heatPump.boilerEndOfLife = true;
    p.tariffs.gasPrice.status = "sconosciuto";
    const b = envelopeBreakdown(p, climate, evaluate(p, climate))!;
    expect(b.parts[0].eurSaved).toBeNull();
    expect(b.parts[0].gasSaved_smc).toBeCloseTo(b.parts[0].heatSaved_kWh / p.heatPump.replacementBoilerEfficiency.value / p.system.gasPci.value, 9);
    const single = exampleProject();
    expect(envelopeBreakdown(single, climate, evaluate(single, climate))).toBeNull();
    expect(envelopeBreakdown(p, climate, { ...ev, ok: false })).toBeNull();
  });
  it("liste di controllo separate dai preventivi alternativi e nota del confronto", () => {
    const p = active();
    expect(INSULATION_CHECKLIST.walls.map((x) => x.label)).toContain("Davanzali, soglie e raccordi");
    for (const kind of INSULATION_KINDS) expect(p.envelope[kind].cost.items.every((x) => x.status === "sconosciuto" && x.amount.value === 0)).toBe(true);
    expect(envelopeLabel(p).parts).toEqual(["Serramenti", "Cappotto"]);
    addQuote(p, "windows");
    const compare = compareQuotes(p, climate, evaluate(p, climate), ["windows"]);
    expect(JSON.stringify(compare)).toContain("Beneficio, VAN e rientro sono dell'involucro intero");
    p.existingPv.present = true;
    p.envelope.walls.enabled = false;
    expect(pk(evaluate(p, climate), "WP").label).toBe("Serramenti + batteria");
  });
});

describe("Sensibilità e controlli", () => {
  it("il prezzo di scenario ipotizzato non richiede documentazione, lo spessore sì", () => {
    const p = active();
    p.envelope.walls.costMode = "stima";
    p.envelope.walls.pricePerM2.status = "ipotizzato";
    const issues = checkProject(p);
    expect(issues.filter((x) => x.message.includes("prezzo per m²") && !x.message.includes("fuori dagli scenari dichiarati"))).toEqual([]);
    expect(issues.some((x) => x.message === "Cappotto: spessore dell'isolante: ipotizzato, serve un dato documentato o misurato.")).toBe(true);
  });
  it("varianti presenti solo per i lavori e costi pertinenti", () => {
    expect(defaultVariants(exampleProject()).some((x) => x.id.startsWith("iso"))).toBe(false);
    const p = active(), variants = defaultVariants(p), nominal = evaluate(p, climate);
    const variant = (id: string) => variants.find((v) => v.id === id)!.apply(p);
    expect(pk(evaluate(variant("iso-"), climate), "W").heatNeed_kWh).toBeGreaterThan(pk(nominal, "W").heatNeed_kWh);
    expect(pk(evaluate(variant("isoprezzo-alto"), climate), "W").investment - pk(nominal, "W").investment).toBeCloseTo(60 * wallArea, 9);
    expect(variant("isoprezzo-basso").envelope.walls.pricePerM2.value).toBe(110);
    expect(variant("inv+").envelope.walls.pricePerM2.value).toBe(192);
    p.envelope.walls.costMode = "preventivo";
    expect(defaultVariants(p).some((x) => x.id === "iso-")).toBe(true);
    expect(defaultVariants(p).some((x) => x.id.startsWith("isoprezzo"))).toBe(false);
  });
  it("enum, intervalli attivi e conservazione dei valori spenti", () => {
    for (const field of ["method", "bridges", "costMode"] as const) {
      const file = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), climate)));
      file.input.envelope.walls[field] = "x";
      expect(parseProjectFile(JSON.stringify(file), climate).errors.length).toBeGreaterThan(0);
    }
    const p = active(); p.envelope.walls.thicknessCm.value = 60;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate).errors.length).toBeGreaterThan(0);
    p.envelope.walls.enabled = false;
    const parsed = parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate);
    expect(parsed.errors).toEqual([]);
    expect(parsed.file!.input.envelope.walls.thicknessCm.value).toBe(60);
  });
  it("prezzo copertura, U peggiore e lavori non applicabili", () => {
    const p = active(); p.envelope.roof.enabled = true; p.building.upper = "coperturaPiana";
    expect(checkProject(p).some((x) => x.severity === "esplorativo" && x.message.includes("fuori dagli scenari dichiarati per una copertura (150–320 €/m²)"))).toBe(true);
    p.envelope.walls.method = "uFinale"; p.envelope.walls.uFinal.value = 1.2;
    expect(checkProject(p).some((x) => x.message.includes("non migliore di quella attuale"))).toBe(true);
    p.building.upper = "riscaldato";
    expect(checkProject(p).some((x) => x.severity === "nota" && x.message.includes("non applicabile con questo confine della casa, non entra nei conti."))).toBe(true);
    const ev = evaluate(p, climate); p.envelope.roof.enabled = false;
    expect(pk(evaluate(p, climate), "W").heatNeed_kWh).toBe(pk(ev, "W").heatNeed_kWh);
  });
});
