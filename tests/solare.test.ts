import { describe, expect, it } from "vitest";
import { checkProject, collectorIrradiance, dhwDraws, dhwNeed, dhwTankParams, evaluate, exampleProject, HOURS, parseComuni, parseProjectFile, planeIrradiance, plantLabel, simulateTank, toProjectFile, type Evaluation, type PackageId, type TankParams } from "../src/engine";
import before from "./fixtures/solare-prima.json";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const climate = loadMilanoLegacy(), comuni = parseComuni(readPublicJson("comuni.json"));
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((r) => r.id === id)!;
const close = (a: number | null, b: number | null) => {
  if (a === null || b === null) return expect(a).toBe(b);
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b)));
};
const solarProject = (backup: "elettrico" | "gas" = "gas") => {
  const p = exampleProject();
  p.dhw.replace = true; p.dhw.newType = "solare"; p.dhw.solarBackup = backup;
  return p;
};
const collector = (patch: Partial<NonNullable<TankParams["collector"]>> = {}): NonNullable<TankParams["collector"]> =>
  ({ areaM2: 2, eta0: .7, a1: 3, a2: .01, loopLossPct: 10, pumpW: 40, irradiance: Array(HOURS).fill(800), ...patch });
const tank = (patch: Partial<TankParams> = {}): TankParams => ({ litres: 200, standbyW: 0, roomC: 20, coldC: 12, heater: "resistenza", hpThermalW: 0, backupW: 1500, copRated: 3, copRatedAirC: 7, airSource: "esterno", minAirC: -5, control: "sole", ...patch });

describe("Compatibilità prima del solare termico", () => {
  for (const ref of before) it(ref.name, () => {
    const p = exampleProject();
    if (ref.name.startsWith("boiler")) { p.system.acsOnGas = false; p.dhw.todayElectric = true; p.heatPump.included = false; }
    p.dhw.replace = ref.name !== "boiler-oggi";
    p.dhw.newType = ref.name.endsWith("elettrico") ? "elettrico" : "pdc";
    const ev = evaluate(p, climate);
    expect(ev.ok).toBe(true);
    for (const old of ref.packages) {
      const r = pk(ev, old.id as PackageId);
      expect(r.label).toBe(old.label);
      close(r.gasSmc, old.gasSmc); close(r.elec.import_kWh, old.import_kWh); close(r.investment, old.investment);
      close(r.annualBenefit, old.annualBenefit); close(r.cash?.npv ?? null, old.npv);
      if (!old.dhw) { expect(r.dhw).toBeUndefined(); continue; }
      expect(r.dhw!.generator).toBe(old.dhw.generator);
      close(r.dhw!.result.elec_kWh, old.dhw.elec_kWh); close(r.dhw!.result.heat_kWh, old.dhw.heat_kWh);
      close(r.dhw!.result.loss_kWh, old.dhw.loss_kWh); close(r.dhw!.result.cop, old.dhw.cop);
      expect(r.dhw!.result.unmetHours).toBe(old.dhw.unmetHours);
      expect(r.dhw!.result.solar_kWh).toBe(0);
    }
  });

  it("i progetti salvati prima si aprono identici e senza avvisi", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), climate)));
    for (const k of ["solarAreaM2", "solarPlane", "solarEta0", "solarA1", "solarA2", "solarLoopLossPct", "solarPumpW", "solarBackup"]) {
      expect(file.input.dhw).toHaveProperty(k);
      delete file.input.dhw[k];
    }
    const parsed = parseProjectFile(JSON.stringify(file), climate, comuni);
    expect(parsed.errors).toEqual([]); expect(parsed.warnings).toEqual([]);
    expect(parsed.file!.input.dhw.newType).toBe("pdc");
    const bad = JSON.parse(JSON.stringify(toProjectFile(solarProject(), climate)));
    bad.input.dhw.solarBackup = "legna";
    expect(parseProjectFile(JSON.stringify(bad), climate, comuni).errors.join(" ")).toContain("dhw.solarBackup");
  });
});

describe("Irraggiamento sul pannello", () => {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / 1000;
  it("di notte zero, mai negativo", () => {
    const g = collectorIrradiance(climate, "S35");
    expect(g).toHaveLength(HOURS);
    for (let h = 0; h < HOURS; h++) {
      expect(g[h]).toBeGreaterThanOrEqual(0);
      if (climate.series.ghi[h] === 0) expect(g[h]).toBe(0);
    }
  });
  it("facciata sud verticale entro il 15% di quella del pacchetto (pvlib)", () => {
    const mine = sum(planeIrradiance(climate, 90, 180)), ref = sum(climate.series.facade.S);
    expect(Math.abs(mine / ref - 1)).toBeLessThan(.15);
  });
  it("orizzontale uguale al dato orizzontale; sud 35° più dell'orizzontale, est e ovest meno del sud", () => {
    expect(sum(planeIrradiance(climate, 0, 180))).toBeCloseTo(sum(climate.series.ghi), 3);
    const s35 = sum(collectorIrradiance(climate, "S35"));
    expect(s35).toBeGreaterThan(sum(climate.series.ghi));
    expect(sum(collectorIrradiance(climate, "E35"))).toBeLessThan(s35);
    expect(sum(collectorIrradiance(climate, "O35"))).toBeLessThan(s35);
  });
});

