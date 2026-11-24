import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { control5R1C, defaultHeatingSchedule, defaultVariants, envelopeBreakdown, evaluate, evaluateModel, exchangeSplit, exportConsumptionCurve, exportEnergyProfile, exampleProject, flowTemperature, heatingScheduleErrors, HOURS, localHour, nonFinitePaths, parseProjectFile, performance, q, scheduledHeating, seasonMask, simulateThermal, solarGainAtHour, step5R1C, toProjectFile, type ProjectInput } from "../src/engine";
import { SystemForm } from "../src/ui/forms";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { startProject } from "../src/ui/journey";
import { constantClimate, loadMilano, loadMilanoLegacy } from "./helpers";

const climate = loadMilano();
const house = () => { const p = exampleProject(); p.service.schedule = defaultHeatingSchedule(); return p; };
const run = (p: ProjectInput, power = 100000) => simulateThermal(p.building, p.service, climate, undefined, undefined, scheduledHeating(p.service, power));

describe("Riscaldamento a orari 0.16.0: percorso continuo", () => {
  it("assente e continuo restano identici sull'esempio e su altre tre case", () => {
    const cases = [exampleProject(), startProject("rapida", true, "pdc"), startProject("rapida", true, "serramenti"), startProject("documentata", true, "completo")];
    cases[1].building.floorArea.value = 80; cases[1].building.floors.value = 1; cases[1].building.upper = "riscaldato";
    cases[2].building.floorArea.value = 200; cases[2].building.shape = "L"; cases[2].building.lower = "terreno";
    cases[3].building.heatCapacityPerArea.value = 370; cases[3].building.uWall.value = .3; cases[3].building.uUpper.value = .2; cases[3].building.uLower.value = .4;
    for (const p of cases) {
      const before = evaluate(p, climate);
      expect(before.ok).toBe(true);
      p.service.schedule = { ...defaultHeatingSchedule(), mode: "continuo" };
      expect(evaluate(p, climate)).toEqual(before);
      p.service.schedule.mode = "fasce";
      const thermal = simulateThermal(p.building, p.service, climate);
      delete p.service.schedule;
      expect(thermal).toEqual(simulateThermal(p.building, p.service, climate));
    }
  });

  it("conserva le fixture esistenti su tre case e sull'esempio", () => {
    type Row = { id: string; npv: number | null; spending: number; electricityKwh: number; gasSmc: number; investment: number };
    const fixtures = JSON.parse(readFileSync(resolve(__dirname, "fixtures/casa-prima.json"), "utf8")) as { mode: ProjectInput["mode"]; goal: ProjectInput["goal"]; packages: Row[] }[];
    for (const f of fixtures.filter((x) => ["pdc", "serramenti", "completo"].includes(x.goal)).slice(0, 3)) {
      const p = startProject(f.mode, true, f.goal);
      p.service.schedule = { ...defaultHeatingSchedule(), mode: "continuo" };
      const ev = evaluate(p, loadMilanoLegacy());
      expect(ev.packages.map((r) => ({ id: r.id, npv: r.cash?.npv ?? null, spending: r.costs.total, electricityKwh: r.elec.import_kWh, gasSmc: r.gasSmc, investment: r.investment }))).toEqual(f.packages);
    }
    const f = JSON.parse(readFileSync(resolve(__dirname, "fixtures/involucro-prima.json"), "utf8")) as { name: string; packages: { heatNeed_kWh: number; peak_kW: number }[] }[];
    const p = house(); p.service.schedule!.mode = "continuo";
    const ev = evaluate(p, loadMilanoLegacy());
    expect(ev.packages[0].heatNeed_kWh).toBe(f[0].packages[0].heatNeed_kWh);
    expect(ev.packages[0].peak_kW).toBe(f[0].packages[0].peak_kW);
  });
});

