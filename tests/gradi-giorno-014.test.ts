import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, type ClimatePackage } from "../src/engine";
import { loadMilano } from "./helpers";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../public/data/gradi-giorno.json"), "utf8")) as {
  baseC: number; from: string; through: string; cities: Record<string, { observed: Record<string, number>; normal: Record<string, number>; tmy: Record<string, number> }>;
};

describe("taratura gas riportata alla media 2015-2024 0.14.0", () => {
  it("carica GG osservati, normale e TMY per Milano con copertura mensile", () => {
    const city = fixture.cities["015146"];
    expect(fixture.baseC).toBe(20);
    expect(Object.keys(fixture.cities)).toHaveLength(109);
    expect(fixture.through).toBe("2026-10");
    expect(fixture.from).toBe("2015-01");
    expect(city.observed["2015-01"]).toBeGreaterThan(0);
    expect(city.normal["01"]).toBeGreaterThan(0);
    expect(city.tmy["01"]).toBeGreaterThan(0);
  });

  it("riporta i 12 mesi alla media osservata, non al TMY; senza inizio conserva il fattore 0.13.0", () => {
    const climate = loadMilano();
    const p = exampleProject();
    p.consumption.gasSmcObserved.value = 1200;
    const before = evaluate(p, climate).calibration!.factor;
    const monthly = { observed: {} as Record<string, number>, normal: {} as Record<string, number>, tmy: {} as Record<string, number> };
    for (let i = 0; i < 12; i++) {
      const n = 2022 * 12 + 9 + i;
      monthly.observed[`${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`] = 125;
      monthly.normal[String(n % 12 + 1).padStart(2, "0")] = 120;
      monthly.tmy[String(n % 12 + 1).padStart(2, "0")] = 100;
    }
    const withData = { ...climate, degreeDays: monthly } as ClimatePackage;
    const noStart = evaluate(p, withData);
    p.consumption.observedStart = "2022-10";
    const normalized = evaluate(p, withData);
    expect(noStart.calibration!.factor).toBe(before);
    expect(normalized.calibration!.yearsDetail[0]).toMatchObject({ ggPeriod: 1500, ggNormal: 1440 });
    expect(normalized.calibration!.yearsDetail[0].gasAfterSmc).toBeCloseTo(normalized.calibration!.yearsDetail[0].gasBeforeSmc * 0.96, 10);
    expect(normalized.calibration!.factor).toBeLessThan(before);
  });

  it("normalizza due annate con decorrenze diverse e non normalizza quella senza dati", () => {
    const climate = loadMilano();
    const observed: Record<string, number> = {}, normal: Record<string, number> = {}, tmy: Record<string, number> = {};
    for (let i = 0; i < 24; i++) {
      const n = 2022 * 12 + 9 + i;
      observed[`${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`] = 125;
      normal[String(n % 12 + 1).padStart(2, "0")] = 100;
      tmy[String(n % 12 + 1).padStart(2, "0")] = 90;
    }
    const p = exampleProject();
    p.consumption.gasSmcObserved.value = 1200;
    p.consumption.observedStart = "2022-10";
    p.consumption.gasOtherYears = [{ smc: { ...p.consumption.gasSmcObserved }, period: "2023-2024", start: "2023-10" }];
    const result = evaluate(p, { ...climate, degreeDays: { observed, normal, tmy } } as ClimatePackage);
    expect(result.calibration!.yearsDetail).toHaveLength(2);
    expect(result.calibration!.yearsDetail.map((x) => [x.ggPeriod, x.ggNormal])).toEqual([[1500, 1200], [1500, 1200]]);
    p.consumption.gasOtherYears[0].start = "";
    const mixed = evaluate(p, { ...climate, degreeDays: { observed, normal, tmy } } as ClimatePackage);
    expect(mixed.calibration!.yearsDetail[1]).toMatchObject({ ggPeriod: null, ggNormal: null, gasAfterSmc: mixed.calibration!.yearsDetail[1].gasBeforeSmc });
    expect(mixed.calibrationNote).toContain("Periodo non indicato");
  });

  it("calcola i fattori per gli esempi di ottobre 2022 e ottobre 2023", () => {
    const climate = loadMilano();
    const p = exampleProject();
    p.consumption.gasSmcObserved.value = 1200; p.consumption.observedStart = "2022-10";
    p.consumption.gasOtherYears = [{ smc: { ...p.consumption.gasSmcObserved }, period: "ott 2023 - set 2024", start: "2023-10" }];
    const result = evaluate(p, { ...climate, degreeDays: fixture.cities["015146"] } as ClimatePackage);
    const sys=p.system, model=result.thermal!.base.heatNeed_kWh/sys.boilerEfficiency.value/(sys.efficiencyBasis === "PCS" ? sys.gasPcs.value : sys.gasPci.value);
    expect(result.calibration!.yearsDetail.map((y) => y.gasAfterSmc)).toEqual(result.calibration!.yearsDetail.map((y) => expect.closeTo(1010 * y.ggNormal! / y.ggPeriod!, 4)));
    expect(result.calibration!.factor).toBeCloseTo(result.calibration!.yearsDetail.reduce((sum, y) => sum + y.gasAfterSmc, 0) / 2 / model, 10);
  });

  it("salta la normalizzazione se manca anche un solo mese e aggiunge una nota", () => {
    const climate = loadMilano();
    const monthly = { observed: { "2022-10": 200 }, normal: { "10": 100 }, tmy: { "10": 100 } };
    const p = exampleProject();
    p.consumption.observedStart = "2022-10";
    const result = evaluate(p, { ...climate, degreeDays: monthly } as ClimatePackage);
    expect(result.calibration!.yearsDetail[0]).toMatchObject({ ggPeriod: null, ggNormal: null });
    expect(result.calibrationNote).toContain("Periodo non indicato");
  });
});