describe("Serbatoio col sole", () => {
  it("caso a mano: sole costante, perdite nulle, prelievo uguale al calore del pannello a 55 °C", () => {
    // ΔT = 55 − 20 = 35 K; 2 m² × (0,7·800 − 3·35 − 0,01·35²) × 0,9 = 796,95 W
    const gain = 2 * (.7 * 800 - 3 * 35 - .01 * 35 * 35) * .9;
    expect(gain).toBeCloseTo(796.95, 9);
    const n = 48, r = simulateTank(tank({ collector: collector({ irradiance: Array(n).fill(800) }) }), Array(n).fill(gain), Array(n).fill(20), null);
    for (let h = 0; h < n; h++) { expect(r.solar[h]).toBeCloseTo(gain, 6); expect(r.heat[h]).toBe(0); expect(r.elec[h]).toBe(40); }
    expect(r.solar_kWh).toBeCloseTo(gain * n / 1000, 6);
    expect(r.storedEnd_kWh).toBeCloseTo(r.storedStart_kWh, 6);
    expect(r.pump_kWh).toBeCloseTo(40 * n / 1000, 9);
  });

  it("senza prelievi il serbatoio sale fino a 80 °C e poi il calore in più non si usa", () => {
    const n = 200, r = simulateTank(tank({ collector: collector({ irradiance: Array(n).fill(800) }) }), Array(n).fill(0), Array(n).fill(20), null);
    const max80 = 200 * 1.163 * (80 - 12);
    for (const s of r.stored) expect(s).toBeLessThanOrEqual(max80 + 1e-6);
    expect(r.stored[n - 1]).toBeCloseTo(max80, 6);
    expect(r.dumped_kWh).toBeGreaterThan(0);
  });

  for (const backup of ["elettrico", "gas"] as const) it(`bilancio orario chiuso col sole, integrazione ${backup}`, () => {
    const p = solarProject(backup), need = dhwNeed(p, climate);
    const t = dhwTankParams(p, climate, false, "sole");
    expect(t.collector?.areaM2).toBe(p.dhw.solarAreaM2.value);
    const r = simulateTank(t, dhwDraws(need.kWh), climate.series.tAir, null);
    let previous = r.storedStart_kWh * 1000;
    for (let h = 0; h < HOURS; h++) {
      expect(r.stored[h]).toBeCloseTo(previous + r.heat[h] + r.solar[h] - r.draw[h] - r.loss[h], 6);
      previous = r.stored[h];
    }
    expect(r.storedEnd_kWh - r.storedStart_kWh).toBeCloseTo(r.heat_kWh + r.solar_kWh - r.draw_kWh - r.loss_kWh, 6);
    expect(r.solar_kWh).toBeGreaterThan(.3 * r.draw_kWh);
    expect(r.solar_kWh).toBeLessThan(r.draw_kWh + r.loss_kWh);
    if (backup === "gas") { expect(r.backupGas_kWh).toBeCloseTo(r.heat_kWh, 9); expect(r.elec_kWh).toBeCloseTo(r.pump_kWh, 9); }
    else { expect(r.backupGas_kWh).toBe(0); expect(r.elec_kWh).toBeCloseTo(r.heat_kWh + r.pump_kWh, 9); }
  });
});

describe("Solare termico nei pacchetti", () => {
  it("integrazione a gas: gas dell'acqua calda ridotto, quota fissa del gas anche con la PDC", () => {
    const p = solarProject("gas"), ev = evaluate(p, climate);
    expect(ev.ok).toBe(true);
    const base = pk(ev, "base"), h = pk(ev, "H");
    expect(h.dhw!.generator).toContain("Solare termico");
    expect(plantLabel(p).long).toContain("solare termico");
    const backupSmc = h.dhw!.result.backupGas_kWh / p.dhw.gasDhwEfficiency.value / (p.system.efficiencyBasis === "PCS" ? p.system.gasPcs.value : p.system.gasPci.value);
    expect(backupSmc).toBeGreaterThan(0);
    expect(backupSmc).toBeLessThan(p.system.acsGasSmc.value);
    const acsLine = h.services.find((s) => s.service === "ACS" && s.carrier === "gas")!;
    expect(acsLine.smc).toBeCloseTo(backupSmc, 9);
    expect(h.gasSmc).toBeGreaterThan(0);
    expect(base.gasSmc - pk(ev, "W").gasSmc).toBeGreaterThan(0);
    expect(h.costs.gasFixed).toBe(p.tariffs.gasFixed.value);
  });

  it("integrazione elettrica: niente gas per l'acqua calda", () => {
    const p = solarProject("elettrico"); p.heatPump.included = false;
    const ev = evaluate(p, climate), h = pk(ev, "H");
    expect(h.services.some((s) => s.service === "ACS" && s.carrier === "gas")).toBe(false);
    expect(h.dhw!.result.backupGas_kWh).toBe(0);
    expect(h.dhw!.result.solar_kWh).toBeGreaterThan(0);
    // con il FV la resistenza non scalda col sole in più: stesso serbatoio con e senza FV
    expect(pk(ev, "HP").dhw!.result.elec).toEqual(h.dhw!.result.elec);
  });

  it("integrazione a gas senza acqua calda a gas oggi: pacchetto bloccato", () => {
    const p = solarProject("gas"); p.system.acsOnGas = false; p.dhw.todayElectric = true;
    const ev = evaluate(p, climate);
    expect(pk(ev, "H").blockers.join(" ")).toContain("caldaia");
  });

  it("controlli sui dati del pannello", () => {
    const p = solarProject(); p.dhw.solarAreaM2.value = 0;
    expect(checkProject(p).some((i) => i.message.includes("Superficie dei pannelli"))).toBe(true);
  });
});