describe("Riscaldamento a orari: fisica", () => {
  it("0–24 e ridotta uguale al setpoint coincidono con il continuo", () => {
    const p = house();
    const continuous = simulateThermal(p.building, p.service, climate);
    p.service.schedule!.bands = [{ start: 0, end: 24 }];
    expect(run(p).heatNeed_kWh / continuous.heatNeed_kWh).toBeCloseTo(1, 6);
    expect(run(p).schedule!.meanOutsideTemp).toBeNull();
    p.service.schedule = defaultHeatingSchedule(); p.service.schedule.setback = "ridotta";
    p.service.schedule.setbackTemp.value = p.service.setpoint.value;
    expect(run(p).qHeat).toEqual(continuous.qHeat);
  });

  it("con spento risparmia meno della proporzione delle ore; ridotta consuma di più", () => {
    const p = house(), continuous = simulateThermal(p.building, p.service, climate), off = run(p);
    expect(off.heatNeed_kWh).toBeLessThan(continuous.heatNeed_kWh);
    expect(off.heatNeed_kWh).toBeGreaterThan(continuous.heatNeed_kWh * 9 / 24);
    p.service.schedule!.setback = "ridotta";
    expect(run(p).heatNeed_kWh).toBeGreaterThan(off.heatNeed_kWh);
  });

  it("rispetta Pmax, conta le ore fredde e disattiva il rinvio di inizio stagione", () => {
    const p = house(), t = run(p, 2000);
    expect(t.ok).toBe(true); expect(Math.max(...t.qHeat)).toBeLessThanOrEqual(2000);
    expect(t.schedule!.coldHours).toBeGreaterThan(t.schedule!.bandHours * .05);
    expect(t.recovery.every((x) => !x)).toBe(true); expect(t.recoveryBudget_Wh.every((x) => x === 0)).toBe(true);
    const mask = seasonMask(p.service);
    const expected = t.tIndoor.filter((temp, h) => mask[h] && [6, 7, 8, 17, 18, 19, 20, 21, 22].includes(localHour(h)) && temp < p.service.setpoint.value - .5).length;
    expect(t.schedule!.coldHours).toBe(expected);
  });

  it("C.4.2 ripete il passo alla potenza massima e lascia invariato il freddo", () => {
    const x = { Hve: 100, Bve: 0, Hw: 50, Bw: 0, Hop: 150, Bop: 0 };
    const limited = control5R1C(10, x, 1.65e7, 250, 100, 400, 0, 20, null, 2000);
    expect(limited.nodes).toEqual(step5R1C(10, x, 1.65e7, 250, 100, 400, 0, 2000)); expect(limited.qHeat).toBe(2000);
    expect(control5R1C(35, x, 1.65e7, 250, 100, 400, 30000, null, 26, 1)).toEqual(control5R1C(35, x, 1.65e7, 250, 100, 400, 30000, null, 26));
  });

  it("chiude il bilancio dei nodi per un anno a fasce entro 1e-9 relativo", () => {
    const p = house(), c = constantClimate(0);
    p.service.seasonStart = { month: 1, day: 1 }; p.service.seasonEnd = { month: 12, day: 31 };
    const t = simulateThermal(p.building, p.service, c, undefined, undefined, scheduledHeating(p.service, 12000));
    expect(t.converged).toBe(true);
    const env = t.envelope, split = exchangeSplit(env, c);
    let supplied = 0, lost = 0, stored = 0, mass = t.tMass[HOURS - 1];
    for (let h = 0; h < HOURS; h++) {
      const x = { Hve: split.ve.H[h], Bve: split.ve.B[h], Hw: split.w.H[h], Bw: split.w.B[h], Hop: split.op.H[h], Bop: split.op.B[h] };
      const sol = solarGainAtHour(env, c, h), n = step5R1C(mass, x, env.C, env.Am, env.Af, env.internalGainW, sol, t.qHeat[h]);
      const hem = x.Hop * 9.1 * env.Am / (9.1 * env.Am - x.Hop);
      supplied += t.qHeat[h] + env.internalGainW * (1 - x.Hw / (9.1 * 4.5 * env.Af) * .5) + sol * (1 - x.Hw / (9.1 * 4.5 * env.Af));
      lost += x.Hve * n.thetaAir - x.Bve + x.Hw * n.thetaS - x.Bw + hem * (n.thetaM - x.Bop / x.Hop);
      stored += env.C * (n.thetaMEnd - mass) / 3600;
      mass = n.thetaMEnd;
    }
    expect(Math.abs(supplied - lost - stored) / supplied).toBeLessThan(1e-9);
    expect(t.heatNeed_kWh).toBeCloseTo(t.qHeat.reduce((a, b) => a + b, 0) / 1000, 8);
  });

  it("la casa pesante risparmia meno di quella leggera a parità di fasce", () => {
    const savings = (capacity: number) => {
      const p = house(); p.building.heatCapacityPerArea.value = capacity;
      const c = constantClimate(0), continuous = simulateThermal(p.building, p.service, c).heatNeed_kWh;
      const scheduled = simulateThermal(p.building, p.service, c, undefined, undefined, scheduledHeating(p.service, 100000)).heatNeed_kWh;
      return (continuous - scheduled) / continuous;
    };
    expect(savings(370)).toBeLessThan(savings(80));
  });

  it("tenuta all'aria segue la temperatura vera; orari civili con ora legale", () => {
    const p = house(); p.building.infiltration.mode = "tenuta"; p.building.infiltration.n50 = q(8, "misurato", "Prova di tenuta");
    const continuous = simulateThermal(p.building, p.service, climate), bands = run(p, 12000);
    expect(bands.airChange).not.toEqual(continuous.airChange);
    const target = scheduledHeating(p.service, 12000).tSetHour, mask = seasonMask(p.service);
    for (let h = 0; h < HOURS; h++) expect(target[h]).toBe(mask[h] && [6, 7, 8, 17, 18, 19, 20, 21, 22].includes(localHour(h)) ? 20 : null);
  });
});

