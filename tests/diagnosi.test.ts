import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBillUpdates, billUpdates, evaluate, evaluateModel, exampleProject, HOURS, localDay, localHour, MONTH_DAYS, otherUsesDemand, packagePv, parseProjectFile, q, readBill, residualDemand, toProjectFile, type ProjectInput } from "../src/engine";
import { billGasMean, electricDiagnosis, gasDiagnosis } from "../src/engine/diagnosi";
import { curveAnnualKwh, curveFromFiles } from "../src/engine/misure";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const baseOf = (p: ProjectInput) => evaluate(p, milano).packages[0];
const fixture = (name: string) => readFileSync(resolve(__dirname, `fixtures/bollette/${name}.txt`), "utf-8");

/** Un anno del Portale Consumi, con un fondo noto e quattro ore di consumo serale. */
export function measuredProject(night = 0.2): ProjectInput {
  const head = `pod;data_lettura;${Array.from({ length: 96 }, (_, i) => `ea${i + 1}`).join(";")}`;
  const rows = Array.from({ length: 365 }, (_, i) => {
    const iso = new Date(Date.UTC(2023, 0, i + 1)).toISOString().slice(0, 10);
    return `IT001E12345678;${iso};${Array.from({ length: 96 }, (_, j) => ((j >= 72 && j < 88 ? 1 : night) / 4).toFixed(4)).join(";")}`;
  });
  const p = exampleProject();
  p.consumption.measuredCurve = curveFromFiles([[head, ...rows].join("\n")]).curve;
  p.consumption.electricityKwh.value = curveAnnualKwh(p.consumption.measuredCurve.ore);
  return p;
}

function threeYears(): ProjectInput {
  const p = exampleProject();
  p.consumption.gasSmcObserved = q(1000, "documentato", "Bolletta");
  p.consumption.gasOtherYears = [{ smc: q(1200, "documentato", "Bolletta"), period: "2024" }, { smc: q(1400, "documentato", "Bolletta"), period: "2023" }];
  return p;
}

describe("3C: media delle bollette e taratura", () => {
  it("una sola bolletta, tre anni, dati sconosciuti e nessun dato", () => {
    const p = threeYears();
    expect(billGasMean(p)).toEqual({ smc: 1200, years: 3 });
    p.consumption.gasOtherYears = [];
    expect(billGasMean(p)).toEqual({ smc: 1000, years: 1 });
    p.consumption.gasOtherYears = [{ smc: q(1200, "sconosciuto"), period: "" }, { smc: q(0), period: "" }];
    expect(billGasMean(p)).toEqual({ smc: 1000, years: 1 });
    p.consumption.gasSmcObserved.status = "sconosciuto";
    expect(billGasMean(p)).toBeNull();
    p.consumption.gasOtherYears[0].smc.status = "documentato";
    expect(billGasMean(p)).toEqual({ smc: 1200, years: 1 });
  });

  it("la taratura usa la stessa formula e gli stessi VAN con una bolletta o con la media", () => {
    const p = threeYears();
    const single = structuredClone(p);
    single.consumption.gasOtherYears = [];
    single.consumption.gasSmcObserved.value = 1200;
    const a = evaluate(p, milano);
    const b = evaluate(single, milano);
    const sys = p.system;
    const factor = (1200 - (sys.acsOnGas ? sys.acsGasSmc.value : 0) - (sys.cookingOnGas ? sys.cookingGasSmc.value : 0)) / (b.thermal!.base.heatNeed_kWh / sys.boilerEfficiency.value / (sys.efficiencyBasis === "PCS" ? sys.gasPcs.value : sys.gasPci.value));
    expect(b.calibration).toMatchObject({ factor, billSmc: 1200, years: 1 });
    expect(a.calibration).toMatchObject({ factor, billSmc: 1200, years: 3 });
    const expected = evaluateModel(single, milano, factor).packages.map((r) => r.cash?.npv);
    expect(b.calibration!.packages.map((r) => r.cash?.npv)).toEqual(expected);
    expect(a.calibration!.packages.map((r) => r.cash?.npv)).toEqual(expected);
    expect(a.observedGapPct).toBe(b.observedGapPct);
  });
});

