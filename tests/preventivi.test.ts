import { describe, expect, it } from "vitest";
import {
  MAX_QUOTES,
  QUOTE_CHECKLIST,
  absentChecklist,
  activateQuote,
  addQuote,
  compareQuotes,
  evaluate,
  evaluateModel,
  exampleProject,
  parseProjectFile,
  quotesOf,
  removeQuote,
  summarizeCost,
  toProjectFile,
  withQuote,
  type ProjectInput,
  type QuoteKind,
} from "../src/engine";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const KINDS: QuoteKind[] = ["windows", "heatPump", "pv", "battery"];

function withBattery(p = exampleProject()): ProjectInput {
  p.battery.enabled = true;
  return p;
}

/** Un'alternativa identica al preventivo in uso (stessi importi e specifiche, nome diverso). */
function sameAsActive(p: ProjectInput, kind: QuoteKind) {
  addQuote(p, kind);
  const alt = p[kind].otherQuotes.at(-1)!;
  const active = structuredClone(quotesOf(p, kind)[0]);
  Object.assign(alt, active, { cost: { ...active.cost, name: "Copia" } });
}

describe("Preventivi: dati e compatibilità", () => {
  it("un progetto salvato prima della tappa si apre con un solo preventivo e gli stessi risultati", () => {
    const p = exampleProject();
    const file = toProjectFile(p, milano) as unknown as { input: Record<string, Record<string, unknown>> };
    for (const k of KINDS) {
      delete file.input[k].otherQuotes;
      const cost = file.input[k].cost as Record<string, unknown>;
      delete cost.name;
      delete cost.supplier;
      delete cost.validUntil;
    }
    const r = parseProjectFile(JSON.stringify(file), milano);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).not.toMatch(/completati/);
    for (const k of KINDS) expect(quotesOf(r.file!.input, k)).toHaveLength(1);
    const before = evaluate(p, milano).packages.map((x) => [x.id, x.cash?.npv, x.investment]);
    const after = evaluate(r.file!.input, milano).packages.map((x) => [x.id, x.cash?.npv, x.investment]);
    expect(after).toEqual(before);
  });

  it("ogni voce della lista di controllo riconosce il proprio nome", () => {
    for (const k of KINDS)
      for (const item of QUOTE_CHECKLIST[k]) expect(item.match.test(item.label), `${k}: ${item.label}`).toBe(true);
  });

  it("le voci della lista assenti si elencano come non indicate, senza cambiare il conto", () => {
    const p = exampleProject();
    expect(absentChecklist("pv", p.pv.cost).map((x) => x.id)).toEqual(["linea", "ponteggio"]);
    expect(absentChecklist("heatPump", p.heatPump.cost)).toEqual([]);
    expect(summarizeCost(p.pv.cost).complete).toBe(true);
  });

  it("un preventivo nuovo parte dalla lista con le voci non indicate: incompleto finché non sono dichiarate", () => {
    const p = exampleProject();
    expect(addQuote(p, "pv")).toBe(true);
    const alt = p.pv.otherQuotes[0];
    expect(alt.cost.items.map((x) => x.label)).toEqual(QUOTE_CHECKLIST.pv.map((x) => x.label));
    expect(alt.cost.items.every((x) => x.status === "sconosciuto")).toBe(true);
    expect(alt.kWp).toEqual(p.pv.kWp);
    expect(alt.cost.forSize).toBe(p.pv.kWp.value);
    expect(alt.cost.name).toBe("Preventivo 2");
    expect(summarizeCost(alt.cost).complete).toBe(false);
    expect(absentChecklist("pv", alt.cost)).toEqual([]);
  });

  it(`al massimo ${MAX_QUOTES} preventivi per intervento`, () => {
    const p = exampleProject();
    expect(addQuote(p, "windows")).toBe(true);
    expect(addQuote(p, "windows")).toBe(true);
    expect(addQuote(p, "windows")).toBe(false);
    expect(quotesOf(p, "windows")).toHaveLength(MAX_QUOTES);
    expect(quotesOf(p, "windows").map((q) => q.cost.name)).toEqual(["Preventivo 1", "Preventivo 2", "Preventivo 3"]);
    removeQuote(p, "windows", 1);
    expect(quotesOf(p, "windows").map((q) => q.cost.name)).toEqual(["Preventivo 1", "Preventivo 3"]);
  });

  it("«Usa questo preventivo» scambia specifiche e costi; rifatto torna al progetto di partenza", () => {
    const p = withBattery();
    addQuote(p, "battery");
    p.battery.otherQuotes[0].capacityKwh.value = 10;
    const start = structuredClone(p);
    activateQuote(p, "battery", 1);
    expect(p.battery.capacityKwh.value).toBe(10);
    expect(p.battery.cost.name).toBe("Preventivo 2");
    expect(p.battery.otherQuotes[0].capacityKwh.value).toBe(5);
    expect(p.battery.otherQuotes[0].cost.name).toBe("Preventivo 1");
    expect(p.battery.reservePct).toEqual(start.battery.reservePct);
    activateQuote(p, "battery", 1);
    expect(p).toEqual(start);
  });

  it("withQuote non modifica il progetto di partenza", () => {
    const p = exampleProject();
    addQuote(p, "pv");
    p.pv.otherQuotes[0].kWp.value = 6;
    const q = withQuote(p, "pv", 1);
    expect(q.pv.kWp.value).toBe(6);
    expect(p.pv.kWp.value).toBe(4);
  });
});

