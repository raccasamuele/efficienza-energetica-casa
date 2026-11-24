import { describe, expect, it } from "vitest";
import { HOURS, cyclingCop, defaultVariants, exampleProject, flowTemperature, heatPumpModeHours, performance, simulateHeatPump } from "../src/engine";
import { constantClimate } from "./helpers";
import { HP_CATALOG } from "../src/engine/heatpump";

describe("motore 0.9.0: carico parziale e ausiliari", () => {
  it("neutralità parametrica: coincide con il calcolo 0.8.0 calore/COP", () => {
    const p = exampleProject();
    p.heatPump.model = "parametrico";
    p.heatPump.minModulation.value = 0;
    p.heatPump.pTO_W.value = p.heatPump.pOFF_W.value = p.heatPump.pCK_W.value = p.heatPump.extraPump_W.value = 0;
    const climate = constantClimate(7);
    const q = new Array<number>(HOURS).fill(0);
    q[200] = 500; q[300] = 800;
    const expectedElec = new Array<number>(HOURS).fill(0);
    const flow = flowTemperature(7, p.system.designFlowTemp.value, p.system.designOutdoorTemp.value);
    const perf = performance(7, flow, p.heatPump);
    expectedElec[200] = q[200]! / perf.cop; expectedElec[300] = q[300]! / perf.cop;
    const expected = q.reduce((sum, load) => {
      if (!load) return sum;
      const flow = flowTemperature(7, p.system.designFlowTemp.value, p.system.designOutdoorTemp.value);
      const perf = performance(7, flow, p.heatPump);
      return sum + load / perf.cop;
    }, 0) / 1000;
    const r = simulateHeatPump(q, climate, p.heatPump, p.system);
    expect(r.elec_kWh).toBeCloseTo(expected, 12);
    expect(r.elec).toEqual(expectedElec);
    expect(r.seasonalCop).toBeCloseTo((500 + 800) / (expected * 1000), 12);
    expect(r.elecAux_kWh).toBe(0);
    expect(r.elecCycling_kWh).toBe(0);
  });

  it("neutralità catalogo: coincide con il calcolo 0.8.0 calore/COP", () => {
    const p = exampleProject();
    p.heatPump.model = "catalogo";
    p.heatPump.catalogId = "acond-pro-n";
    p.heatPump.minModulation.value = 0;
    p.heatPump.pTO_W.value = p.heatPump.pOFF_W.value = p.heatPump.pCK_W.value = p.heatPump.extraPump_W.value = 0;
    const climate = constantClimate(7);
    const q = new Array<number>(HOURS).fill(0);
    const expectedElec = new Array<number>(HOURS).fill(0);
    let expectedWh = 0;
    for (let h = 0; h < HOURS; h++) {
      const flow = flowTemperature(7, p.system.designFlowTemp.value, p.system.designOutdoorTemp.value);
      const perf = performance(7, flow, p.heatPump);
      if (perf.inDomain) { q[h] = perf.capW * 0.5; expectedElec[h] = q[h]! / perf.cop; expectedWh += expectedElec[h]!; }
    }
    const r = simulateHeatPump(q, climate, p.heatPump, p.system);
    expect(r.elec_kWh).toBeCloseTo(expectedWh / 1000, 10);
    expect(r.elec).toEqual(expectedElec);
    expect(r.elecAux_kWh).toBe(0);
    expect(r.elecCycling_kWh).toBe(0);
  });

  it("formula dei cicli: CR=1, Cd=1 e un calcolo verificato a mano", () => {
    expect(cyclingCop(4, 1, 0.9)).toBe(4);
    expect(cyclingCop(4, 0.4, 1)).toBe(4);
    expect(cyclingCop(4, 0.5, 0.9)).toBeCloseTo(4 * 0.5 / (0.9 * 0.5 + 0.1), 12);
  });

  it("riduce il COP in simulazione solo sotto la modulazione minima", () => {
    const p = exampleProject(); p.heatPump.model = "parametrico";
    p.heatPump.minModulation.value = 0.5; p.heatPump.cyclingCd.value = 0.9;
    p.heatPump.pTO_W.value = p.heatPump.pOFF_W.value = p.heatPump.pCK_W.value = p.heatPump.extraPump_W.value = 0;
    const climate = constantClimate(0), q = new Array<number>(HOURS).fill(0);
    const flow = flowTemperature(0, p.system.designFlowTemp.value, p.system.designOutdoorTemp.value);
    const perf = performance(0, flow, p.heatPump), delivered = perf.capW * 0.25;
    q[500] = delivered;
    const expectedCop = cyclingCop(perf.cop, 0.5, 0.9);
    const r = simulateHeatPump(q, climate, p.heatPump, p.system);
    expect(r.elec[500]).toBeCloseTo(delivered / expectedCop, 8);
    expect(r.elecCycling_kWh).toBeCloseTo((delivered / expectedCop - delivered / perf.cop) / 1000, 10);
    expect(r.hoursBelowMinModulation).toBe(1);
  });

  it("assegna le 8760 ore a modi non sovrapposti", () => {
    const climate = constantClimate(0);
    const modes = heatPumpModeHours(new Array<number>(HOURS).fill(0), climate.series.tAir, new Array<boolean>(HOURS).fill(true));
    expect(Object.values(modes).reduce((a, b) => a + b, 0)).toBe(8760);
    expect(modes.standby).toBe(0);
  });

  it("consuma gli ausiliari fuori dal modo attivo secondo il modo assegnato", async () => {
    const p = exampleProject(); p.heatPump.model = "parametrico";
    p.heatPump.pTO_W.value = 8; p.heatPump.pOFF_W.value = 3; p.heatPump.pCK_W.value = 2;
    const climate = constantClimate(0), q = new Array<number>(HOURS).fill(0);
    const { seasonMask } = await import("../src/engine/thermal");
    const modes = heatPumpModeHours(q, climate.series.tAir, seasonMask(exampleProject().service));
    const expected = (modes.termostato * 8 + modes.spenta * 3 + modes.carter * 10) / 1000;
    const r = simulateHeatPump(q, climate, p.heatPump, p.system);
    expect(r.elecAux_kWh).toBeCloseTo(expected, 10);
    expect(r.elec_kWh).toBeCloseTo(expected, 10);
  });

  it("completa i dati 0.8.0 con valori catalogo documentati o mediana parametrica", async () => {
    const { parseComuni, parseProjectFile, toProjectFile } = await import("../src/engine");
    const { readPublicJson, loadMilanoLegacy } = await import("./helpers");
    const climate = loadMilanoLegacy(), file = toProjectFile(exampleProject(), climate);
    file.engineVersion = "0.8.0";
    delete (file.input.heatPump as Partial<typeof file.input.heatPump>).minModulation;
    delete (file.input.heatPump as Partial<typeof file.input.heatPump>).cyclingCd;
    delete (file.input.heatPump as Partial<typeof file.input.heatPump>).pTO_W;
    delete (file.input.heatPump as Partial<typeof file.input.heatPump>).pOFF_W;
    delete (file.input.heatPump as Partial<typeof file.input.heatPump>).pCK_W;
    delete (file.input.heatPump as Partial<typeof file.input.heatPump>).extraPump_W;
    const result = parseProjectFile(JSON.stringify(file), climate, parseComuni(readPublicJson("comuni.json")));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["Progetto salvato con motore 0.8.0: i risultati vengono ricalcolati con 0.18.1."]);
    const hp = result.file!.input.heatPump;
    expect([hp.minModulation.status, hp.cyclingCd.status, hp.pTO_W.status, hp.pOFF_W.status, hp.pCK_W.status, hp.extraPump_W.status]).toEqual(["ipotizzato", "ipotizzato", "documentato", "documentato", "documentato", "ipotizzato"]);
    expect([hp.pTO_W.value, hp.pOFF_W.value, hp.pCK_W.value]).toEqual([11, 11, 11]);
    const paramFile = structuredClone(file); paramFile.input.heatPump.model = "parametrico";
    const param = parseProjectFile(JSON.stringify(paramFile), climate, parseComuni(readPublicJson("comuni.json"))).file!.input.heatPump;
    expect([param.pTO_W.value, param.pOFF_W.value, param.pCK_W.value]).toEqual([16, 16, 0]);
    expect([param.pTO_W.status, param.pOFF_W.status, param.pCK_W.status]).toEqual(["ipotizzato", "ipotizzato", "ipotizzato"]);
  });

  it("include le variazioni di Cd, modulazione minima e ausiliari nella sensibilità", () => {
    const ids = defaultVariants(exampleProject()).map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["cd-", "mod-", "mod+", "pTO_W-0.5", "pTO_W-2", "pOFF_W-0.5", "pOFF_W-2"]));
  });
  it("usa la stagione configurata e somma il carter al termostato spento", async () => {
    const { seasonMask } = await import("../src/engine/thermal");
    const p = exampleProject(); p.heatPump.model = "parametrico";
    p.service.seasonStart = { month: 12, day: 1 }; p.service.seasonEnd = { month: 3, day: 1 };
    p.heatPump.pTO_W.value = 8; p.heatPump.pCK_W.value = 2; p.heatPump.pOFF_W.value = 3;
    const climate = constantClimate(0), q = new Array<number>(HOURS).fill(0), mask = seasonMask(p.service);
    const r = simulateHeatPump(q, climate, p.heatPump, p.system, [], [], 20, [], mask);
    const heating = mask.filter(Boolean).length;
    expect(r.elecAux_kWh).toBeCloseTo((heating * 10 + (HOURS - heating) * 3) / 1000, 10);
  });

  it("fa incidere gli ausiliari regolabili su una macchina catalogata", () => {
    const p = exampleProject(); p.heatPump.model = "catalogo"; p.heatPump.catalogId = "acond-pro-n";
    const q = new Array<number>(HOURS).fill(0), climate = constantClimate(0);
    const run = (hp: typeof p.heatPump) => simulateHeatPump(q, climate, hp, p.system).elecAux_kWh;
    const baseline = structuredClone(p.heatPump), toHalf = structuredClone(baseline), offDouble = structuredClone(baseline);
    toHalf.pTO_W.value *= 0.5; offDouble.pOFF_W.value *= 2;
    expect(run(toHalf)).not.toBe(run(baseline)); expect(run(offDouble)).not.toBe(run(baseline));
  });

  it("aggiunge la pompa primaria nelle ore attive per entrambi i modelli", () => {
    for (const model of ["catalogo", "parametrico"] as const) {
      const p = exampleProject(); p.heatPump.model = model; p.heatPump.catalogId = "acond-pro-n";
      p.heatPump.extraPump_W.value = 20;
      const q = new Array<number>(HOURS).fill(0); q[500] = 100;
      const r = simulateHeatPump(q, constantClimate(7), p.heatPump, p.system);
      expect(r.elec[500]).toBeGreaterThan(20); expect(r.elecAux_kWh).toBeGreaterThanOrEqual(0.02);
    }
  });

  it("conserva i dati ausiliari per modello, verificati sui certificati Keymark", () => {
    const byId = Object.fromEntries(HP_CATALOG.map(m => [m.id, m.aux]));
    expect(byId["kronoterm-0209"]).toMatchObject({ pOFF_W: 8, pTO_W: 8, pSB_W: 8, pCK_W: 8, page: expect.stringContaining("011-1W0519") });
    expect(byId["bosch-or-t"]).toMatchObject({ pOFF_W: 22, pTO_W: 0, pSB_W: 22, pCK_W: 0, page: expect.stringContaining("p. 35") });
    expect(byId["kronoterm-0724"]).toMatchObject({ pOFF_W: 11, pTO_W: 11, pSB_W: 11, pCK_W: 11, page: expect.stringContaining("011-1W0518") });
    expect(byId.advantix).toMatchObject({ pOFF_W: 22, pTO_W: 22, pSB_W: 22, pCK_W: 0, page: expect.stringContaining("ICIM-PDC-000073") });
    expect(byId["panasonic-tcap"]).toMatchObject({ pOFF_W: 11, pTO_W: 18, pSB_W: 11, pCK_W: 0, page: expect.stringContaining("011-1W0850") });
    for (const aux of Object.values(byId)) expect(JSON.stringify(aux ?? {})).not.toContain("non verificato");
  });

  it("le varianti ausiliarie disponibili cambiano il risultato per catalogo e modello parametrico", () => {
    for (const [model, catalogId, keys] of [["catalogo", "kronoterm-0724", ["pTO_W", "pOFF_W", "pCK_W"]], ["parametrico", "", ["pTO_W", "pOFF_W"]]] as const) {
      const p = exampleProject(); p.heatPump.model = model; if (catalogId) p.heatPump.catalogId = catalogId;
      if (model === "parametrico") { p.heatPump.pTO_W.value = 16; p.heatPump.pOFF_W.value = 16; p.heatPump.pCK_W.value = 0; }
      const baseline = simulateHeatPump(new Array<number>(HOURS).fill(0), constantClimate(0), p.heatPump, p.system).elecAux_kWh;
      const vars = defaultVariants(p);
      for (const key of keys) {
        const variant = vars.find(v => v.id === `${key}-2`)!;
        const changed = variant.apply(p).heatPump;
        expect(simulateHeatPump(new Array<number>(HOURS).fill(0), constantClimate(0), changed, p.system).elecAux_kWh).not.toBe(baseline);
      }
    }
  });

  it("applica P_OFF nelle ore split se la PDC non raffresca e le esclude se raffresca", async () => {
    const [{ evaluate }, { simulateThermal }, { coolingProject, loadMilanoLegacy }] = await Promise.all([
      import("../src/engine"), import("../src/engine/thermal"), import("./helpers"),
    ]);
    const base = coolingProject(), climate = loadMilanoLegacy();
    base.heatPump.pTO_W.value = 0; base.heatPump.pCK_W.value = 0; base.heatPump.pOFF_W.value = 10;
    const thermal = simulateThermal(base.building, base.service, climate, base.cooling);
    const coolingHoursWithoutHeating = thermal.qCool.reduce((n, q, h) => n + (q > 0 && thermal.qHeat[h] <= 0 ? 1 : 0), 0);
    expect(coolingHoursWithoutHeating).toBeGreaterThan(0);
    const aux = (reversible: boolean) => {
      const p = structuredClone(base); p.heatPump.reversible = reversible;
      const result = evaluate(p, climate).packages.find(x => x.id === "H")!;
      return { aux: result.hp!.elecAux_kWh, generator: result.cooling!.generator };
    };
    const split = aux(false), hp = aux(true);
    expect(split.generator).toMatch(/split/i);
    expect(hp.generator).toMatch(/PDC/i);
    expect(split.aux - hp.aux).toBeCloseTo(coolingHoursWithoutHeating * 10 / 1000, 8);
  });
});