describe("Pacchetti, importazione e interfaccia", () => {
  it("apre i vecchi progetti senza avvisi nuovi; rifiuta schedule malformati anche nelle bozze", () => {
    const p = exampleProject(), file = toProjectFile(p, climate), old = parseProjectFile(JSON.stringify(file), climate);
    expect(old.errors).toEqual([]); expect(old.warnings.filter((w) => !w.startsWith("Anagrafe"))).toEqual([]);
    expect(old.file!.input.service.schedule).toBeUndefined();
    const bad: unknown[] = [null, [], {}, { ...defaultHeatingSchedule(), bands: [] }, { ...defaultHeatingSchedule(), bands: [{ start: 6.5, end: 9 }] }, { ...defaultHeatingSchedule(), bands: [{ start: 6, end: 9 }, { start: 8, end: 10 }] }, { ...defaultHeatingSchedule(), bands: [{ start: 23, end: 6 }] }, { ...defaultHeatingSchedule(), setbackTemp: q(21) }, { ...defaultHeatingSchedule(), maxPowerKw: q(101) }, { ...defaultHeatingSchedule(), maxPowerKw: { value: "10", status: "ipotizzato" } }, { ...defaultHeatingSchedule(), withHeatPump: "mai" }, { ...defaultHeatingSchedule(), mode: "altro" }, { ...defaultHeatingSchedule(), setback: "altro" }];
    for (const schedule of bad) {
      const raw = { ...file, input: { ...p, service: { ...p.service, schedule } } };
      const result = parseProjectFile(JSON.stringify(raw), climate, undefined, { draft: true });
      expect(result.file).toBeUndefined(); expect(result.errors.join(" ")).toContain("service.schedule");
    }
    for (const schedule of [
      { ...defaultHeatingSchedule(), mode: ["fasce"] },
      { ...defaultHeatingSchedule(), setback: ["spento"] },
      { ...defaultHeatingSchedule(), withHeatPump: ["continuo"] },
      { ...defaultHeatingSchedule(), maxPowerKw: { value: 10, status: ["ipotizzato"] } },
      { ...defaultHeatingSchedule(), setbackTemp: { ...q(16), source: 42 } },
    ]) expect(parseProjectFile(JSON.stringify({ ...file, input: { ...p, service: { ...p.service, schedule } } }), climate).errors.join(" ")).toContain("service.schedule");
    p.service.schedule = defaultHeatingSchedule(); p.service.continuousService = false;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate).errors).toEqual([]);
    expect(evaluate(p, climate).issues.some((i) => i.message.includes("servizio continuo equivalente"))).toBe(false);
    expect(heatingScheduleErrors({ ...defaultHeatingSchedule(), bands: [{ start: 0, end: 24 }] }, 20)).toEqual([]);
  });

  it("nella casa nuova la domanda non ha una risposta già scelta; nell'esempio e dopo la scelta sì", () => {
    const form = (p: ProjectInput) => renderToStaticMarkup(createElement(SystemForm, { p, up: () => {}, doc: false, issues: [] }));
    const own = startProject("rapida");
    expect(own.service.schedule).toBeUndefined();
    expect(form(own)).toContain('<option value="" selected="">Scegli…</option>');
    expect(form(own)).toContain("Finché non scegli, il calcolo considera il riscaldamento sempre acceso.");
    for (const answered of [startProject("rapida", true), exampleProject(), { ...own, service: { ...own.service, schedule: { ...defaultHeatingSchedule(), mode: "continuo" as const } } }]) {
      expect(form(answered)).not.toContain("Scegli…");
      expect(form(answered)).not.toContain("Finché non scegli");
    }
  });

  it("mostra scelta e avviso di potenza nei risultati e nel report", () => {
    const p = house(); p.service.schedule!.maxPowerKw = q(2);
    const ev = evaluate(p, climate);
    const form = renderToStaticMarkup(createElement(SystemForm, { p, up: () => {}, doc: false, issues: ev.issues }));
    expect(form).toContain("Come scaldi oggi?"); expect(form).toContain("Fuori fascia"); expect(form).toContain("Non lo so");
    for (const html of [renderToStaticMarkup(createElement(Results, { p, ev, climate, sens: null })), renderToStaticMarkup(createElement(Report, { p, ev, climate, sens: null }))]) {
      expect(html).toContain("A fasce: 9 ore"); expect(html).toContain("non arriva a");
    }
  });

  it("stima dalla casa attuale, conserva i picchi continui e usa il continuo con PDC", () => {
    const p = house(), ev = evaluate(p, climate);
    const continuous = evaluate({ ...p, service: { ...p.service, schedule: undefined } }, climate);
    expect(ev.ok).toBe(true);
    expect(ev.thermal!.base.schedule!.pMax_W).toBe(continuous.thermal!.base.peak_W * 1.5);
    expect(ev.thermal!.windows.schedule!.pMax_W).toBe(ev.thermal!.base.schedule!.pMax_W);
    for (const id of ["base", "W", "P", "WP", "H", "WH", "HP", "WHP"]) {
      const a = ev.packages.find((r) => r.id === id)!, b = continuous.packages.find((r) => r.id === id)!;
      expect(a.peak_kW).toBe(b.peak_kW);
      if (id.includes("H")) { expect(a.heatNeed_kWh).toBe(b.heatNeed_kWh); expect(a.conditions.join(" ")).toContain("la casa è più calda"); }
      else expect(a.heatNeed_kWh).toBeLessThan(b.heatNeed_kWh);
    }
    expect(nonFinitePaths(ev.packages)).toEqual([]);
    expect(ev.calibration).toBeNull();
    expect(ev.calibrationNote).toContain("troppo lontana");
    p.service.schedule!.setback = "ridotta";
    expect(evaluate(p, climate).calibration!.factor).toBeGreaterThan(continuous.calibration!.factor);
  });

  it("PDC come oggi: potenza oraria, ore fredde senza blocco per sottotaglia, profili CER", () => {
    const p = house(); p.service.schedule!.withHeatPump = "come-oggi";
    p.heatPump.model = "parametrico"; p.heatPump.nominalCapacity.value = 3;
    const ev = evaluateModel(p, climate), hp = ev.packages.find((r) => r.id === "H")!;
    expect(hp.schedule!.coldHours).toBeGreaterThan(0);
    expect(hp.hp!.hoursUndersized).toBe(0); expect(hp.conditions.join(" ")).toContain("ore fredde");
    const power = climate.series.tAir.map((air) => { const perf = performance(air, flowTemperature(air, p.system.designFlowTemp.value, p.system.designOutdoorTemp.value, p.service.setpoint.value), p.heatPump); return perf.inDomain ? perf.capW : Infinity; });
    const thermal = simulateThermal(p.building, p.service, climate, undefined, undefined, scheduledHeating(p.service, power));
    expect(thermal.qHeat.every((v, h) => v <= power[h])).toBe(true); expect(hp.heatNeed_kWh).toBe(thermal.heatNeed_kWh);
    const curves = exportConsumptionCurve(p, climate, hp), profile = exportEnergyProfile(p, climate, ev.packages, new Date("2026-11-12T12:00:00Z"));
    const scenario = profile.scenari.find((r) => r.id === "H")!;
    expect(scenario.prelievi.kwh_annui).toBe(curves.kwh_annui); expect(scenario.prelievi.ore).toEqual(curves.ore);
  });

  it("scompone l'involucro con la stessa potenza della caldaia", () => {
    const p = house(); p.envelope.walls.enabled = true;
    const ev = evaluate(p, climate), parts = envelopeBreakdown(p, climate, ev)!;
    expect(parts.parts).toHaveLength(2); expect(parts.parts.every((r) => r.heatSaved_kWh > 0)).toBe(true);
  });

  it("senza PDC il pacchetto H mantiene le fasce; il raffrescamento dei pacchetti resta identico", () => {
    const p = house(); p.heatPump.included = false; p.dhw.replace = true; p.cooling.today = "split";
    const bands = evaluateModel(p, climate), continuous = evaluateModel({ ...p, service: { ...p.service, schedule: undefined } }, climate);
    expect(bands.packages.find((r) => r.id === "H")!.heatNeed_kWh).toBe(bands.packages[0].heatNeed_kWh);
    for (const r of bands.packages) {
      const original = continuous.packages.find((x) => x.id === r.id)!;
      expect(r.coolNeed_kWh).toBe(original.coolNeed_kWh); expect(r.cooling).toEqual(original.cooling);
    }
  });

  it("sensibilità: sposta le fini senza sovrapporre; potenze 1,2 / 2 dal continuo", () => {
    const p = house(); p.service.schedule!.bands = [{ start: 6, end: 9 }, { start: 9, end: 10 }];
    const variants = defaultVariants(p, climate);
    expect(variants.find((v) => v.id === "fasce+")!.apply(p).service.schedule!.bands).toEqual([{ start: 6, end: 9 }, { start: 9, end: 11 }]);
    expect(variants.find((v) => v.id === "fasce-")!.apply(p).service.schedule!.bands).toEqual([{ start: 6, end: 8 }, { start: 9, end: 10 }]);
    for (const factor of [1.2, 2]) {
      const changed = variants.find((v) => v.id === `potenza-${factor}`)!.apply(p);
      expect(changed.service.schedule!.maxPowerKw.value).toBe(factor * simulateThermal(p.building, p.service, climate).peak_W / 1000);
      expect(changed.service.schedule!.maxPowerKw.status).toBe("ipotizzato");
    }
    p.service.schedule!.maxPowerKw.status = "documentato";
    expect(defaultVariants(p, climate).some((v) => v.id.startsWith("potenza-"))).toBe(false);
  });
});