describe("Preventivi: importazione di file non fidati", () => {
  const roundTrip = (p: ProjectInput) => parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano);

  it("un'alternativa valida si salva e si riapre uguale", () => {
    const p = exampleProject();
    addQuote(p, "heatPump");
    p.heatPump.otherQuotes[0].model = "parametrico";
    p.heatPump.otherQuotes[0].cost.supplier = "Ditta B";
    const r = roundTrip(p);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.heatPump.otherQuotes).toEqual(p.heatPump.otherQuotes);
  });

  it("più di tre preventivi: rifiutato", () => {
    const p = exampleProject();
    addQuote(p, "pv");
    addQuote(p, "pv");
    p.pv.otherQuotes.push(structuredClone(p.pv.otherQuotes[0]));
    expect(roundTrip(p).errors.join(" ")).toMatch(/al massimo 3 preventivi/);
  });

  it("stato di una voce o macchina non ammessi in un'alternativa: rifiutato", () => {
    const p = exampleProject();
    addQuote(p, "heatPump");
    (p.heatPump.otherQuotes[0].cost.items[0] as { status: string }).status = "gratis";
    expect(roundTrip(p).errors.join(" ")).toMatch(/gratis/);
    const q = exampleProject();
    addQuote(q, "heatPump");
    (q.heatPump.otherQuotes[0] as { model: string }).model = "magico";
    expect(roundTrip(q).errors.join(" ")).toMatch(/magico/);
  });

  it("un'alternativa con un campo mancante: rifiutata", () => {
    const p = exampleProject();
    addQuote(p, "windows");
    delete (p.windows.otherQuotes[0] as Partial<(typeof p.windows.otherQuotes)[0]>).uWindow;
    expect(roundTrip(p).errors.join(" ")).toMatch(/otherQuotes\[0\]\.uWindow/);
  });
});

describe("Preventivi: calcolo di un solo pacchetto", () => {
  it("il pacchetto calcolato da solo è identico a quello del calcolo completo", () => {
    const p = withBattery();
    const full = evaluateModel(p, milano);
    for (const id of ["W", "H", "P"] as const) {
      const one = evaluateModel(p, milano, 1, undefined, [id]);
      expect(one.packages.map((x) => x.id)).toEqual(["base", id]);
      const a = full.packages.find((x) => x.id === id)!;
      const b = one.packages.find((x) => x.id === id)!;
      expect([b.investment, b.annualBenefit, b.cash?.npv, b.elec.import_kWh, b.battery?.npvBattery]).toEqual([a.investment, a.annualBenefit, a.cash?.npv, a.elec.import_kWh, a.battery?.npvBattery]);
    }
  });
});

