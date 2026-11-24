import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CURVE_CELLS, checkProject, defaultCookingSwitch, defaultVariants, evaluate, evaluateModel, evaluatePaths, exampleProject, exportEnergyProfile, gridImportSeries, nonFinitePaths, otherUsesDemand, packageConsumptionCurve, packageSeries, parseComuni, parseProjectFile, toProjectFile, type Evaluation, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { startProject } from "../src/ui/journey";
import { loadMilano, readPublicJson } from "./helpers";

const climate = loadMilano();
const comuni = parseComuni(readPublicJson("comuni.json"));
const get = (ev: Evaluation, id: string) => ev.packages.find((r) => r.id === id)!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / 1000;
function house() {
  const p = exampleProject();
  p.dhw.replace = true;
  p.dhw.newType = "pdc";
  p.cooking = { ...defaultCookingSwitch(), enabled: true, hobCost: { value: 1000, status: "documentato", source: "Importo di prova del test" }, meterClosureCost: { value: 200, status: "documentato", source: "Importo di prova del test" } };
  return p;
}
const without = (p: ProjectInput) => { const off = structuredClone(p); delete off.cooking; return off; };
const form = (p: ProjectInput) => renderToStaticMarkup(createElement(FormContext.Provider, { value: { project: p } }, createElement(InterventionsForm, { p, up: () => {}, doc: false, issues: [] })));

