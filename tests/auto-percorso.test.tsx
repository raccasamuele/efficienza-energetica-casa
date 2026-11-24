import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, exampleProject, evaluate, exportEnergyProfile, parseProjectFile, toProjectFile, q, parseComuni } from "../src/engine";
import { evOwnership, evStrategies } from "../src/engine/auto";
import { applyGoal, GOAL_OPTIONS, goalPackages, goalSteps, goalInfo } from "../src/ui/goals";
import { EvFields, EvTable } from "../src/ui/auto";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const climate = loadMilanoLegacy();
describe("percorso auto elettrica, tappa 5 bis", () => {
  it("mantiene il motore stage 5 alla fixture prima, auto spenta e accesa", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/percorso-auto-prima.json", "utf8"));
    const scenarios = [
      ["spenta-arrivo-fv-nuovo", false, "arrivo", "nuovo", false],
      ["accesa-arrivo-fv-nuovo", true, "arrivo", "nuovo", false],
      ["accesa-sole-fv-nuovo", true, "sole", "nuovo", false],
      ["accesa-arrivo-fv-esistente", true, "arrivo", "esistente", false],
      ["accesa-sole-fv-esistente", true, "sole", "esistente", false],
      ["accesa-sole-batteria", true, "sole", "nuovo", true],
    ] as const;
    for (const [name, enabled, strategy, pv, battery] of scenarios) {
      const p = exampleProject(); p.ev.enabled = enabled; p.ev.strategy = strategy; p.existingPv.present = pv === "esistente"; p.battery.enabled = battery;
      const actual = evaluate(p, climate); expect(actual.ok).toBe(true);
      const expected = fixture.find((x: any) => x.name === name);
      if (!actual.ok) continue;
      for (const original of expected.packages) {
        const result = actual.packages.find((x) => x.id === original.id)!;
        expect(result.cash?.npv ?? null).toBeCloseTo(original.npv ?? 0, 6);
        expect(result.costs.total).toBeCloseTo(original.spending, 6);
        expect(result.elec.import_kWh).toBeCloseTo(original.import_kWh, 6);
        expect(result.elec.export_kWh).toBeCloseTo(original.export_kWh, 6);
        if (original.ev) {
          expect(result.ev?.marginalCost).toBeCloseTo(original.ev.marginalCost, 6);
          const rows = evStrategies(p, climate, result);
          expect(rows.map((x) => x.strategy)).toEqual(expected.packages.find((x: any) => x.id === original.id).evStrategies.map((x: any) => x.strategy));
          rows.forEach((row, i) => expect(row.marginalCost).toBeCloseTo(expected.packages.find((x: any) => x.id === original.id).evStrategies[i].marginalCost, 6));
        } else expect(result.ev).toBeUndefined();
      }
      expect(exportEnergyProfile(p, climate, actual.packages, new Date("2026-11-05T00:00:00Z"))).toEqual({ ...expected.profile, motore: `casa-1R1C ${ENGINE_VERSION}` });
    }
  });
  it("calcola una somma semplice, rivendita e pareggio", () => {
    const p = exampleProject() as any;
    Object.assign(p.ev, { years: q(10), evPrice: q(30000), evIncentive: q(3000), evMaintenance: q(200), evTax: q(100), evResale: q(12000), icePrice: q(25000), iceMaintenance: q(400), iceTax: q(200), iceResale: q(9000) });
    const result = evOwnership(p, { marginalCost: 500, outside_kWh: 0, unmet_kWh: 0 });
    expect(result.rows[0].totale).toBeCloseTo(23000, 6);
    expect(result.combustione).toBeCloseTo(36040, 6);
    expect(result.differenza).toBeCloseTo(13040, 6);
    expect(result.pareggio).toBe(2);
  });
  it("segnala dati ignoti e non conta le rivendite non note", () => {
    const p = exampleProject();
    const result = evOwnership(p, { marginalCost: 500, outside_kWh: 0, unmet_kWh: 0 });
    expect(result.rows[0].items.rivendita).toBe(0);
    expect(result.combustione).toBeGreaterThanOrEqual(0);
    expect(result.missing).toContain("Prezzo dell'elettrica");
    expect(result.missing).toContain("Rivendita dell'elettrica (non conteggiata)");
    expect(result.missing.length).toBeGreaterThan(0);
    expect(p.ev.evPrice.value).toBe(0);
    expect(p.ev.evPrice.status).toBe("sconosciuto");
  });
  it("abilita il percorso breve e filtra i pacchetti in base al FV", () => {
    const p = exampleProject(); applyGoal(p, "auto");
    expect(p.ev.enabled).toBe(true); expect(p.battery.enabled).toBe(false);
    expect(goalSteps("auto").slice(0, 3)).toEqual(["localita", "consumi", "interventi"]);
    expect(goalPackages(p)).toEqual(["base"]);
    expect(GOAL_OPTIONS.findIndex((x) => x.id === "auto")).toBeLessThan(GOAL_OPTIONS.findIndex((x) => x.id === "completo"));
    p.ev.pvPlan = "esistente"; expect(goalPackages(p)).toEqual(["base"]); applyGoal(p, "auto"); expect(p.existingPv.present).toBe(true);
    p.ev.pvPlan = "nuovo"; expect(goalPackages(p)).toEqual(["base", "P"]);
    for (const g of ["fv", "batteria", "pdc", "serramenti", "completo"] as const) expect(goalPackages({ ...p, goal: g })).toEqual(goalInfo(g).packages);
  });
  it("apre file stage 5 con e senza input.ev senza avvisi e conserva i risultati", () => {
    const base = exampleProject(); base.ev.enabled = true;
    const before = evaluate(base, climate);
    const file = toProjectFile(base, climate);
    for (const removeEv of [false, true]) {
      const old = JSON.parse(JSON.stringify(file));
      for (const key of ["pvPlan", "years", "evPrice", "evIncentive", "evMaintenance", "evTax", "evResale", "icePrice", "iceMaintenance", "iceTax", "iceResale"]) delete old.input.ev[key];
      if (removeEv) delete old.input.ev;
      const opened = parseProjectFile(JSON.stringify(old), climate, parseComuni(readPublicJson("comuni.json")));
      expect(opened.errors).toEqual([]); expect(opened.warnings).toEqual([]);
      const recalculated = evaluate(opened.file!.input, climate);
      const expected = removeEv ? evaluate(exampleProject(), climate) : before;
      expect(recalculated.ok).toBe(expected.ok);
      if (recalculated.ok && expected.ok) {
        expect(recalculated.packages.map((x) => x.id)).toEqual(expected.packages.map((x) => x.id));
        recalculated.packages.forEach((row, i) => {
          expect(row.elec.import_kWh).toBeCloseTo(expected.packages[i].elec.import_kWh, 6);
          expect(row.costs.total).toBeCloseTo(expected.packages[i].costs.total, 6);
        });
      }
    }
  });
  it("i costi auto non modificano spesa, investimento o VAN dei pacchetti", () => {
    const p = exampleProject(); p.ev.enabled = true;
    const before = evaluate(p, climate); const r = before.ok ? before.packages.find((x) => x.id === "base")! : null;
    expect(r?.ev).toBeTruthy();
    const external = evOwnership(p, r!.ev!, "Elettrica");
    p.ev.evPrice = q(80000); p.ev.evMaintenance = q(1000); p.ev.icePrice = q(50000); p.ev.years = q(25);
    const after = evaluate(p, climate); expect(after.ok).toBe(true);
    if (after.ok) expect(after.packages.map((x) => [x.id, x.costs.total, x.investment, x.cash?.npv])).toEqual(before.ok ? before.packages.map((x) => [x.id, x.costs.total, x.investment, x.cash?.npv]) : []);
    expect(external.rows[0].items.energia).toBeCloseTo(r!.ev!.marginalCost + (r!.ev!.outside_kWh + r!.ev!.unmet_kWh) * p.ev.outsidePrice.value, 6);
  });
  it("i pannelli confrontano VAN con e senza auto", () => {
    const p = exampleProject(); p.goal = "auto"; p.ev.enabled = true; p.ev.pvPlan = "nuovo";
    const withCar = evaluate(p, climate); const withoutCar = evaluate({ ...p, ev: { ...p.ev, enabled: false } }, climate);
    expect(withCar.ok && withoutCar.ok).toBe(true);
    if (withCar.ok && withoutCar.ok) { expect(withCar.packages.find((x) => x.id === "P")?.cash?.npv).not.toBeCloseTo(withoutCar.packages.find((x) => x.id === "P")?.cash?.npv ?? 0, 6); const table = renderToStaticMarkup(<EvTable p={p} climate={climate} ev={withCar} />); expect(table).toContain("I pannelli valgono"); expect(table).toContain("Elettrica, con i pannelli nuovi"); }
  });
  it("mostra confronto e riga con pannelli nuovi anche nel quadro completo", () => {
    const p = exampleProject(); p.goal = "completo"; p.ev.enabled = true;
    const ev = evaluate(p, climate); expect(ev.ok).toBe(true);
    if (ev.ok) {
      const table = renderToStaticMarkup(<EvTable p={p} climate={climate} ev={ev} />);
      expect(table).toContain("Elettrica, con i pannelli nuovi");
      expect(table).toContain("I pannelli valgono");
    }
  });
  it("mostra campi e riquadro del costo totale nel percorso, nei risultati e nel report", () => {
    const p = exampleProject(); applyGoal(p, "auto");
    const html = renderToStaticMarkup(<EvFields p={p} up={(change) => change(p)} doc={false} />);
    expect(html).not.toContain("In famiglia"); expect(html).toContain("Fotovoltaico"); expect(html).toContain("Per il costo totale"); expect(html).toContain("Prezzo dell&#x27;auto elettrica");
    const ev = evaluate(p, climate); expect(ev.ok).toBe(true);
    if (ev.ok) {
      const results = renderToStaticMarkup(<Results p={p} ev={ev} climate={climate} sens={null} />);
      const report = renderToStaticMarkup(<Report p={p} ev={ev} climate={climate} sens={null} />);
      expect(results).toContain("Costo totale dell&#x27;auto"); expect(report).toContain("Costo totale dell&#x27;auto");
      expect(results.indexOf("Costo totale dell&#x27;auto")).toBeLessThan(results.indexOf("Appena arriva a casa"));
    }
  });
});


