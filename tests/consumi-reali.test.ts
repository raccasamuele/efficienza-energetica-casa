import { describe, expect, it } from "vitest";
import {
  evaluate,
  exampleProject,
  parseProjectFile,
  toProjectFile,
  type ProjectInput,
} from "../src/engine";
import { CURVE_CELLS, curveCell, otherUsesDemand, reconstructedOre, exportBeyondPv } from "../src/engine/curva";
import { packagePv } from "../src/engine/electric";
import { curveAnnualKwh, curveFromFiles, exportFromFiles, measuredCurveErrors } from "../src/engine/misure";
import { loadMilano } from "./helpers";

const milano = loadMilano();

const hourKwh = (h: number) => (h >= 18 && h < 22 ? 1 : 0.1);
const isoOf = (start: string, i: number) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

/** File del Portale Consumi dal giorno `start` per `days` giorni; `scale` moltiplica i consumi di ogni giorno. */
function portale(start: string, days: number, scale: (iso: string) => number = () => 1, value: (h: number) => number = hourKwh): string {
  const head = `pod;data_lettura;data_ricezione;motivazione;lettura_monoraria;lettura_f1;tipo_flusso;annomese_riferimento;${Array.from({ length: 96 }, (_, i) => `ea${i + 1}`).join(";")}`;
  const rows: string[] = [head];
  for (let i = 0; i < days; i++) {
    const iso = isoOf(start, i);
    const k = scale(iso);
    const q = Array.from({ length: 96 }, (_, j) => ((value(Math.floor(j / 4)) * k) / 4).toFixed(4)).join(";");
    rows.push(`IT001E12345678;${iso};${iso};normale;0;0;x;${iso.slice(0, 7).replace("-", "")};${q}`);
  }
  return rows.join("\n");
}

/** Consumo vero del file: somma di tutti i quarti d'ora dei giorni di un anno solare. */
function fileTotal(start: string, days: number, scale: (iso: string) => number, year: string): number {
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const iso = isoOf(start, i);
    if (iso.startsWith(year)) for (let h = 0; h < 24; h++) sum += hourKwh(h) * scale(iso);
  }
  return sum;
}

const BY_YEAR: Record<string, number> = { "2021": 1.2, "2022": 1.1, "2023": 1 };
const byYear = (iso: string) => BY_YEAR[iso.slice(0, 4)];
const threeYears = () => portale("2021-01-01", 1095, byYear);
const monthOf = (cell: number) => Math.floor(cell / 24) % 12;

