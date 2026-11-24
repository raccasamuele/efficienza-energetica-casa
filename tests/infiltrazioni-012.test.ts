import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  airChangeSummary,
  checkProject,
  envelopeBuilding,
  exampleProject,
  hourlyAirChange,
  infiltrationAirChange,
  infiltrationModel,
  leakageArea,
  n50AfterWindows,
  parseProjectFile,
  simulateThermal,
  STACK_COEFFICIENT,
  WIND_COEFFICIENT,
  type BuildingInput,
  type ProjectInput,
  type WindowsIntervention,
} from "../src/engine";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const tight = (p: ProjectInput, n50: number) => {
  p.building.infiltration.mode = "tenuta";
  p.building.infiltration.n50 = { value: n50, status: "misurato", source: "Prova di tenuta di prova" };
  return p;
};

describe("Infiltrazioni dalla tenuta all'aria 0.12.0", () => {
  it("riproduce l'esempio di controllo della specifica (§13.2.2)", () => {
    expect(leakageArea(5, 400)).toBeCloseTo(416.6, 0);
    const m = { volume: 400, n50: 5, leakageArea_cm2: leakageArea(5, 400), cs: STACK_COEFFICIENT[1], cw: WIND_COEFFICIENT[2][1], minAirChange: 0 };
    expect(infiltrationAirChange(m, 20, 3)).toBeCloseTo(0.333, 3);
    expect(infiltrationAirChange(m, -20, 3)).toBeCloseTo(0.333, 3);
  });

  it("senza vento e senza differenza di temperatura resta il minimo", () => {
    const m = { volume: 400, n50: 5, leakageArea_cm2: leakageArea(5, 400), cs: STACK_COEFFICIENT[0], cw: WIND_COEFFICIENT[0][0], minAirChange: 0.3 };
    expect(hourlyAirChange(m, 0, 0)).toBe(0.3);
    expect(hourlyAirChange(m, 20, 8)).toBeGreaterThan(0.3);
  });

  it("sceglie i coefficienti per piani (oltre 3 come 3) e classe di riparo", () => {
    const p = tight(exampleProject(), 6);
    for (const [floors, col] of [[1, 0], [2, 1], [3, 2], [4, 2]] as const) {
      const b: BuildingInput = { ...p.building, floors: { ...p.building.floors, value: floors }, infiltration: { ...p.building.infiltration, shelterClass: 5 } };
      const m = infiltrationModel(b, 300)!;
      expect(m.cs).toBe(STACK_COEFFICIENT[col]);
      expect(m.cw).toBe(WIND_COEFFICIENT[4][col]);
    }
  });

  it("senza n50 usa il ricambio costante con una nota, identico al modo costante", () => {
    const p = exampleProject();
    const base = simulateThermal(p.building, p.service, climate);
    p.building.infiltration.mode = "tenuta";
    const fallback = simulateThermal(p.building, p.service, climate);
    expect(fallback.heatNeed_kWh).toBe(base.heatNeed_kWh);
    expect(fallback.notes).toContain("Tenuta all'aria non inserita: usato il ricambio costante.");
    expect(checkProject(p).some((i) => i.severity === "esplorativo" && i.message.startsWith("Tenuta all'aria n50 non inserita"))).toBe(true);
    expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("n50"))).toBe(false);
  });

  it("con n50 il ricambio cambia ora per ora e non scende sotto il minimo", () => {
    const p = tight(exampleProject(), 8);
    const t = simulateThermal(p.building, p.service, climate);
    expect(t.ok).toBe(true);
    expect(Math.min(...t.airChange)).toBeGreaterThanOrEqual(p.building.infiltration.minAirChange.value);
    expect(Math.max(...t.airChange)).toBeGreaterThan(Math.min(...t.airChange));
    const s = airChangeSummary(t, p.service)!;
    expect(s.meanHeating).toBeGreaterThan(p.building.infiltration.minAirChange.value);
    expect(s.minShareHeating).toBeGreaterThanOrEqual(0);
    expect(s.minShareHeating).toBeLessThan(1);
    // casa più stagna: meno calore
    expect(simulateThermal(tight(exampleProject(), 3).building, p.service, climate).heatNeed_kWh).toBeLessThan(t.heatNeed_kWh);
  });

  it("stima la tenuta dopo i serramenti con la stessa riduzione dei ricambi, o usa il dato inserito", () => {
    const p = tight(exampleProject(), 6);
    const ratio = p.windows.airChange.value / p.building.airChange.value;
    expect(n50AfterWindows(p.building, p.windows)).toEqual({ value: 6 * ratio, estimated: true });
    const w: WindowsIntervention = { ...p.windows, n50After: { value: 2.5, status: "misurato", source: "Prova dopo i lavori" } };
    expect(n50AfterWindows(p.building, w)).toEqual({ value: 2.5, estimated: false });
    p.envelope.windows = true;
    expect(envelopeBuilding(p).infiltration.n50.value).toBeCloseTo(6 * ratio, 12);
  });

  it("migra i progetti 0.11.0 al modo costante senza avvisi sui nuovi campi", () => {
    const p = exampleProject();
    const raw = { schemaVersion: 1, engineVersion: "0.11.0", input: p };
    delete (raw.input.building as Partial<BuildingInput>).infiltration;
    delete (raw.input.windows as Partial<WindowsIntervention>).n50After;
    const result = parseProjectFile(JSON.stringify(raw), climate, undefined, { draft: true });
    expect(result.errors).toEqual([]);
    expect(result.file!.input.building.infiltration.mode).toBe("costante");
    expect(result.file!.input.windows.n50After.status).toBe("sconosciuto");
    expect(result.warnings.filter((w) => !w.startsWith("Anagrafe dei comuni"))).toEqual([`Progetto salvato con motore 0.11.0: i risultati vengono ricalcolati con ${ENGINE_VERSION}.`]);
  });
});
