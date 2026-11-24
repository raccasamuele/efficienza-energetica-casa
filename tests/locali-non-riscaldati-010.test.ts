import { describe, expect, it } from "vitest";
import { buildEnvelope, checkProject, exampleProject, parseProjectFile, simulateThermal, type BuildingInput } from "../src/engine";
import { loadMilanoLegacy } from "./helpers";

const climate = loadMilanoLegacy();
const set = (q: BuildingInput["bUpperUnheated"], value: number) => ({ ...q, value, status: "misurato" as const, source: "Dato di prova" });

describe("Bilancio dei locali non riscaldati 0.10.0", () => {
  it("mantiene la H di oggi nei confini attic, inferiore e laterale in modalità fattoreB", () => {
    const p = exampleProject();
    p.building.sides = "unLato";
    p.building.adjacentWallArea.value = 20;
    const env = buildEnvelope(p.building, p.service, climate);
    const expected = [
      [(p.building.uUpper.value + p.building.thermalBridgeDeltaU.value) * env.geometry.upperArea, p.building.bUpperUnheated.value, "Soffitto verso sottotetto"],
      [(p.building.uLower.value + p.building.thermalBridgeDeltaU.value) * env.geometry.lowerArea, p.building.bLowerUnheated.value, "Pavimento verso locale non riscaldato"],
      [(p.building.uWall.value + p.building.thermalBridgeDeltaU.value) * env.geometry.adjacentWall, p.building.bSideUnheated.value, "Pareti verso adiacenze non riscaldate"],
    ] as const;
    expected.forEach(([hiu, b, label]) => expect(env.exchanges.find((x) => x.label === label)!.H).toBeCloseTo(hiu * b, 12));
  });

  it("il modo locale con Hue ricostruito dà lo stesso scambio del fattore b", () => {
    const p = exampleProject();
    const hiu = (p.building.uUpper.value + p.building.thermalBridgeDeltaU.value) * 60;
    const b = p.building.bUpperUnheated.value;
    const hue = hiu * b / (1 - b);
    const ventilation = 1200 * 0.01 * 100 / 3600;
    p.building.unheatedUpper = { ...p.building.unheatedUpper, mode: "locale", areaOut: set(p.building.unheatedUpper.areaOut, 100), uOut: set(p.building.unheatedUpper.uOut, (hue - ventilation) / 100), volume: set(p.building.unheatedUpper.volume, 100), airChange: set(p.building.unheatedUpper.airChange, 0.01) };
    const env = buildEnvelope(p.building, p.service, climate);
    expect(env.exchanges.find((x) => x.label === "Soffitto verso sottotetto")!.H).toBeCloseTo(hiu * b, 10);
  });

  it("locale senza dati usa esattamente il fattore b e segnala il ripiego", () => {
    const p = exampleProject();
    const expected = buildEnvelope(p.building, p.service, climate);
    p.building.unheatedUpper.mode = "locale";
    const actual = buildEnvelope(p.building, p.service, climate);
    const label = "Soffitto verso sottotetto";
    expect(actual.exchanges.find((x) => x.label === label)!.H).toBe(expected.exchanges.find((x) => x.label === label)!.H);
    expect(actual.notes).toContain(`${label}: dati del locale incompleti, usato il fattore b.`);
    const issues = checkProject(p).filter((x) => x.severity === "esplorativo").map((x) => x.message);
    for (const name of ["Superficie del locale verso l'esterno", "U media del locale verso l'esterno", "Volume del locale non riscaldato", "Ricambi del locale non riscaldato"])
      expect(issues.some((message) => message.startsWith(`${name}: «non so»`))).toBe(true);
    expect(checkProject(p).some((x) => x.severity === "errore" && /locale verso l'esterno|Volume del locale|Ricambi del locale/.test(x.message))).toBe(false);
  });

  it("b = 1 dà il confine esterno con la stessa Hiu", () => {
    const p = exampleProject();
    const area = 60;
    p.building.bUpperUnheated = set(p.building.bUpperUnheated, 1);
    const e = buildEnvelope(p.building, p.service, climate);
    const Hiu = (p.building.uUpper.value + p.building.thermalBridgeDeltaU.value) * area;
    expect(e.exchanges.find((x) => x.label === "Soffitto verso sottotetto")!.H).toBe(Hiu);
  });

  it("con fattore b la casa d'esempio mantiene le potenze orarie", () => {
    const p = exampleProject();
    const factor = simulateThermal(p.building, p.service, climate);
    const locale = structuredClone(p.building);
    const Hiu = (locale.uUpper.value + locale.thermalBridgeDeltaU.value) * 60;
    const Hue = Hiu * locale.bUpperUnheated.value / (1 - locale.bUpperUnheated.value);
    const area = 1000;
    locale.unheatedUpper = { ...locale.unheatedUpper, mode: "locale", areaOut: set(locale.unheatedUpper.areaOut, area), uOut: set(locale.unheatedUpper.uOut, (Hue - 1200 * 0.01 / 3600) / area), volume: set(locale.unheatedUpper.volume, 1), airChange: set(locale.unheatedUpper.airChange, 0.01) };
    const balanced = simulateThermal(locale, p.service, climate);
    expect(balanced.ok).toBe(true);
    factor.qHeat.forEach((v, h) => expect(Math.abs(v - balanced.qHeat[h])).toBeLessThan(1e-9));
  });

  it("l'isolamento aumenta b equivalente e riduce il risparmio rispetto a b fisso", () => {
    const p = exampleProject();
    const upgrade = { upper: { uAfter: 0.25, share: 1, bridgeAfter: p.building.thermalBridgeDeltaU.value } };
    const hiuToday = (p.building.uUpper.value + p.building.thermalBridgeDeltaU.value) * 60;
    const hiuAfter = (0.25 + p.building.thermalBridgeDeltaU.value) * 60;
    const fixedB = p.building.bUpperUnheated.value;
    const hueFixed = hiuAfter * fixedB / (1 - fixedB);
    const bFixed = hueFixed / (hiuToday + hueFixed);
    const fixedInput = { ...p.building, bUpperUnheated: set(p.building.bUpperUnheated, bFixed) };
    const fixed = simulateThermal(fixedInput, p.service, climate, undefined, upgrade);
    const locale = structuredClone(p.building);
    locale.unheatedUpper.mode = "locale";
    const hiu = hiuToday;
    const b = p.building.bUpperUnheated.value;
    const hue = hiu * b / (1 - b);
    locale.unheatedUpper.areaOut = set(locale.unheatedUpper.areaOut, 100);
    locale.unheatedUpper.uOut = set(locale.unheatedUpper.uOut, (hue - 1200 * 0.01 / 3600) / 100);
    locale.unheatedUpper.volume = set(locale.unheatedUpper.volume, 1);
    locale.unheatedUpper.airChange = set(locale.unheatedUpper.airChange, 0.01);
    const series = simulateThermal(locale, p.service, climate, undefined, upgrade);
    expect(series.unheatedSpaces[0].bAfter).toBeGreaterThan(b);
    expect(simulateThermal(p.building, p.service, climate).heatNeed_kWh - series.heatNeed_kWh).toBeLessThan(simulateThermal(p.building, p.service, climate).heatNeed_kWh - fixed.heatNeed_kWh);
  });

  it("migra i progetti 0.9.0 al modo fattoreB senza avvisi sui nuovi campi", () => {
    const p = exampleProject();
    const raw = { schemaVersion: 1, engineVersion: "0.9.0", input: p };
    delete (raw.input.building as Partial<BuildingInput>).unheatedUpper;
    delete (raw.input.building as Partial<BuildingInput>).unheatedLower;
    delete (raw.input.building as Partial<BuildingInput>).unheatedSide;
    const result = parseProjectFile(JSON.stringify(raw), climate, undefined, { draft: true });
    expect(result.errors).toEqual([]);
    expect(result.file!.input.building.unheatedUpper.mode).toBe("fattoreB");
    for (const space of [result.file!.input.building.unheatedUpper, result.file!.input.building.unheatedLower, result.file!.input.building.unheatedSide])
      for (const field of [space.areaOut, space.uOut, space.volume, space.airChange]) {
        expect(field.value).toBe(0);
        expect(field.status).toBe("sconosciuto");
        expect(field.source).toBe("Dato del locale non inserito");
      }
    expect(result.warnings.filter((w) => !w.startsWith("Anagrafe dei comuni"))).toEqual(["Progetto salvato con motore 0.9.0: i risultati vengono ricalcolati con 0.18.1."]);
  });
});
