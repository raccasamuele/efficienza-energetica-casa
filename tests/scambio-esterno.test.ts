import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  buildEnvelope,
  exampleProject,
  exchangeSeries,
  exteriorCoefficients,
  hourlyU,
  parseProjectFile,
  simulateThermal,
  solAirTemp,
  checkProject,
} from "../src/engine";
import { constantClimate, loadMilano } from "./helpers";

const milano = loadMilano();

describe("Scambio con l'esterno ora per ora (motore 0.6.0)", () => {
  it("con he = 25 W/m²K la U dell'ora è quella della norma", () => {
    expect(hourlyU(1.1, 25)).toBeCloseTo(1.1, 12);
    expect(hourlyU(1.1, 10)).toBeLessThan(1.1);
    expect(hourlyU(1.1, 100)).toBeGreaterThan(1.1);
  });

  it("coefficiente esterno: 4 + 4·(0,5·v10) più l'irraggiamento", () => {
    const a = exteriorCoefficients(10, 0);
    const b = exteriorCoefficients(10, 4);
    expect(b.he - a.he).toBeCloseTo(8, 12);
    expect(a.hre).toBeCloseTo(0.9 * 4 * 5.67e-8 * 283.15 ** 3, 12);
    expect(a.he).toBeCloseTo(4 + a.hre, 12);
  });

  it("sole-aria: il sole alza, il cielo abbassa; il vetro non assorbe", () => {
    const { he, hre } = exteriorCoefficients(5, 2);
    expect(solAirTemp(5, 400, { alpha: 0.6, sky: 0.5 }, he, hre)).toBeCloseTo(5 + (0.6 * 400 - 0.5 * hre * 11) / he, 12);
    expect(solAirTemp(5, 0, { alpha: 0.6, sky: 1 }, he, hre)).toBeLessThan(5);
    expect(solAirTemp(5, 800, { alpha: 0, sky: 0.5 }, he, hre)).toBe(solAirTemp(5, 0, { alpha: 0, sky: 0.5 }, he, hre));
  });

  it("superfici esterne divise per orientamento, stessa H della norma", () => {
    const p = exampleProject();
    const env = buildEnvelope(p.building, p.service, milano);
    const walls = env.exchanges.filter((e) => e.label.startsWith("Pareti esterne"));
    const windows = env.exchanges.filter((e) => e.label.startsWith("Serramenti"));
    expect(walls.every((e) => e.outdoor && e.outdoor.alpha === p.building.solarAbsorptance.value && e.outdoor.sky === 0.5)).toBe(true);
    expect(windows.every((e) => e.outdoor && e.outdoor.alpha === 0)).toBe(true);
    for (const e of [...walls, ...windows]) expect(e.H).toBeCloseTo(e.outdoor!.uRef * e.outdoor!.area, 9);
    // l'esempio ha il sottotetto: nessuna copertura esposta
    expect(env.exchanges.some((e) => e.outdoor?.surface === "tetto")).toBe(false);
    const flat = { ...p.building, upper: "coperturaPiana" as const };
    const roof = buildEnvelope(flat, p.service, milano).exchanges.find((e) => e.label === "Copertura")!;
    expect(roof.outdoor).toMatchObject({ surface: "tetto", sky: 1 });
    const pitched = buildEnvelope({ ...p.building, upper: "coperturaInclinata" }, p.service, milano).exchanges.find((e) => e.label === "Copertura")!;
    expect(pitched.outdoor!.sky).toBe(0.93);
  });

  it("senza vento a 0 °C e senza sole lo scambio è costante e conserva l'energia", () => {
    const p = exampleProject();
    const clim = constantClimate(0);
    const env = buildEnvelope(p.building, p.service, clim);
    const { H, B } = exchangeSeries(env, clim);
    expect(new Set(H).size).toBe(1);
    expect(new Set(B).size).toBe(1);
    expect(H[0]).toBeLessThan(env.H); // vento debole: resistenza esterna più alta di 0,04
  });

  it("superfici scure: meno riscaldamento e più raffrescamento", () => {
    const p = exampleProject();
    p.building.upper = "coperturaPiana";
    const light = simulateThermal({ ...p.building, solarAbsorptance: { ...p.building.solarAbsorptance, value: 0.3 } }, p.service, milano, p.cooling);
    const dark = simulateThermal({ ...p.building, solarAbsorptance: { ...p.building.solarAbsorptance, value: 0.9 } }, p.service, milano, p.cooling);
    expect(dark.heatNeed_kWh).toBeLessThan(light.heatNeed_kWh);
    expect(dark.coolNeed_kWh).toBeGreaterThan(light.coolNeed_kWh);
  });

  it("assorbimento fuori intervallo è un errore", () => {
    const p = exampleProject();
    p.building.solarAbsorptance.value = 1.2;
    expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("Assorbimento del sole"))).toBe(true);
  });

  it("progetto salvato prima: assorbimento 0,6 ipotizzato senza avviso di campi mancanti", () => {
    const p = exampleProject();
    delete (p.building as Partial<typeof p.building>).solarAbsorptance;
    const parsed = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: "0.5.0", input: p }), milano);
    expect(parsed.errors).toEqual([]);
    expect(parsed.file!.input.building.solarAbsorptance).toMatchObject({ value: 0.6, status: "ipotizzato" });
    expect(parsed.warnings.filter((w) => !w.startsWith("Anagrafe dei comuni"))).toEqual([`Progetto salvato con motore 0.5.0: i risultati vengono ricalcolati con ${ENGINE_VERSION}.`]);
  });
});