describe("3C: diagnosi elettrica", () => {
  it("fondo, sera e stagioni vengono dalle ore civili della serie, a parità di consumo annuo", () => {
    const p = measuredProject();
    const base = baseOf(p);
    const d = electricDiagnosis(p, milano, base)!;
    const series = otherUsesDemand(p, base.otherUses_kWh, milano);
    expect(d.misurato.fondo_W).toBeCloseTo(200, 4);
    expect(d.misurato.fondo_W).toBeCloseTo(series.filter((_, h) => localHour(h) === 2)[0], 6);
    expect(d.misurato.serale_pct).toBeCloseTo(series.reduce((s, w, h) => s + (localHour(h) >= 18 ? w : 0), 0) / (base.otherUses_kWh * 10), 6);
    const season = (months: number[], values: number[]) => {
      const days = new Set<number>();
      const sum = values.reduce((s, w, h) => {
        let day = localDay(h), month = 0;
        while (day >= MONTH_DAYS[month]) day -= MONTH_DAYS[month++];
        if (!months.includes(month)) return s;
        days.add(localDay(h));
        return s + w / 1000;
      }, 0);
      return sum / days.size;
    };
    for (const [stats, values] of [[d.misurato, series], [d.tipico, residualDemand(base.otherUses_kWh, p.consumption.profile)]] as const) {
      expect(stats.inverno_kWhGiorno).toBeCloseTo(season([11, 0, 1], values), 6);
      expect(stats.estate_kWhGiorno).toBeCloseTo(season([5, 6, 7], values), 6);
    }
    expect(d.riduzione).toEqual({ W: 100, kWh: 876, eur: Math.round(876 * p.tariffs.elecPrice.value), soloOreSenzaSole: false });
    p.tariffs.elecPrice.status = "sconosciuto";
    expect(electricDiagnosis(p, milano, base)!.riduzione.eur).toBeNull();
    p.consumption.electricityKwh.value *= 2;
    expect(electricDiagnosis(p, milano, baseOf(p))!.misurato.fondo_W).toBeCloseTo(400, 4);
  });

  it("con FV esistente conta solo le ore senza produzione, e senza curva non diagnostica", () => {
    const p = measuredProject();
    p.existingPv.present = true;
    p.existingPv.consumptionFrom = "contatore";
    const c = p.consumption.measuredCurve!;
    c.immissioni = { ore: c.ore.map(() => 0), giorni: c.giorni, dal: c.dal, al: c.al };
    const d = electricDiagnosis(p, milano, baseOf(p))!;
    expect(d.riduzione.soloOreSenzaSole).toBe(true);
    expect(d.riduzione.kWh).toBeLessThan(876);
    expect(d.riduzione.kWh).toBe(Math.round(packagePv(milano, p, false)!.filter((w) => w === 0).length / 10));
    delete c.immissioni;
    expect(electricDiagnosis(p, milano, baseOf(exampleProject()))).toBeNull();
    p.consumption.measuredCurve = null;
    expect(electricDiagnosis(p, milano, baseOf(exampleProject()))).toBeNull();
  });

  it("con un fondo di 60 W propone 30 W", () => {
    const p = measuredProject(0.06);
    expect(electricDiagnosis(p, milano, baseOf(p))!.riduzione.W).toBe(30);
  });
});

describe("3C: diagnosi gas", () => {
  it("separa estate e riscaldamento senza cambiare i dati del progetto", () => {
    const p = threeYears();
    p.consumption.summerGas = { smc: q(60, "documentato", "Bolletta"), days: 92, period: "estate" };
    const before = structuredClone(p);
    const base = baseOf(p);
    const d = gasDiagnosis(p, base)!;
    expect(d.bolletta).toEqual({ annuo: 1200, anni: 3, acquaCucina: 238, riscaldamento: 962 });
    const model = (p.system.acsOnGas ? p.system.acsGasSmc.value : 0) + (p.system.cookingOnGas ? p.system.cookingGasSmc.value : 0);
    expect(d.modello).toEqual({ acquaCucina: Math.round(model), riscaldamento: Math.round(base.gasSmc - model) });
    p.system.acsGasSmc.value = 100;
    p.system.cookingGasSmc.value = 10;
    expect(gasDiagnosis(p, base)!.suggerimento).toBe("Dalle bollette estive acqua calda e cucina valgono circa 238 Smc l'anno, nel progetto 110: puoi aggiornarli nel passo Impianto.");
    p.system.acsOnGas = false;
    p.system.cookingOnGas = false;
    expect(gasDiagnosis(p, base)!.suggerimento).toBeNull();
    expect(before.consumption).toEqual(p.consumption);
  });

  it("dati incoerenti, periodi troppo brevi e valori non noti", () => {
    const p = threeYears();
    const base = baseOf(p);
    p.consumption.summerGas = { smc: q(500, "documentato"), days: 28, period: "" };
    expect(gasDiagnosis(p, base)!.errore).toBe("Il gas d'estate ripetuto per tutto l'anno supera il gas annuo: controlla che il periodo estivo non comprenda mesi di riscaldamento.");
    p.consumption.summerGas.days = 27;
    expect(gasDiagnosis(p, base)).toBeNull();
    p.consumption.summerGas.days = 92;
    p.consumption.summerGas.smc.status = "sconosciuto";
    expect(gasDiagnosis(p, base)).toBeNull();
    p.consumption.summerGas.smc = q(0);
    expect(gasDiagnosis(p, base)).toBeNull();
    p.consumption.summerGas.smc.value = 60;
    p.consumption.gasOtherYears = [];
    p.consumption.gasSmcObserved.status = "sconosciuto";
    expect(gasDiagnosis(p, base)).toBeNull();
  });
});

