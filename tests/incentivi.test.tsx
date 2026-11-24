import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INCENTIVE_PRESETS, applyIncentivePreset, evaluate, exampleProject, incentivePresentValue, parseProjectFile, q, summarizeCost, toProjectFile, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { IncentiveBlock } from "../src/ui/calibration";
import { verdetto } from "../src/ui/verdetto";
import { loadMilano } from "./helpers";

// Esegue il vero callback dell'elenco senza introdurre un ambiente DOM o dipendenze.
const select = vi.hoisted(() => ({ change: (_value: string): void => {} }));
vi.mock("../src/ui/fields", async (original) => {
  const fields = await original<typeof import("../src/ui/fields")>();
  return { ...fields, SelectField: (props: Parameters<typeof fields.SelectField>[0]) => {
    if (props.label === "Incentivo") select.change = props.onChange;
    return fields.SelectField(props);
  } };
});
const climate = loadMilano();
const plain = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const form = (p: ProjectInput) => renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={(change) => change(p)} doc={false} issues={[]} /></FormContext.Provider>);

describe("Incentivi preimpostati", () => {
  it("contiene esattamente le quattro regole verificate con fonte, indirizzo e data", () => {
    expect(INCENTIVE_PRESETS.map(({ id, pct, years, spendingCap }) => ({ id, pct, years, spendingCap }))).toEqual([
      { id: "detrazione-2026-principale", pct: 50, years: 10, spendingCap: 96000 },
      { id: "detrazione-2026-altra", pct: 36, years: 10, spendingCap: 96000 },
      { id: "detrazione-2027-principale", pct: 36, years: 10, spendingCap: 96000 },
      { id: "detrazione-2027-altra", pct: 30, years: 10, spendingCap: 96000 },
    ]);
    for (const rule of INCENTIVE_PRESETS) {
      expect(rule.source).toContain("Agenzia delle Entrate");
      expect(rule.url).toMatch(/^https:\/\//);
      expect(rule.checked).toBe("2026-11-12");
      expect(new Date(rule.checked).toISOString().slice(0, 10)).toBe(rule.checked);
    }
  });

  it("applica ogni regola e documenta percentuali, rate, fonte e data", () => {
    const inc = exampleProject().economics.incentive;
    for (const rule of INCENTIVE_PRESETS) {
      applyIncentivePreset(inc, rule.id);
      expect(inc).toMatchObject({ enabled: true, preset: rule.id, source: rule.source, date: rule.checked });
      for (const key of ["windowsPct", "heatPumpPct", "pvPct", "batteryPct", "years"] as const)
        expect(inc[key]).toEqual({ value: key === "years" ? 10 : rule.pct, status: "documentato", source: rule.source });
    }
  });

  it("aggiunge solo il valore attuale delle rate e da spento conserva tutti i risultati", () => {
    const p = exampleProject();
    const before = evaluate(p, climate);
    applyIncentivePreset(p.economics.incentive, "detrazione-2026-principale");
    const ev = evaluate(p, climate);
    expect(ev.packages).toEqual(before.packages);
    for (const row of ev.incentive!.rows) {
      const r = before.packages.find((x) => x.id === row.id)!;
      const spending = (r.has.W ? summarizeCost(p.windows.cost).total : 0)
        + (r.has.H ? summarizeCost(p.heatPump.cost).total : 0)
        + (r.has.P ? summarizeCost(p.pv.cost).total : 0);
      const pv = incentivePresentValue(spending, 50, 10, p.economics.realDiscountRate.value, p.economics.horizonYears.value);
      expect(row.presentValue).toBeCloseTo(pv, 8);
      expect(row.npv).toBeCloseTo(r.cash!.npv + pv, 8);
    }
    p.economics.incentive.enabled = false;
    expect(evaluate(p, climate)).toEqual(before);
  });

  it("sopra 96.000 di spesa incentivata calcola le rate solo sui primi 96.000 e lo dice", () => {
    const p = exampleProject();
    applyIncentivePreset(p.economics.incentive, "detrazione-2026-principale");
    const { realDiscountRate: rate, horizonYears: horizon } = p.economics;
    for (const amount of [96000, 96001, 200000]) {
      p.windows.cost.items = [{ label: "Spesa", amount: q(amount, "documentato"), status: "incluso" }];
      const ev = evaluate(p, climate);
      const row = ev.incentive!.rows.find((r) => r.id === "W")!;
      const cash = ev.packages.find((r) => r.id === "W")!.cash!;
      const counted = Math.min(amount, 96000);
      expect(row.overCap === true).toBe(amount > 96000);
      expect(row.total).toBeCloseTo(counted * .5, 6);
      expect(row.presentValue).toBeCloseTo(incentivePresentValue(counted, 50, 10, rate.value, horizon.value), 6);
      expect(row.npv).toBeCloseTo(cash.npv + row.presentValue, 6);
      expect(ev.incentive!.rows.find((r) => r.id === "P")?.overCap).toBeUndefined();
      const html = plain(renderToStaticMarkup(<IncentiveBlock ev={{ ...ev, incentive: { ...ev.incentive!, rows: [row] } }} />));
      expect(html).toContain(`Regola: ${INCENTIVE_PRESETS[0].label}. Fonte:`);
      expect(html.includes("la spesa supera il tetto di 96.000 €: le rate sono calcolate solo su 96.000 €")).toBe(amount > 96000);
    }
    p.economics.incentive.preset = "personale";
    const personal = evaluate(p, climate).incentive!.rows;
    expect(personal.every((r) => r.overCap === undefined)).toBe(true);
    expect(personal.find((r) => r.id === "W")!.total).toBeCloseTo(100000, 6);
  });

  it("con più interventi sopra il tetto divide i 96.000 fra gli interventi in proporzione alla spesa", () => {
    const p = exampleProject();
    applyIncentivePreset(p.economics.incentive, "detrazione-2026-principale");
    p.windows.cost.items = [{ label: "Spesa", amount: q(150000, "documentato"), status: "incluso" }];
    const ev = evaluate(p, climate);
    const plainRows = evaluate({ ...p, economics: { ...p.economics, incentive: { ...p.economics.incentive, preset: "personale" } } }, climate).incentive!.rows;
    for (const row of ev.incentive!.rows) {
      const full = plainRows.find((r) => r.id === row.id)!;
      const spending = full.total / .5;
      // Stessa percentuale per tutti gli interventi: in proporzione vuol dire 50% di 96.000.
      expect(row.total).toBeCloseTo(Math.min(spending, 96000) * .5, 6);
      expect(row.overCap === true).toBe(spending > 96000);
    }
    expect(ev.incentive!.rows.filter((r) => r.overCap).length).toBeGreaterThan(1);
  });

  it("il verdetto con incentivo usa le rate con il tetto", () => {
    const p = exampleProject();
    applyIncentivePreset(p.economics.incentive, "detrazione-2026-principale");
    p.windows.cost.items = [{ label: "Spesa", amount: q(150000, "documentato"), status: "incluso" }];
    const ev = evaluate(p, climate);
    const v = verdetto(ev, p, null)!;
    expect(v.conIncentivo).toBe(true);
    const row = ev.incentive!.rows.find((r) => r.id === v.id)!;
    expect([row.npv, row.tunedNpv]).toContain(v.npv);
    expect(row.total).toBeLessThanOrEqual(48000 + 1e-6);
    for (const r of ev.incentive!.rows) expect(r.total).toBeLessThanOrEqual(48000 + 1e-6);
  });

  it("apre file vecchi senza avvisi nuovi o conti diversi, normalizza gli id sconosciuti e conserva la regola", () => {
    const p = exampleProject();
    applyIncentivePreset(p.economics.incentive, "detrazione-2026-principale");
    const file = toProjectFile(p, climate);
    const current = parseProjectFile(JSON.stringify(file), climate);
    expect(current.errors).toEqual([]);
    expect(current.file!.input.economics.incentive.preset).toBe("detrazione-2026-principale");
    delete p.economics.incentive.preset;
    const old = parseProjectFile(JSON.stringify(file), climate);
    expect(old.errors).toEqual([]);
    expect(old.warnings).toEqual(current.warnings);
    expect(old.file!.input.economics.incentive.preset).toBe("personale");
    // Il solo metadato della regola cambia; i numeri rimangono identici.
    expect(evaluate(old.file!.input, climate).packages).toEqual(evaluate(p, climate).packages);
    expect(evaluate(old.file!.input, climate).incentive!.rows).toEqual(evaluate(p, climate).incentive!.rows);
    const unknown = JSON.parse(JSON.stringify(file)) as { input: { economics: { incentive: { preset: unknown } } } };
    for (const value of ["inesistente", 3, null, { id: "detrazione-2026-principale" }]) {
      unknown.input.economics.incentive.preset = value;
      const imported = parseProjectFile(JSON.stringify(unknown), climate);
      expect(imported.errors).toEqual([]);
      expect(imported.file!.input.economics.incentive.preset).toBe("personale");
    }
    p.economics.incentive.enabled = false;
    const off = parseProjectFile(JSON.stringify(file), climate);
    expect(off.file!.input.economics.incentive.preset).toBeUndefined();
    expect(off.warnings).toEqual(current.warnings);
  });

  it("offre sei voci, applica la scelta, nasconde i campi, permette la regola personale e spegne", () => {
    const p = exampleProject();
    p.goal = "completo";
    let html = form(p);
    const list = html.match(/<select[^>]*>[\s\S]*?<\/select>/g)!.find((s) => s.includes('value="nessuno"'))!;
    expect(list.match(/<option /g)).toHaveLength(6);
    expect(plain(html)).toContain("Il Conto Termico 3.0 del GSE");
    expect(plain(html)).not.toContain("Rate annue uguali");
    select.change("detrazione-2026-principale");
    html = form(p);
    expect(p.economics.incentive.preset).toBe("detrazione-2026-principale");
    expect(plain(html)).toContain("50% della spesa in 10 rate annue uguali, fino a 96.000 € di spesa per casa.");
    expect(html).toContain(`href="${INCENTIVE_PRESETS[0].url}" target="_blank" rel="noopener noreferrer"`);
    expect(plain(html)).toContain("controllata il 12/11/2026");
    expect(plain(html)).not.toContain("Rate annue uguali");
    expect(plain(html)).not.toContain("Fonte della regola");
    select.change("personale");
    html = form(p);
    expect(p.economics.incentive.enabled).toBe(true);
    expect(p.economics.incentive.preset).toBe("personale");
    for (const label of ["Rate annue uguali", "Fonte della regola", "Data di controllo della regola"]) expect(plain(html)).toContain(label);
    const saved = structuredClone(p.economics.incentive);
    select.change("nessuno");
    expect(p.economics.incentive).toEqual({ ...saved, enabled: false });
    expect(plain(form(p))).not.toContain("Rate annue uguali");
  });
});