describe("Piano a induzione: calcolo", () => {
  it("assente o spento conserva ogni risultato, anche nelle case nuove", () => {
    for (const p of [exampleProject(), startProject("rapida", false), startProject("documentata", false)]) {
      const absent = evaluate(without(p), climate);
      p.cooking = { ...defaultCookingSwitch(), enabled: false, hobCost: { value: 15000, status: "sconosciuto" } };
      expect(evaluate(p, climate)).toEqual(absent);
      expect(defaultVariants(p).map((v) => v.id)).toEqual(defaultVariants(without(p)).map((v) => v.id));
    }
  });

  it("cambia solo il blocco impianto: formula, gas, quota fissa e costi", () => {
    const p = house(); p.system.efficiencyBasis = "PCS";
    const on = evaluateModel(p, climate), off = evaluateModel(without(p), climate);
    expect(on.ok).toBe(true);
    const kwh = p.system.cookingGasSmc.value * p.system.gasPcs.value * .55 / .85;
    for (const r of on.packages) {
      const before = get(off, r.id);
      if (!r.has.H) { expect(r).toEqual(before); continue; }
      expect(r.services.find((s) => s.service === "Cucina")).toEqual({ service: "Cucina", carrier: "elettricità", generator: "Piano a induzione", final_kWh: kwh });
      expect(before.gasSmc - r.gasSmc).toBeCloseTo(p.system.cookingGasSmc.value, 8);
      expect(r.gasSmc).toBe(0);
      expect(r.cooking!.elec_kWh).toBe(kwh);
      // Il controllo dello scaldacqua col sole può cambiare risposta al nuovo carico della cucina.
      const dhwDelta = r.dhw!.result.elec_kWh - before.dhw!.result.elec_kWh;
      expect(r.elec.demand_kWh - before.elec.demand_kWh).toBeCloseTo(kwh + dhwDelta, 6);
      expect(r.costs.gasFixed).toBe(0);
      expect(r.cooking!.gasMeterClosed).toBe(true);
      expect(r.investment - before.investment).toBe(1200);
      expect(r.investmentTotal - before.investmentTotal).toBe(1200);
    }
    expect(nonFinitePaths(on.packages)).toEqual([]);
  });

  it("usa la base PCI del gas anche per la cucina", () => {
    const p = house(); p.system.efficiencyBasis = "PCI";
    const r = get(evaluateModel(p, climate), "H");
    expect(r.cooking!.elec_kWh).toBe(p.system.cookingGasSmc.value * p.system.gasPci.value * .55 / .85);
  });

  it("segue il blocco impianto anche senza pompa di calore per il riscaldamento", () => {
    const p = house(); p.heatPump.included = false;
    const on = get(evaluateModel(p, climate), "H"), off = get(evaluateModel(without(p), climate), "H");
    expect(on.valid).toBe(true);
    expect(on.cooking).toBeDefined();
    expect(on.costs.gasFixed).toBe(p.tariffs.gasFixed.value);
    expect(on.investment - off.investment).toBe(1000);
    expect(on.conditions.join(" ")).toContain("Resta il gas per il riscaldamento");
    expect(on.conditions.join(" ")).toContain("serve anche la pompa di calore");
  });

  it("con acqua calda o integrazione solare a gas conserva quota fissa e non paga chiusura", () => {
    for (const solar of [false, true]) {
      const p = house(); p.dhw.replace = solar; p.dhw.newType = "solare"; p.dhw.solarBackup = "gas";
      p.cooking!.meterClosureCost.status = "sconosciuto";
      // Anche un servizio dichiarato a gas con consumo nullo conserva il contatore.
      p.system.acsGasSmc.value = 0;
      const r = get(evaluateModel(p, climate), "H"), off = get(evaluateModel(without(p), climate), "H");
      expect(r.costs.gasFixed).toBe(p.tariffs.gasFixed.value);
      expect(r.cooking!.gasMeterClosed).toBe(false);
      expect(r.investment - off.investment).toBe(1000);
      expect(r.economicsMissing).not.toContain("Chiusura del contatore del gas");
      expect(r.conditions.join(" ")).toContain("Resta il gas per l'acqua calda");
    }
  });

  it("chiude anche senza acqua calda a gas e conserva la nota con quota fissa iniziale zero", () => {
    const p = house(); p.system.acsOnGas = false; p.dhw.replace = false; p.tariffs.gasFixed.value = 0;
    const r = get(evaluateModel(p, climate), "H");
    expect(r.cooking!.gasMeterClosed).toBe(true);
    expect(r.investment - get(evaluateModel(without(p), climate), "H").investment).toBe(1200);
  });

  it("cucina già elettrica: nessuna modifica, casella o variante", () => {
    const p = house(); p.system.cookingOnGas = false;
    expect(evaluate(p, climate)).toEqual(evaluate(without(p), climate));
    expect(form(p)).not.toContain("Passo anche al piano a induzione");
    expect(defaultVariants(p).some((v) => v.id.startsWith("cooking"))).toBe(false);
  });

  it("ogni costo attivo sconosciuto rende incompleta l'economia; zero documentato è ammesso", () => {
    for (const key of ["hobCost", "meterClosureCost", "gasHobEfficiency", "inductionEfficiency"] as const) {
      const p = house(); p.cooking![key].status = "sconosciuto";
      const r = get(evaluateModel(p, climate), "H");
      expect(r.economicsComplete).toBe(false); expect(r.cash).toBeUndefined();
      expect(r.economicsMissing.length).toBeGreaterThan(0);
    }
    const p = house(); p.cooking!.hobCost.value = 0; p.cooking!.meterClosureCost.value = 0;
    expect(get(evaluateModel(p, climate), "H").economicsComplete).toBe(true);
  });

  it("conserva forma e totale orario, bilanci FV e batteria, curve e profilo esportati", () => {
    for (const mode of ["sintetico", "stagionale", "misurato"] as const) for (const battery of [false, true]) {
      const p = house(); p.battery.enabled = battery;
      if (mode === "misurato") p.consumption.measuredCurve = { ore: Array.from({ length: CURVE_CELLS }, (_, i) => .2 + (i % 24) / 100), giorni: 365, dal: "2025-01-01", al: "2025-12-31", fonte: "Misure di prova" };
      else p.consumption.profileMode = mode;
      const ev = evaluateModel(p, climate), profile = exportEnergyProfile(p, climate, ev.packages);
      expect(ev.ok).toBe(true);
      for (const id of ["H", "HP"]) {
        const r = get(ev, id), s = packageSeries(p, climate, r), cook = r.cooking!;
        expect(cook.elec).toEqual(otherUsesDemand(p, cook.elec_kWh, climate));
        expect(sum(cook.elec)).toBeCloseTo(cook.elec_kWh, 6);
        expect(sum(s.demand)).toBeCloseTo(r.elec.demand_kWh, 6);
        expect(sum(s.import)).toBeCloseTo(r.elec.import_kWh, 6);
        expect(sum(s.export)).toBeCloseTo(r.elec.export_kWh, 6);
        expect(sum(gridImportSeries(p, climate, r))).toBeCloseTo(r.elec.import_kWh, 6);
        expect(packageConsumptionCurve(p, climate, r).kwh_annui).toBe(Math.round(r.elec.import_kWh * 10) / 10);
        const exported = profile.scenari.find((x) => x.id === id)!;
        expect(exported.consumi.kwh_annui).toBe(Math.round(r.elec.demand_kWh * 10) / 10);
        expect(exported.consumi.usi!.altri_usi_kwh).toBe(Math.round((r.otherUses_kWh + r.dhw!.result.elec_kWh + cook.elec_kWh) * 10) / 10);
      }
    }
  });

  it("l'incentivo mantiene la stessa spesa agevolata", () => {
    const p = house(); p.economics.incentive.enabled = true;
    p.economics.incentive.source = "Regola di prova del test";
    p.economics.incentive.date = "2026-11-17";
    p.economics.incentive.heatPumpPct.value = 50;
    const on = evaluate(p, climate), off = evaluate(without(p), climate);
    expect(on.incentive?.rows.length).toBeGreaterThan(0);
    for (const id of ["H", "HP"]) {
      const a = on.incentive!.rows.find((r) => r.id === id)!, b = off.incentive!.rows.find((r) => r.id === id)!;
      expect(a.total).toBe(b.total); expect(a.presentValue).toBe(b.presentValue);
    }
  });

  it("sensibilità ±0,10 con limiti e senza modificare il progetto", () => {
    const p = house(), before = structuredClone(p);
    const variants = defaultVariants(p).filter((v) => v.id.startsWith("cooking"));
    expect(variants).toHaveLength(2);
    expect(variants[0].apply(p).cooking!.gasHobEfficiency.value).toBeCloseTo(.45, 12);
    expect(variants[1].apply(p).cooking!.gasHobEfficiency.value).toBeCloseTo(.65, 12);
    expect(p).toEqual(before);
    p.cooking!.gasHobEfficiency.value = .2;
    expect(variants[0].apply(p).cooking!.gasHobEfficiency.value).toBe(.2);
    p.cooking!.gasHobEfficiency.value = 1;
    expect(variants[1].apply(p).cooking!.gasHobEfficiency.value).toBe(1);
  });

  it("piano e chiusura entrano nello stesso anno del blocco impianto", () => {
    const p = house(); p.heatPump.boilerEndOfLife = false;
    p.plan = { budgetNow: { value: 100000, status: "documentato" }, budgetPerYear: { value: 0, status: "documentato" }, boilerYear: { value: 0, status: "sconosciuto" }, carYear: { value: 0, status: "ipotizzato" }, custom: { W: null, H: 2, P: null } };
    const onEv = evaluateModel(p, climate), offP = without(p), offEv = evaluateModel(offP, climate);
    const on = evaluatePaths(p, climate, onEv).custom!, off = evaluatePaths(offP, climate, offEv).custom!;
    expect(on.investments.map((x, i) => x - off.investments[i])).toEqual([0, 0, 1200, 0, 0, 0]);
    expect(on.flows.slice(0, 2)).toEqual(off.flows.slice(0, 2));
    expect(on.flows[2] - off.flows[2]).toBeCloseTo(get(onEv, "H").annualBenefit - get(offEv, "H").annualBenefit, 6);
  });
});

