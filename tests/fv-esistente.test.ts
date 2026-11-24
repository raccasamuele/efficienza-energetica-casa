import { describe, expect, it } from "vitest";
import {
  evaluate,
  exampleProject,
  exportConsumptionCurve,
  gridImportSeries,
  parseProjectFile,
  toProjectFile,
  type Evaluation,
  type PackageId,
  type ProjectInput,
} from "../src/engine";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;

function existing(from: "inverter" | "bolletta" = "inverter"): ProjectInput {
  const p = exampleProject();
  p.existingPv.present = true;
  p.existingPv.consumptionFrom = from;
  p.existingPv.gridImportKwh = { value: 2000, status: "documentato", source: "Bolletta annuale di prova" };
  return p;
}

describe("FV già installato", () => {
  it("entra in tutti i pacchetti, situazione attuale compresa; la lettera P è la batteria", () => {
    const ev = evaluate(existing(), milano);
    for (const r of ev.packages) {
      expect(r.elec.pv_kWh).toBeGreaterThan(3000);
      expect(r.costs.exportRevenue).toBeGreaterThan(0);
    }
    expect(pk(ev, "base").label).toBe("Situazione attuale (FV esistente)");
    expect(pk(ev, "P").label).toBe("Batteria");
    expect(pk(ev, "HP").label).toBe("PDC + batteria");
    const b = pk(ev, "P").battery!;
    expect(pk(ev, "P").investment).toBeCloseTo(b.investment, 9);
    // senza batteria il pacchetto P sarebbe la situazione attuale: la batteria vale quanto il pacchetto
    expect(b.without.npv).toBeCloseTo(0, 6);
    expect(b.npvBattery).toBeCloseTo(pk(ev, "P").cash!.npv, 6);
    expect(pk(ev, "P").elec.import_kWh).toBeLessThan(pk(ev, "base").elec.import_kWh);
  });

  it("con il FV esistente la batteria c'è anche senza la casella del FV nuovo", () => {
    const p = existing();
    expect(p.battery.enabled).toBe(false);
    expect(pk(evaluate(p, milano), "P").battery).toBeDefined();
  });

  it("dai prelievi in bolletta ricava i consumi che danno gli stessi prelievi", () => {
    const ev = evaluate(existing("bolletta"), milano);
    const base = pk(ev, "base");
    expect(base.elec.import_kWh).toBeCloseTo(2000, 3);
    expect(base.otherUses_kWh).toBeGreaterThan(2000);
    expect(base.services.find((s) => s.service === "Altri usi elettrici")!.generator).toMatch(/prelievi in bolletta/);
    // il risultato dipende dal profilo: è un'ipotesi
    const evening = existing("bolletta");
    evening.consumption.profile = "diurno";
    expect(pk(evaluate(evening, milano), "base").otherUses_kWh).not.toBeCloseTo(base.otherUses_kWh, 0);
  });

  it("prelievi impossibili: errore leggibile, nessun numero", () => {
    const p = existing("bolletta");
    p.existingPv.kWp.value = 20;
    p.existingPv.gridImportKwh.value = 100;
    p.consumption.profile = "serale";
    const ev = evaluate(p, milano);
    if (!ev.ok) expect(ev.issues.some((i) => i.message.includes("prelievi in bolletta"))).toBe(true);
    else expect(pk(ev, "base").elec.import_kWh).toBeCloseTo(100, 3);
  });

  it("la curva del contatore non si usa: misura solo i prelievi", () => {
    const p = existing();
    p.consumption.measuredCurve = { ore: new Array(864).fill(0).map((_, i) => (i % 24 === 12 ? 5 : 0.1)), giorni: 60, dal: "2025-01-01", al: "2025-03-01", fonte: "prova" };
    const plain = existing();
    expect(pk(evaluate(p, milano), "base").elec).toEqual(pk(evaluate(plain, milano), "base").elec);
    expect(evaluate(p, milano).issues.some((i) => i.message.includes("misura solo i prelievi"))).toBe(true);
  });

  it("curva per la CER: kWp esistenti in ogni pacchetto, prelievi dopo la batteria", () => {
    const p = existing();
    const ev = evaluate(p, milano);
    const base = exportConsumptionCurve(p, milano, pk(ev, "base"));
    expect(base.versione).toBe(2);
    expect(base.fv_sottratto_kwp).toBe(3);
    const bat = exportConsumptionCurve(p, milano, pk(ev, "P"));
    expect(bat.versione).toBe(3);
    expect(bat.batteria_kwh).toBe(5);
    const s = gridImportSeries(p, milano, pk(ev, "P"));
    expect(s.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(pk(ev, "P").elec.import_kWh, 6);
  });
});

describe("Curva per la CER con la batteria", () => {
  it("senza batteria il file resta il formato 2 di oggi, con la batteria è il 3 con batteria_kwh", () => {
    const p = exampleProject();
    const off = exportConsumptionCurve(p, milano, pk(evaluate(p, milano), "P"));
    expect(off.versione).toBe(2);
    expect("batteria_kwh" in off).toBe(false);
    p.battery.enabled = true;
    const ev = evaluate(p, milano);
    const on = exportConsumptionCurve(p, milano, pk(ev, "P"));
    expect(on.versione).toBe(3);
    expect(on.batteria_kwh).toBe(5);
    expect(on.fv_sottratto_kwp).toBe(4);
    expect(on.descrizione).toMatch(/batteria 5 kWh/);
    expect(on.kwh_annui).toBeLessThan(off.kwh_annui);
    // ora per ora i prelievi esportati sono quelli del bilancio del pacchetto
    const s = gridImportSeries(p, milano, pk(ev, "P"));
    expect(s.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(pk(ev, "P").elec.import_kWh, 6);
    // i pacchetti senza FV non hanno batteria: formato 2
    expect(exportConsumptionCurve(p, milano, pk(ev, "H")).versione).toBe(2);
  });
});

describe("File di progetto con la batteria e senza", () => {
  it("un file vecchio, senza batteria, FV esistente e domanda, si apre come quadro completo senza avvisi", () => {
    const file = toProjectFile(exampleProject(), milano) as unknown as { input: Record<string, unknown> };
    const input = file.input as Record<string, unknown> & { economics: { incentive: Record<string, unknown> } };
    delete input.battery;
    delete input.existingPv;
    delete input.goal;
    delete input.economics.incentive.batteryPct;
    const r = parseProjectFile(JSON.stringify(file), milano);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes("Campi assenti"))).toBe(false);
    expect(r.file!.input.goal).toBe("completo");
    expect(r.file!.input.battery.enabled).toBe(false);
    expect(r.file!.input.existingPv.present).toBe(false);
    const ev = evaluate(r.file!.input, milano);
    const now = evaluate(exampleProject(), milano);
    for (const id of ["base", "P", "WHP"] as PackageId[]) expect(pk(ev, id).cash?.npv).toBe(pk(now, id).cash?.npv);
  });

  it("batteria, FV esistente e domanda si salvano e si riaprono", () => {
    const p = existing();
    p.goal = "batteria";
    p.battery.capacityKwh.value = 7.5;
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.goal).toBe("batteria");
    expect(r.file!.input.existingPv.present).toBe(true);
    expect(r.file!.input.battery.capacityKwh.value).toBe(7.5);
  });

  it("valori non ammessi rifiutati", () => {
    const p = exampleProject() as unknown as Record<string, unknown>;
    p.goal = "tutto";
    expect(parseProjectFile(JSON.stringify(toProjectFile(p as unknown as ProjectInput, milano)), milano).errors.join(" ")).toMatch(/goal/);
  });
});