describe("3C: bollette collegate", () => {
  it("luglio–agosto propone 41 Smc in 62 giorni, marzo–aprile non è estate", () => {
    const p = exampleProject();
    const updates = billUpdates(p, readBill(fixture("gas-estate")));
    const summer = updates.find((u) => u.path === "consumption.summerGas")!;
    expect(summer).toMatchObject({ label: "Gas di un periodo estivo", current: "", proposed: 41, unit: "Smc in 62 giorni", days: 62, period: "dal 01/07/2026 al 31/08/2026" });
    const applied = applyBillUpdates(p, updates, [summer.path]);
    expect(applied.consumption.summerGas).toEqual({ smc: { value: 41, status: "documentato", source: summer.source }, days: 62, period: summer.period });
    expect(p.consumption.summerGas.days).toBe(0);
    p.consumption.summerGas = { smc: q(60.5), days: 92, period: "estate precedente" };
    expect(billUpdates(p, readBill(fixture("gas-estate"))).find((u) => u.path === summer.path)!.current).toBe("60.5 Smc in 92 giorni");
    expect(billUpdates(p, readBill(fixture("plenitude-gas"))).some((u) => u.path === summer.path)).toBe(false);
    expect(billUpdates(p, readBill(fixture("a2a-gas"))).some((u) => u.path === summer.path)).toBe(false);
    expect(JSON.stringify(updates)).not.toMatch(/IT001|MARIO|PDR|ESMMRA|Via Esempio/);
  });

  it("aggiunge un'annata diversa, evita duplicati e rispetta il massimo di due", () => {
    const p = exampleProject();
    p.consumption.gasSmcObserved.status = "documentato";
    p.consumption.observedPeriod = "dal 01/05/2023 al 30/04/2024";
    const r = readBill(fixture("plenitude-gas"));
    const ups = billUpdates(p, r);
    expect(ups.map((u) => u.path)).toEqual(["consumption.gasSmcObserved", "consumption.observedPeriod", "consumption.gasOtherYears", "system.gasPcs"]);
    expect(ups.find((u) => u.path === "consumption.gasOtherYears")!.current).toBe("");
    const previous = structuredClone(p);
    previous.consumption.gasOtherYears = [{ smc: q(1100), period: "dal 01/05/2022 al 30/04/2023" }];
    expect(billUpdates(previous, r).find((u) => u.path === "consumption.gasOtherYears")!.current).toBe("dal 01/05/2022 al 30/04/2023");
    const applied = applyBillUpdates(p, ups, ["consumption.gasOtherYears"]);
    expect(applied.consumption.gasOtherYears).toEqual([{ smc: { value: 895, status: "documentato", source: ups[0].source }, period: "dal 01/05/2024 al 30/04/2025", start: "" }]);
    expect(billUpdates(applied, r).some((u) => u.path === "consumption.gasOtherYears")).toBe(false);
    p.consumption.gasOtherYears = [{ smc: q(1000), period: "2021" }, { smc: q(1100), period: "2022" }];
    expect(billUpdates(p, r).some((u) => u.path === "consumption.gasOtherYears")).toBe(false);
    expect(JSON.stringify(ups)).not.toMatch(/MARIO|PDR|ESMMRA|Via Esempio/);
  });
});

describe("3C: importazione del progetto", () => {
  it("i file vecchi si completano senza avvisi sui nuovi campi e con gli stessi risultati", () => {
    const p = exampleProject();
    const file = toProjectFile(p, milano);
    const old = JSON.parse(JSON.stringify(file));
    delete old.input.consumption.gasOtherYears;
    delete old.input.consumption.summerGas;
    const r = parseProjectFile(JSON.stringify(old), milano);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).not.toMatch(/gasOtherYears|summerGas|annate|estate/);
    expect(r.file!.input.consumption).toEqual(p.consumption);
    expect(evaluate(r.file!.input, milano)).toEqual(evaluate(p, milano));
  });

  it("rifiuta annate, giorni, periodi e Q fuori dai limiti, anche nelle bozze", () => {
    const invalid = (edit: (p: ProjectInput) => void, message: string) => {
      const p = threeYears();
      edit(p);
      for (const draft of [false, true]) expect(parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, undefined, { draft }).errors.join(" ")).toContain(message);
    };
    invalid((p) => p.consumption.gasOtherYears.push({ smc: q(1000), period: "" }), "Altre annate di gas: al massimo due.");
    for (const days of [-1, 1.5, 500]) invalid((p) => { p.consumption.summerGas.days = days; }, "Gas d'estate: giorni fra 0 e 366.");
    invalid((p) => { p.consumption.gasOtherYears[0].smc.value = -1; }, "gasOtherYears");
    invalid((p) => { p.consumption.gasOtherYears[0].period = "x".repeat(61); }, "gasOtherYears");
    invalid((p) => { p.consumption.summerGas.period = "x".repeat(61); }, "summerGas");
    invalid((p) => { p.consumption.summerGas.smc.value = -1; }, "summerGas");
    invalid((p) => { (p.consumption.gasOtherYears[0].smc as unknown as { status: string }).status = "altro"; }, "gasOtherYears");
    expect(HOURS).toBe(8760);
  });
});
