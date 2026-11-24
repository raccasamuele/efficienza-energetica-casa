import { describe, expect, it } from "vitest";
import { COOL_FLOW, HOURS, HP_CATALOG, heatPumpCooling, parametricEer, simulateHeatPumpCooling } from "../src/engine";
import { constantClimate, coolingProject } from "./helpers";

const reason = (r: ReturnType<typeof heatPumpCooling>) => (r.ok ? "" : r.reason);

describe("Raffrescamento — PDC reversibile", () => {
  it("con i radiatori la PDC non raffresca", () => {
    const p = coolingProject();
    p.system.emitters = "radiatori";
    const r = heatPumpCooling(p);
    expect(r.ok).toBe(false);
    expect(reason(r)).toMatch(/radiatori/);
  });

  it("con ventilconvettori e PDC parametrica raffresca a 7 °C", () => {
    expect(heatPumpCooling(coolingProject())).toEqual({ ok: true, flow: 7 });
    expect(COOL_FLOW).toEqual({ ventilconvettori: 7, radiante: 18 });
  });

  it("radiante usa 18 °C", () => {
    const p = coolingProject();
    p.system.emitters = "radiante";
    expect(heatPumpCooling(p)).toEqual({ ok: true, flow: 18 });
  });

  it("terminali non noti, PDC non reversibile o casa non raffrescata: motivo esplicito", () => {
    const a = coolingProject();
    a.system.emitters = "nonNoto";
    expect(reason(heatPumpCooling(a))).toMatch(/terminali non noti/);
    const b = coolingProject();
    b.heatPump.reversible = false;
    expect(reason(heatPumpCooling(b))).toMatch(/non reversibile/);
    const c = coolingProject();
    c.cooling.today = "nessuno";
    expect(reason(heatPumpCooling(c))).toMatch(/non è raffrescata/);
  });

  it("macchina di catalogo senza EER: motivo esplicito", () => {
    const p = coolingProject();
    p.heatPump.model = "catalogo";
    p.heatPump.catalogId = HP_CATALOG.find((m) => !m.eer)!.id;
    expect(reason(heatPumpCooling(p))).toMatch(/dati di raffrescamento/);
    p.heatPump.catalogId = HP_CATALOG.find((m) => m.eer)!.id;
    expect(heatPumpCooling(p)).toEqual({ ok: true, flow: 7 });
  });

  it("EER parametrico tarato e consumo coerente", () => {
    expect(parametricEer(35, 7, 3)).toBeCloseTo(3, 9);
    expect(parametricEer(25, 18, 3)).toBeGreaterThan(parametricEer(35, 7, 3));
    const q = new Array<number>(HOURS).fill(0);
    q[4000] = 3000;
    const r = simulateHeatPumpCooling(q, constantClimate(35), coolingProject().heatPump, 7);
    expect(r.elec[4000]).toBeCloseTo(1000, 6);
    expect(r.generator).toMatch(/PDC/);
  });

  it("il fattore EER scala solo l'EER", () => {
    const hp = coolingProject().heatPump;
    hp.eerFactor.value = 0.85;
    const q = new Array<number>(HOURS).fill(0);
    q[4000] = 3000;
    expect(simulateHeatPumpCooling(q, constantClimate(35), hp, 7).elec[4000]).toBeCloseTo(1000 / 0.85, 6);
  });

  it("macchina di catalogo reversibile: ore fuori 20–35 °C contate come estrapolate", () => {
    const p = coolingProject();
    p.heatPump.model = "catalogo";
    p.heatPump.catalogId = HP_CATALOG.find((m) => m.eer)!.id;
    const q = new Array<number>(HOURS).fill(0);
    q[10] = 1000;
    const r = simulateHeatPumpCooling(q, constantClimate(38), p.heatPump, 7);
    expect(r.hoursExtrapolated).toBe(1);
    expect(r.elec[10]).toBeGreaterThan(0);
    expect(r.generator).toMatch(/hplib/);
  });
});
