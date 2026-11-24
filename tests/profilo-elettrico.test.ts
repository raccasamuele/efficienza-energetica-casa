import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARERA_PROFILE_SOURCE, CURVE_CELLS, HOURS, PROFILE_VARIANT_PREFIX, bandOf, checkProject, curveCell, dayOfYear, defaultVariants, electricDiagnosis, evaluate, exampleProject, exportConsumptionCurve, exportEnergyProfile, gridImportSeries, localHour, nonFinitePaths, otherUsesDemand, packageConsumptionCurve, packageSeries, parseComuni, parseProjectFile, profileArea, residualDemand, seasonalDemand, seasonalTable, toProjectFile } from "../src/engine";
import arera from "../src/engine/data/profili-arera.json";
import { ConsumptionForm } from "../src/ui/forms";
import { applyGoal } from "../src/ui/goals";
import { startProject } from "../src/ui/journey";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { loadMilano, readPublicJson } from "./helpers";

const climate = loadMilano();
const comuni = parseComuni(readPublicJson("comuni.json"));
const profiles = ["diurno", "serale", "distribuito"] as const;
const sum = (s: number[]) => s.reduce((a, b) => a + b, 0) / 1000;
const house = () => { const p = exampleProject(); p.consumption.profileMode = "stagionale"; return p; };
const meter = () => ({ ore: Array.from({ length: CURVE_CELLS }, (_, i) => .2 + (i % 24) / 100), giorni: 365, dal: "2025-01-01", al: "2025-12-31", fonte: "Contatore della casa" });

describe("Profilo elettrico: percorso sintetico invariato", () => {
  it("assente e sintetico sono identici, in ogni numero, sull'esempio e sulle case nuove", () => {
    for (const p of [exampleProject(), startProject("rapida", true, "fv"), startProject("documentata", true, "completo")]) {
      expect(p.consumption.profileMode).toBeUndefined();
      for (const profile of profiles) {
        p.consumption.profile = profile;
        delete p.consumption.profileMode;
        const before = evaluate(p, climate);
        expect(before.ok).toBe(true);
        expect(otherUsesDemand(p)).toEqual(residualDemand(p.consumption.electricityKwh.value, profile));
        p.consumption.profileMode = "sintetico";
        expect(evaluate(p, climate)).toEqual(before);
        expect(otherUsesDemand(p)).toEqual(residualDemand(p.consumption.electricityKwh.value, profile));
      }
    }
  });
});

