import { describe, expect, it } from "vitest";
import {
  CURVE_CELLS,
  HOURS,
  consumptionCurve,
  curveCell,
  dayOfYear,
  easterMonday,
  evaluate,
  exampleProject,
  exportConsumptionCurve,
  gridImportSeries,
} from "../src/engine";
import { loadMilano } from "./helpers";

const milano = loadMilano();
/** Prima ora UTC del giorno (mese, giorno) nel calendario sintetico 2025. */
const utc = (month: number, day: number, hour: number) => dayOfYear(month, day) * 24 + hour;

describe("curva-consumi — calendario delle 864 celle", () => {
  it("Pasquetta dall'algoritmo gregoriano", () => {
    expect(easterMonday(2025)).toBe("04-21");
    expect(easterMonday(2023)).toBe("04-10");
    expect(easterMonday(2024)).toBe("04-01");
  });

  it("tipo di giorno, mese e ora civile Europe/Rome", () => {
    // 1/1/2025 mercoledì festivo: 00:00 UTC sono le 01:00 civili
    expect(curveCell(utc(1, 1, 0))).toBe((2 * 12 + 0) * 24 + 1);
    // 2/1/2025 giovedì feriale, 06:00 UTC = 07:00 civili
    expect(curveCell(utc(1, 2, 6))).toBe(7);
    // 4/1/2025 sabato
    expect(curveCell(utc(1, 4, 11))).toBe((1 * 12 + 0) * 24 + 12);
    // 21/4/2025 Pasquetta, lunedì festivo
    expect(curveCell(utc(4, 21, 10))).toBe((2 * 12 + 3) * 24 + 12);
    // ora legale a luglio: 10:00 UTC = 12:00 civili, martedì 15/7
    expect(curveCell(utc(7, 15, 10))).toBe((0 * 12 + 6) * 24 + 12);
    // 23:00 UTC del 31/12 sono le 00:00 del 1/1: il TMY si richiude sul 1/1/2025 festivo
    expect(curveCell(HOURS - 1)).toBe((2 * 12 + 0) * 24 + 0);
  });

  it("passaggi d'ora: le 02:00 mancano il 30/3 e si ripetono il 26/10", () => {
    const cells30m = Array.from({ length: 24 }, (_, k) => curveCell(utc(3, 29, 23) + k) % 24);
    expect(cells30m).not.toContain(2);
    expect(cells30m).toHaveLength(24);
    const twice = [utc(10, 26, 0), utc(10, 26, 1)].map((h) => curveCell(h));
    expect(twice[0]).toBe(twice[1]);
    expect(twice[0] % 24).toBe(2);
  });

  it("tutte le celle hanno almeno un'ora", () => {
    const n = new Array<number>(CURVE_CELLS).fill(0);
    for (let h = 0; h < HOURS; h++) n[curveCell(h)]++;
    expect(n.every((x) => x > 0)).toBe(true);
    expect(n.reduce((a, b) => a + b, 0)).toBe(HOURS);
  });
});

describe("curva-consumi — file", () => {
  it("serie costante: celle uguali e consumo annuo esatto", () => {
    const f = consumptionCurve(new Array<number>(HOURS).fill(500), "prova");
    expect(f.ore).toHaveLength(CURVE_CELLS);
    expect(new Set(f.ore)).toEqual(new Set([0.5]));
    expect(f.kwh_annui).toBe(4380);
    expect(Object.keys(f).sort()).toEqual(["descrizione", "fonte", "formato", "fv_sottratto_kwp", "kwh_annui", "motore", "natura", "ore", "unita", "versione"]);
    expect(f.versione).toBe(2);
    expect(f.fv_sottratto_kwp).toBe(0);
    expect(f.motore).toMatch(/^casa-1R1C \d+\.\d+\.\d+$/);
  });

  it("cella media delle sole ore che vi cadono", () => {
    const s = new Array<number>(HOURS).fill(0);
    s[utc(1, 2, 6)] = 3000; // giovedì 2/1 alle 07:00 civili
    s[utc(1, 3, 6)] = 1000; // venerdì 3/1 alle 07:00 civili
    const f = consumptionCurve(s, "prova");
    const feriali = Array.from({ length: 31 }, (_, d) => d).filter((d) => ![0, 5].includes(d) && ![0, 6].includes(new Date(Date.UTC(2025, 0, 1 + d)).getUTCDay())).length;
    expect(f.ore[7]).toBeCloseTo(4 / feriali, 5);
    expect(f.kwh_annui).toBe(4);
  });

  it("descrizione ripulita dai segni che cersim toglie e accorciata", () => {
    const f = consumptionCurve(new Array<number>(HOURS).fill(1), `Casa <b>*Rossi*</b> #1 [test]\n${"x".repeat(300)}`);
    expect(f.descrizione).not.toMatch(/[<>*#[\]\n]/);
    expect(f.descrizione.length).toBeLessThanOrEqual(200);
    expect(f.descrizione.startsWith("Casa bRossi/b 1 test")).toBe(true);
  });

  it("rifiuta serie corte, valori negativi o non finiti e la curva tutta a zero", () => {
    expect(() => consumptionCurve([1, 2, 3], "x")).toThrow(/8760/);
    const neg = new Array<number>(HOURS).fill(1);
    neg[10] = -1;
    expect(() => consumptionCurve(neg, "x")).toThrow(/ora 10/);
    const nan = new Array<number>(HOURS).fill(1);
    nan[20] = NaN;
    expect(() => consumptionCurve(nan, "x")).toThrow(/ora 20/);
    expect(() => consumptionCurve(new Array<number>(HOURS).fill(0), "x")).toThrow(/zero/);
  });
});

describe("curva-consumi — pacchetti della casa d'esempio", () => {
  const p = exampleProject();
  const ev = evaluate(p, milano);

  it("i prelievi orari tornano con il bilancio di ogni pacchetto valido", () => {
    expect(ev.ok).toBe(true);
    for (const r of ev.packages.filter((x) => x.valid)) {
      const s = gridImportSeries(p, milano, r);
      const total = s.reduce((a, b) => a + b, 0) / 1000;
      expect(Math.abs(total - r.elec.import_kWh)).toBeLessThan(1e-6 * Math.max(1, r.elec.import_kWh));
      const f = exportConsumptionCurve(p, milano, r);
      expect(f.kwh_annui).toBeCloseTo(r.elec.import_kWh, 1);
      expect(f.descrizione).toContain(r.label);
      expect(f.descrizione).toContain("prelievi dalla rete");
      if (r.has.P) expect(f.descrizione).toMatch(/con FV [\d,]+ kWp/);
      expect(f.fv_sottratto_kwp).toBe(r.has.P ? p.pv.kWp.value : 0);
    }
  });

  it("la PDC alza i prelievi d'inverno, il FV li abbassa a mezzogiorno d'estate", () => {
    const get = (id: string) => exportConsumptionCurve(p, milano, ev.packages.find((r) => r.id === id)!);
    const base = get("base"), h = get("H"), hp = get("HP");
    const jan18 = 18, jul13 = 6 * 24 + 13;
    expect(h.ore[jan18]).toBeGreaterThan(base.ore[jan18]);
    expect(hp.ore[jul13]).toBeLessThan(h.ore[jul13]);
  });

  it("pacchetto bloccato: nessuna esportazione", () => {
    const r = { ...ev.packages[2], valid: false };
    expect(() => exportConsumptionCurve(p, milano, r)).toThrow(/bloccato/);
  });
});