describe("Piano a induzione: importazione e interfaccia", () => {
  it("file vecchi senza nuovi avvisi e valori preimpostati con fonti; piano e chiusura del contatore stimati", () => {
    const p = house(), file = toProjectFile(without(p), climate);
    file.engineVersion = "0.17.0";
    const parsed = parseProjectFile(JSON.stringify(file), climate, comuni);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual(["Progetto salvato con motore 0.17.0: i risultati vengono ricalcolati con 0.18.1."]);
    expect(parsed.file!.input.cooking!.enabled).toBe(false);
    expect(evaluate(parsed.file!.input, climate)).toEqual(evaluate(without(p), climate));
    const c = startProject("rapida").cooking!;
    expect(c).toEqual(defaultCookingSwitch());
    expect(c.gasHobEfficiency.source).toContain("https://eur-lex.europa.eu/eli/reg/2014/66/oj");
    expect(c.inductionEfficiency.source).toContain("Induction-Range-Final-Report-July-2019.pdf");
    expect(c.hobCost).toMatchObject({ value: 825, status: "ipotizzato" }); expect(c.hobCost.source).toContain("altroconsumo.it"); expect(c.hobCost.source).toContain("cronoshare.it");
    // Tappa D del piano dopo la 8: chiusura del contatore stimata con il contributo D01 del distributore.
    expect(c.meterClosureCost).toMatchObject({ value: 30, status: "ipotizzato" });
    for (const url of ["2iRETE_GAS_SpA_Listino_prezzi_in_vigore_1_05_2025.pdf", "ITG-ELENCO-PREZZI-SERVIZI-AL-PDR", "asretigas.it"]) expect(c.meterClosureCost.source).toContain(url);
    const estimated = evaluateModel({ ...p, cooking: { ...c, enabled: true } }, climate).packages.find((r) => r.id === "H")!;
    expect(estimated.economicsComplete).toBe(true);
    expect(estimated.conditions.join(" ")).toContain("Chiusura del contatore del gas: costo stimato 30 € (contributo del distributore, IVA e contributo del venditore esclusi).");
    const enabled = { ...p, cooking: { ...c, enabled: true, meterClosureCost: { value: 200, status: "documentato" as const, source: "Importo di prova del test" } } };
    const h = evaluateModel(enabled, climate).packages.find((r) => r.id === "H")!;
    expect(h.economicsComplete).toBe(true);
    expect(h.conditions.join(" ")).toContain("costo stimato 825 € (media italiana, non preventivo; pentole escluse)");
    expect(h.conditions.join(" ")).not.toContain("Chiusura del contatore del gas: costo stimato");
    expect(estimated.investment - h.investment).toBeCloseTo(30 - 200, 6);
    const mine = { ...enabled, cooking: { ...enabled.cooking, hobCost: { value: 1200, status: "ipotizzato" as const, source: "Valore indicato da te, da verificare con il preventivo" } } };
    const h2 = evaluateModel(mine, climate).packages.find((r) => r.id === "H")!;
    expect(h2.conditions.join(" ")).not.toContain("Piano a induzione e posa: costo stimato");
    expect(h2.investment - h.investment).toBeCloseTo(1200 - 825, 6);
  });

  it("rifiuta oggetti parziali, tipi, stati, provenienze e intervalli errati anche da spento", () => {
    const valid = defaultCookingSwitch();
    const invalid: unknown[] = [null, false, [], {}, { ...valid, enabled: "true" }, { ...valid, enabled: 0 }];
    for (const key of ["gasHobEfficiency", "inductionEfficiency", "hobCost", "meterClosureCost"] as const) {
      const efficiency = key.includes("Efficiency");
      const partial: Record<string, unknown> = { ...valid }; delete partial[key]; invalid.push(partial);
      for (const value of [efficiency ? .19 : -1, efficiency ? 1.01 : 20001, "0,55"]) invalid.push({ ...valid, [key]: { ...valid[key], value } });
      for (const patch of [{ status: "errato" }, { source: 1 }, { date: [] }, { confirmed: "sì" }]) invalid.push({ ...valid, [key]: { ...valid[key], ...patch } });
    }
    for (const cooking of invalid) {
      const file = { ...toProjectFile(exampleProject(), climate), input: { ...exampleProject(), cooking } };
      const result = parseProjectFile(JSON.stringify(file), climate, comuni);
      expect(result.file).toBeUndefined(); expect(result.errors.join(" ")).toContain("cooking");
    }
    const p = house(); p.cooking!.gasHobEfficiency.value = .1;
    expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("cooking"))).toBe(true);
    for (const efficiency of [.2, 1]) for (const cost of [0, 20000]) {
      p.cooking = { ...valid, gasHobEfficiency: { ...valid.gasHobEfficiency, value: efficiency }, inductionEfficiency: { ...valid.inductionEfficiency, value: efficiency }, hobCost: { ...valid.hobCost, value: cost }, meterClosureCost: { ...valid.meterClosureCost, value: cost } };
      expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni).errors).toEqual([]);
    }
  });

  it("mostra scelta, costi, ipotesi, effetto, contatore chiuso e fonti nel report", () => {
    const p = house(), ev = evaluate(p, climate), html = form(p);
    expect(html).toContain("Passo anche al piano a induzione");
    expect(html).toContain("Piano a induzione e posa");
    expect(html).toContain("Vedi le ipotesi tecniche");
    expect(html).toContain("Rendimento del piano a gas");
    expect(html).toContain("100 € all&#x27;anno");
    expect(renderToStaticMarkup(createElement(Results, { p, ev, climate, sens: null }))).toContain("contatore chiuso");
    const report = renderToStaticMarkup(createElement(Report, { p, ev, climate, sens: null }));
    expect(report).toContain("esclusi dalla spesa incentivata");
    expect(report).toContain("https://eur-lex.europa.eu/eli/reg/2014/66/oj");
    delete p.cooking;
    expect(form(p)).toContain("Passo anche al piano a induzione");
  });
});