describe("Profilo elettrico: pesi ARERA e calendario", () => {
  it("tutte le aree, classi e abitudini conservano il totale, anche zero e consumi grandi", () => {
    for (const power of Object.values(arera.profiles)) for (const table of Object.values(power)) for (const profile of profiles) for (const annual of [0, 2700, 200000]) {
      const series = seasonalDemand(annual, profile, table, curveCell);
      expect(series).toHaveLength(HOURS);
      expect(series.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      expect(Math.abs(sum(series) - annual)).toBeLessThan(1e-6);
    }
  });

  it("sceglie area e classe contrattuale, con Nord per provincia sconosciuta", () => {
    const p = house();
    for (const [sigla, area] of [["MI", "nord"], ["RM", "centro"], ["BA", "sud"], ["PA", "sud"]] as const) {
      p.location.sigla = sigla;
      for (const kw of [1.5, 3, 3.01, 4.5, 6]) {
        p.tariffs.contractPower.value = kw;
        expect(seasonalTable(p)).toBe(arera.profiles[kw <= 3 ? "fino3" : "fino4_5"][area]);
      }
    }
    p.location.sigla = "??";
    expect(seasonalTable(p)).toBe(arera.profiles.fino4_5.nord);
    expect(checkProject(p).some((i) => i.message.includes("provincia non riconosciuta"))).toBe(true);
    expect(profileArea("__proto__")).toBeUndefined();
    p.consumption.profileMode = "sintetico";
    expect(checkProject(p).some((i) => i.message.includes("provincia non riconosciuta"))).toBe(false);
  });

  it("distribuito conserva i rapporti della fonte fra mesi e tipi di giorno", () => {
    const table = arera.profiles.fino3.nord;
    const series = seasonalDemand(2700, "distribuito", table, curveCell);
    const weight = (h: number) => { const cell = curveCell(h); return table[Math.floor(cell / 24) % 12][Math.floor(cell / 288)][cell % 24]; };
    const k = series[0] / weight(0);
    for (let h = 0; h < HOURS; h++) expect(series[h]).toBeCloseTo(k * weight(h), 10);
    const jan = series.slice(0, 31 * 24).reduce((a, b) => a + b, 0) / 31;
    const jun = series.slice(dayOfYear(6, 1) * 24, dayOfYear(7, 1) * 24).reduce((a, b) => a + b, 0) / 30;
    expect(table[0].flat().reduce((a, b) => a + b)).toBeGreaterThan(table[5].flat().reduce((a, b) => a + b));
    expect(jan).toBeGreaterThan(jun);
  });

  it("usa il calendario delle tariffe, con festivi, Pasquetta, ora legale e ritorno a gennaio", () => {
    const table = arera.profiles.fino3.nord;
    const series = seasonalDemand(2700, "distribuito", table, curveCell);
    const k = series[0] / table[0][2][1]; // Capodanno, ore 01 locali
    for (const [month, day, utcHour, kind, hour] of [[1, 2, 11, 0, 12], [1, 4, 11, 1, 12], [1, 5, 11, 2, 12], [4, 21, 10, 2, 12], [7, 15, 10, 0, 12]] as const) {
      const h = dayOfYear(month, day) * 24 + utcHour;
      expect(series[h]).toBeCloseTo(k * table[month - 1][kind][hour], 10);
      if (kind === 2) expect(bandOf(h)).toBe("F3");
    }
    expect(series[HOURS - 1]).toBeCloseTo(k * table[0][2][0], 10);
    const autumn = dayOfYear(10, 26) * 24;
    expect(series[autumn]).toBe(series[autumn + 1]);
  });

  it("l'abitudine serale aumenta la quota dopo le 18 rispetto a quella diurna", () => {
    for (const power of Object.values(arera.profiles)) for (const table of Object.values(power)) {
      const evening = (profile: "diurno" | "serale") => sum(seasonalDemand(2700, profile, table, curveCell).filter((_, h) => localHour(h) >= 18)) / 2700;
      expect(evening("serale")).toBeGreaterThan(evening("diurno"));
    }
  });
});

describe("Profilo elettrico: integrazione", () => {
  it("la curva misurata prevale anche con FV e immissioni; la diagnosi segue il modo scelto", () => {
    for (const existing of [false, true]) {
      const p = house(); p.consumption.measuredCurve = meter();
      if (existing) { p.existingPv.present = true; p.existingPv.consumptionFrom = "contatore"; p.consumption.measuredCurve.immissioni = { ...meter(), ore: new Array<number>(CURVE_CELLS).fill(.01) }; }
      const seasonal = otherUsesDemand(p, 2700, climate), ev = evaluate(p, climate);
      const diag = electricDiagnosis(p, climate, ev.packages[0])!;
      p.consumption.profileMode = "sintetico";
      expect(otherUsesDemand(p, 2700, climate)).toEqual(seasonal);
      expect(evaluate(p, climate)).toEqual(ev);
      const synthetic = electricDiagnosis(p, climate, ev.packages[0])!;
      expect(diag.misurato).toEqual(synthetic.misurato);
      expect(diag.tipico).not.toEqual(synthetic.tipico);
    }
  });

  it("sensibilità: le varianti di abitudine mantengono il modo e la forma stagionale", () => {
    const p = house(), variants = defaultVariants(p, climate).filter((v) => v.label.startsWith(PROFILE_VARIANT_PREFIX));
    expect(variants).toHaveLength(2);
    for (const variant of variants) {
      const v = variant.apply(p);
      expect(v.consumption.profileMode).toBe("stagionale");
      expect(otherUsesDemand(v)).toEqual(seasonalDemand(v.consumption.electricityKwh.value, v.consumption.profile, seasonalTable(v), curveCell));
      expect(otherUsesDemand(v)).not.toEqual(residualDemand(v.consumption.electricityKwh.value, v.consumption.profile));
    }
  });

  it("esportazioni CER e curva: stessi totali e celle del pacchetto, con e senza batteria", () => {
    for (const battery of [false, true]) {
      const p = house(); applyGoal(p, "fv"); p.battery.enabled = battery;
      const ev = evaluate(p, climate);
      expect(ev.ok).toBe(true); expect(nonFinitePaths(ev.packages)).toEqual([]);
      const profile = exportEnergyProfile(p, climate, ev.packages);
      for (const r of ev.packages.filter((r) => r.valid)) {
        const s = packageSeries(p, climate, r), scenario = profile.scenari.find((x) => x.id === r.id)!;
        const curve = exportConsumptionCurve(p, climate, r), full = packageConsumptionCurve(p, climate, r);
        expect(sum(s.demand)).toBeCloseTo(r.elec.demand_kWh, 6);
        expect(sum(s.import)).toBeCloseTo(r.elec.import_kWh, 6);
        expect(gridImportSeries(p, climate, r)).toEqual(s.import);
        expect(curve.kwh_annui).toBe(Math.round(r.elec.import_kWh * 10) / 10);
        expect(scenario.consumi.kwh_annui).toBe(Math.round(r.elec.demand_kWh * 10) / 10);
        expect(scenario.prelievi.kwh_annui).toBe(curve.kwh_annui);
        expect(scenario.prelievi.ore).toEqual(curve.ore);
        expect(full).toEqual(curve);
      }
    }
  });

  it("conserva le curve degli altri usi senza controllo dipendente dal surplus FV", () => {
    const p = house(); p.cooling.today = "split"; p.heatPump.model = "parametrico"; p.system.emitters = "ventilconvettori";
    p.dhw.replace = true; p.ev.enabled = true;
    const seasonal = evaluate(p, climate);
    p.consumption.profileMode = "sintetico";
    const synthetic = evaluate(p, climate);
    expect(seasonal.ok).toBe(true);
    for (const r of seasonal.packages) {
      const before = synthetic.packages.find((x) => x.id === r.id)!;
      expect(r.hp?.elec).toEqual(before.hp?.elec);
      expect(r.cooling?.elec).toEqual(before.cooling?.elec);
      // Il controllo dello scaldacqua col sole e la ricarica adattata al carico restano quelli esistenti:
      // possono cambiare risposta quando cambia il surplus; senza FV le loro curve coincidono.
      if (!r.has.P) {
        expect(r.dhw?.result.elec).toEqual(before.dhw?.result.elec);
        expect(r.ev?.elec).toEqual(before.ev?.elec);
      }
    }
  });
});

describe("Profilo elettrico: importazione", () => {
  it("accetta entrambi i modi, conserva l'assenza e non aggiunge avvisi ai file vecchi", () => {
    const p = exampleProject(), before = parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni);
    expect(before.errors).toEqual([]); expect(before.warnings).toEqual([]);
    expect(before.file!.input.consumption.profileMode).toBeUndefined();
    for (const mode of ["sintetico", "stagionale"] as const) {
      p.consumption.profileMode = mode;
      const parsed = parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni);
      expect(parsed.errors).toEqual([]); expect(parsed.warnings).toEqual([]);
      expect(parsed.file!.input.consumption.profileMode).toBe(mode);
    }
  });

  it("rifiuta valori non ammessi e tipi sbagliati anche nelle bozze", () => {
    for (const mode of [null, false, 0, "", "ARERA", [], {}, { mode: "stagionale" }]) {
      const p = exampleProject(); Object.assign(p.consumption, { profileMode: mode });
      expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("consumption.profileMode"))).toBe(true);
      for (const draft of [false, true]) {
        const parsed = parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni, { draft });
        expect(parsed.file).toBeUndefined();
        expect(parsed.errors.some((e) => e.includes("consumption.profileMode"))).toBe(true);
      }
    }
  });
});