describe("3A: curve del contatore su più anni", () => {
  it("un anno pieno: il consumo annuo della forma è quello del file", () => {
    const { curve } = curveFromFiles([portale("2023-01-01", 365)]);
    const real = fileTotal("2023-01-01", 365, () => 1, "2023");
    expect(Math.abs(curveAnnualKwh(curve.ore) - real) / real).toBeLessThan(0.01);
    expect(curve.anni).toHaveLength(1);
    expect(curve.anni![0]).toMatchObject({ dal: "2023-01-01", al: "2023-12-31", giorni: 365 });
    expect(Math.abs(curve.anni![0].kwh - real) / real).toBeLessThan(0.01);
  });

  it("tre anni: la forma principale è quella degli ultimi 12 mesi, ogni anno ha il suo totale", () => {
    const { curve } = curveFromFiles([threeYears()]);
    const last = curveFromFiles([portale("2023-01-01", 365)]).curve;
    expect(curve.ore).toEqual(last.ore);
    expect(curve.dal).toBe("2023-01-01");
    expect(curve.al).toBe("2023-12-31");
    expect(curve.giorni).toBe(365);
    expect(curve.anni!.map((a) => a.dal)).toEqual(["2023-01-01", "2022-01-01", "2021-01-01"]);
    for (const a of curve.anni!) {
      const real = fileTotal("2021-01-01", 1095, byYear, a.dal.slice(0, 4));
      expect(Math.abs(a.kwh - real) / real).toBeLessThan(0.01);
    }
    expect(curve.anni![1].kwh).toBeGreaterThan(curve.anni![0].kwh);
  });

  it("un mese che manca negli ultimi 12 si prende dall'anno prima, non dalla media degli altri mesi", () => {
    const rows = threeYears().split("\n").filter((r) => !r.includes(";2023-03-"));
    const { curve } = curveFromFiles([rows.join("\n")]);
    const march = Array.from({ length: CURVE_CELLS }, (_, i) => i).filter((i) => monthOf(i) === 2 && i % 24 === 19);
    for (const i of march) expect(curve.ore[i]).toBeCloseTo(1.1, 3); // marzo 2022
    const may = Array.from({ length: CURVE_CELLS }, (_, i) => i).filter((i) => monthOf(i) === 4 && i % 24 === 19);
    for (const i of may) expect(curve.ore[i]).toBeCloseTo(1, 3); // maggio 2023
    expect(curve.giorni).toBe(365 - 31);
  });

  it("meno di dodici mesi: tutto come prima, nessun anno da mostrare", () => {
    const { curve } = curveFromFiles([portale("2023-01-01", 200)]);
    expect(curve.giorni).toBe(200);
    expect(curve.dal).toBe("2023-01-01");
    expect(curve.anni).toEqual([]);
  });

  it("gli anni precedenti più brevi di 330 giorni non si mostrano", () => {
    const { curve } = curveFromFiles([portale("2022-07-01", 549, byYear)]);
    expect(curve.anni!.map((a) => a.giorni)).toEqual([365]);
  });

  it("le date della curva non dicono nulla oltre il periodo: niente POD, niente letture", () => {
    const text = JSON.stringify(curveFromFiles([threeYears()]).curve);
    expect(text).not.toContain("IT001");
    expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

/** Produzione del FV esistente in kWh medi per cella, come la usa la ricostruzione. */
function pvCells(p: ProjectInput): number[] {
  const pv = packagePv(milano, p, false)!;
  const sum = new Array<number>(CURVE_CELLS).fill(0);
  const n = new Array<number>(CURVE_CELLS).fill(0);
  pv.forEach((w, h) => {
    sum[curveCell(h)] += w / 1000;
    n[curveCell(h)] += 1;
  });
  return sum.map((s, i) => s / n[i]);
}

function withMeter(immissioni: (cell: number, pv: number[]) => number): ProjectInput {
  const p = exampleProject();
  p.existingPv.present = true;
  p.existingPv.consumptionFrom = "contatore";
  const { curve } = curveFromFiles([portale("2023-01-01", 365)]);
  const pv = pvCells(p);
  p.consumption.measuredCurve = { ...curve, immissioni: { ore: curve.ore.map((_, i) => immissioni(i, pv)), giorni: 365, dal: "2023-01-01", al: "2023-12-31" } };
  return p;
}

describe("3A: immissioni con il FV già installato", () => {
  it("immissioni a zero: il consumo è prelievi più tutta la produzione stimata", () => {
    const p = withMeter(() => 0);
    const pv = pvCells(p);
    const ore = reconstructedOre(p.consumption.measuredCurve!, packagePv(milano, p, false)!);
    ore.forEach((v, i) => expect(v).toBeCloseTo(p.consumption.measuredCurve!.ore[i] + pv[i], 6));
  });

  it("immissioni uguali alla produzione: il consumo è uguale ai prelievi", () => {
    const p = withMeter((i, pv) => pv[i]);
    const ore = reconstructedOre(p.consumption.measuredCurve!, packagePv(milano, p, false)!);
    ore.forEach((v, i) => expect(v).toBeCloseTo(p.consumption.measuredCurve!.ore[i], 6));
    expect(exportBeyondPv(p.consumption.measuredCurve!, packagePv(milano, p, false)!)).toBeCloseTo(0, 6);
  });

  it("immissioni oltre la produzione: autoconsumo zero, mai un consumo più basso dei prelievi", () => {
    const p = withMeter((i, pv) => pv[i] * 2);
    const c = p.consumption.measuredCurve!;
    const ore = reconstructedOre(c, packagePv(milano, p, false)!);
    ore.forEach((v, i) => expect(v).toBeCloseTo(c.ore[i], 6));
    expect(exportBeyondPv(c, packagePv(milano, p, false)!)).toBeCloseTo(0.5, 3);
  });

  it("nel calcolo: altri usi dalla curva ricostruita, che cambia con i kWp dell'impianto", () => {
    const p = withMeter((i, pv) => pv[i] * 0.6);
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(true);
    const base = ev.packages.find((x) => x.id === "base")!;
    const expected = curveAnnualKwh(reconstructedOre(p.consumption.measuredCurve!, packagePv(milano, p, false)!));
    expect(base.otherUses_kWh).toBeCloseTo(expected, 0);
    const d = otherUsesDemand(p, base.otherUses_kWh, milano);
    expect(d.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(base.otherUses_kWh, 3);
    const bigger = structuredClone(p);
    bigger.existingPv.kWp.value *= 1.5;
    expect(evaluate(bigger, milano).packages.find((x) => x.id === "base")!.otherUses_kWh).toBeGreaterThan(base.otherUses_kWh);
    expect(ev.issues.map((i) => i.message).join(" ")).not.toContain("non è la forma dei consumi");
  });

  it("prelievi misurati e prelievi del modello: lo scarto si dice, non si nasconde", () => {
    const p = withMeter((i, pv) => pv[i] * 0.6);
    const ev = evaluate(p, milano);
    const base = ev.packages.find((x) => x.id === "base")!;
    const note = ev.issues.find((i) => i.message.includes("il contatore misura"))!;
    expect(note.severity).toBe("nota");
    expect(note.message).toContain(`${Math.round(curveAnnualKwh(p.consumption.measuredCurve!.ore)).toLocaleString("it-IT")} kWh`);
    expect(note.message).toContain(`${Math.round(base.elec.import_kWh).toLocaleString("it-IT")} kWh`);
  });

  it("immissioni molto oltre la produzione stimata: un avviso sui dati dell'impianto", () => {
    const ev = evaluate(withMeter((i, pv) => pv[i] * 1.5), milano);
    expect(ev.issues.map((i) => i.message).join(" ")).toContain("immissioni misurate superano la produzione stimata");
    const fine = evaluate(withMeter((i, pv) => pv[i] * 0.6), milano);
    expect(fine.issues.map((i) => i.message).join(" ")).not.toContain("immissioni misurate superano");
  });

  it("«dalla curva del contatore» senza le immissioni: errore chiaro, nessun risultato inventato", () => {
    const p = withMeter(() => 0);
    delete p.consumption.measuredCurve!.immissioni;
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(false);
    expect(ev.issues.map((i) => i.message).join(" ")).toContain("file delle immissioni");
    const none = withMeter(() => 0);
    none.consumption.measuredCurve = null;
    expect(evaluate(none, milano).ok).toBe(false);
  });

  it("periodi diversi di oltre un mese fra prelievi e immissioni: un avviso", () => {
    const p = withMeter((i, pv) => pv[i] * 0.5);
    p.consumption.measuredCurve!.immissioni!.dal = "2022-06-01";
    p.consumption.measuredCurve!.immissioni!.al = "2023-05-31";
    expect(evaluate(p, milano).issues.map((i) => i.message).join(" ")).toContain("periodi diversi");
  });

  it("file delle immissioni: stesso lettore, messaggio proprio se tutto a zero", () => {
    const night = (h: number) => (h >= 10 && h < 16 ? 0.8 : 0);
    const r = exportFromFiles([portale("2023-01-01", 365, () => 1, night)]);
    expect(r.immissioni.ore).toHaveLength(CURVE_CELLS);
    expect(r.immissioni.ore[12]).toBeCloseTo(0.8, 3);
    expect(r.immissioni.ore[2]).toBe(0);
    expect(JSON.stringify(r.immissioni)).not.toContain("IT001");
    expect(() => exportFromFiles([portale("2023-01-01", 60, () => 0)])).toThrow("immissioni tutte a zero");
  });
});

describe("3A: file di progetto", () => {
  it("una curva salvata prima (senza anni né immissioni) si apre e dà gli stessi risultati", () => {
    const p = exampleProject();
    const { curve } = curveFromFiles([portale("2023-01-01", 365)]);
    const old = { ore: curve.ore, giorni: curve.giorni, dal: curve.dal, al: curve.al, fonte: curve.fonte };
    p.consumption.measuredCurve = old;
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).not.toMatch(/curv|consum|measured/i);
    expect(r.file!.input.consumption.measuredCurve).toEqual(old);
    const a = evaluate(p, milano).packages.map((x) => x.cash?.npv);
    const b = evaluate(r.file!.input, milano).packages.map((x) => x.cash?.npv);
    expect(b).toEqual(a);
  });

  it("dati non validi nelle immissioni o negli anni: rifiutati", () => {
    const { curve } = curveFromFiles([portale("2023-01-01", 365)]);
    expect(measuredCurveErrors({ ...curve, immissioni: { ore: [1, 2], giorni: 1, dal: "2023-01-01", al: "2023-01-01" } }).join(" ")).toContain("Immissioni");
    expect(measuredCurveErrors({ ...curve, immissioni: { ore: curve.ore.map(() => -1), giorni: 1, dal: "2023-01-01", al: "2023-01-01" } }).join(" ")).toContain("Immissioni");
    expect(measuredCurveErrors({ ...curve, anni: [{ dal: "x", al: "y", giorni: -3, kwh: 10 }] }).join(" ")).toContain("anni");
    expect(measuredCurveErrors({ ...curve, anni: Array.from({ length: 12 }, () => curve.anni![0]) }).join(" ")).toContain("anni");
    expect(measuredCurveErrors(curve)).toEqual([]);
  });

  it("il progetto salvato con curva e immissioni non contiene il POD", () => {
    const p = withMeter((i, pv) => pv[i] * 0.5);
    expect(JSON.stringify(toProjectFile(p, milano))).not.toContain("IT001");
  });
});