describe("Preventivi: confronto", () => {
  const today = new Date("2026-11-03");

  it("senza alternative non c'è confronto", () => {
    const p = exampleProject();
    expect(compareQuotes(p, milano, evaluate(p, milano), KINDS, today)).toEqual([]);
  });

  for (const [kind, id] of [["windows", "W"], ["heatPump", "H"], ["pv", "P"], ["battery", "P"]] as const) {
    it(`${kind}: due preventivi identici danno risultati identici`, () => {
      const p = withBattery();
      sameAsActive(p, kind);
      const [c] = compareQuotes(p, milano, evaluate(p, milano), [kind], today);
      expect(c.kind).toBe(kind);
      expect(c.packageId).toBe(id);
      const [a, b] = c.rows;
      expect(a.active && !b.active).toBe(true);
      expect(b.ok).toBe(true);
      expect([b.total, b.annualBenefit, b.npv, b.payback, b.perUnit]).toEqual([a.total, a.annualBenefit, a.npv, a.payback, a.perUnit]);
      expect(c.differences[0]).toMatch(/costa come/);
    });
  }

  it("cambiare solo il prezzo cambia investimento, VAN e rientro, non il beneficio", () => {
    const p = exampleProject();
    sameAsActive(p, "pv");
    p.pv.otherQuotes[0].cost.items[0].amount.value += 1000;
    const [c] = compareQuotes(p, milano, evaluate(p, milano), ["pv"], today);
    const [a, b] = c.rows;
    expect(b.annualBenefit).toBeCloseTo(a.annualBenefit!, 9);
    expect(b.total - a.total).toBeCloseTo(1000, 9);
    expect(b.npv!).toBeCloseTo(a.npv! - 1000, 6);
    expect(a.payback).not.toBeNull();
    expect(b.payback === null || b.payback > a.payback!).toBe(true);
    expect(c.differences[0]).toMatch(/costa 1000 € in più di Preventivo 1/);
  });

  it("batteria più grande: la frase dice quanto accumulo aggiunge e quanto vale nel profilo", () => {
    const p = withBattery();
    sameAsActive(p, "battery");
    const alt = p.battery.otherQuotes[0];
    alt.capacityKwh.value = 10;
    alt.cost.forSize = 10;
    alt.cost.items[0].amount.value += 2400;
    const [c] = compareQuotes(p, milano, evaluate(p, milano), ["battery"], today);
    const [a, b] = c.rows;
    expect(b.size.value).toBe(10);
    expect(b.perUnit).toBeCloseTo(b.total / 10, 9);
    expect(b.annualBenefit!).toBeGreaterThan(a.annualBenefit!);
    expect(c.differences[0]).toMatch(/^Copia costa 2400 € in più di Preventivo 1 e aggiunge 5 kWh di accumulo: nel tuo profilo valgono \d+ € l'anno in più/);
  });

  it("una voce non indicata non vale zero: VAN e rientro restano vuoti", () => {
    const p = exampleProject();
    addQuote(p, "windows");
    const [c] = compareQuotes(p, milano, evaluate(p, milano), ["windows"], today);
    const b = c.rows[1];
    expect(b.economicsComplete).toBe(false);
    expect(b.npv).toBeNull();
    expect(b.unclear).toEqual(QUOTE_CHECKLIST.windows.map((x) => x.label));
  });

  it("un'alternativa con un dato fuori intervallo non blocca il resto: la riga spiega l'errore", () => {
    const p = exampleProject();
    sameAsActive(p, "pv");
    p.pv.otherQuotes[0].kWp.value = 50;
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(true);
    const [c] = compareQuotes(p, milano, ev, ["pv"], today);
    expect(c.rows[1].ok).toBe(false);
    expect(c.rows[1].errors.join(" ")).toMatch(/Potenza FV/);
  });

  it("avvisi: offerta scaduta, preventivo vecchio, serramenti non migliori di quelli attuali", () => {
    const p = exampleProject();
    sameAsActive(p, "windows");
    const alt = p.windows.otherQuotes[0];
    alt.cost.validUntil = "2026-10-31";
    alt.cost.quoteDate = "2025-06-01";
    alt.uWindow.value = 3;
    const [c] = compareQuotes(p, milano, evaluate(p, milano), ["windows"], today);
    const w = c.rows[1].warnings.join(" ");
    expect(w).toMatch(/scaduta il 31\/10\/2026/);
    expect(w).toMatch(/più di un anno fa/);
    expect(w).toMatch(/Uw .* non migliore/);
  });

  it("avviso: FV che produce molto più dei consumi", () => {
    const p = exampleProject();
    sameAsActive(p, "pv");
    p.pv.otherQuotes[0].kWp.value = 12;
    const [c] = compareQuotes(p, milano, evaluate(p, milano), ["pv"], today);
    expect(c.rows[1].warnings.join(" ")).toMatch(/volte i consumi/);
    expect(c.rows[0].warnings.join(" ")).not.toMatch(/volte i consumi/);
  });

  it("FV con la batteria accesa: la nota dice che il pacchetto comprende la batteria", () => {
    const p = withBattery();
    sameAsActive(p, "pv");
    const [c] = compareQuotes(p, milano, evaluate(p, milano), ["pv"], today);
    expect(c.notes.join(" ")).toMatch(/con la batteria in uso \(5 kWh, 3700 €\)/);
    const q = exampleProject();
    sameAsActive(q, "pv");
    expect(compareQuotes(q, milano, evaluate(q, milano), ["pv"], today)[0].notes).toEqual([]);
  });

  it("niente confronto di FV e batteria con la taglia indicativa", () => {
    const p = withBattery();
    addQuote(p, "pv");
    addQuote(p, "battery");
    p.pv.sizing = "indicativa";
    expect(compareQuotes(p, milano, evaluate(p, milano), ["pv", "battery"], today)).toEqual([]);
  });
});