describe("Profilo elettrico nell'interfaccia", () => {
  it("la scelta è visibile in Rapida e Documentata, con fonte, anno, licenza e limiti", () => {
    for (const doc of [false, true]) {
      const p = house();
      const form = () => renderToStaticMarkup(createElement(ConsumptionForm, { p, up: () => {}, doc, issues: [] }));
      const html = form();
      for (const label of ["Andamento nell&#x27;anno", "Uguale tutti i giorni (come finora)", "Con le stagioni", "CC BY-SA 4.0", "2025", ARERA_PROFILE_SOURCE.url, "La curva del tuo contatore resta il dato migliore"]) expect(html).toContain(label);
      p.consumption.measuredCurve = meter();
      expect(form()).not.toContain("Andamento nell&#x27;anno");
    }
  });

  it("risultati e report dichiarano ARERA solo quando usata; la misura ha precedenza", () => {
    const p = house(); applyGoal(p, "fv");
    const markup = () => { const ev = evaluate(p, climate); return [renderToStaticMarkup(createElement(Results, { p, ev, climate, sens: null })), renderToStaticMarkup(createElement(Report, { p, ev, climate, sens: null }))]; };
    const [results, report] = markup();
    expect(results).toContain("medio ARERA con le stagioni");
    expect(report).toContain(ARERA_PROFILE_SOURCE.source); expect(report).toContain("CC BY-SA 4.0");
    p.consumption.measuredCurve = meter();
    for (const html of markup()) expect(html).not.toContain("medio ARERA con le stagioni");
  });
});
