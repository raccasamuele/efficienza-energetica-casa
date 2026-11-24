import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleProject } from "../src/engine";
import { applyBillUpdates, billUpdates, linesFromItems, readBill } from "../src/engine/bolletta";

const fixture = (name: string) => readFileSync(resolve(__dirname, `fixtures/bollette/${name}.txt`), "utf-8");
const FIXTURES = ["plenitude-gas", "enel-luce", "edison-luce", "a2a-gas", "altro-luce"];

describe("3B: lettura delle bollette, fornitore per fornitore", () => {
  it("Eni Plenitude, gas (fac-simile del nuovo formato 2025)", () => {
    const r = readBill(fixture("plenitude-gas"));
    expect(r).toMatchObject({
      fornitore: "Eni Plenitude",
      servizio: "gas",
      periodo: { dal: "2025-03-01", al: "2025-04-30" },
      consumoPeriodo: 127,
      consumoAnnuo: { valore: 895, dal: "2024-05-01", al: "2025-04-30", daInizio: false },
      letture: "effettive",
      offerta: "prezzo variabile",
      quotaFissaMese: 16.57,
      prezzoMedioConsumi: 0.808898,
      spesaAnnua: { valore: 820.62, dal: "2024-05-18", al: "2025-05-17" },
      potenzaImpegnata: null,
      fasce: null,
    });
    expect(r.pcs_kWhSmc).toBeCloseTo(10.972, 3);
  });

  it("Enel Energia, luce: potenza «contrattualmente impegnata», consumo annuo per fascia", () => {
    const r = readBill(fixture("enel-luce"));
    expect(r).toMatchObject({
      fornitore: "Enel Energia",
      servizio: "luce",
      periodo: { dal: "2026-01-01", al: "2026-02-28" },
      consumoPeriodo: 412,
      consumoAnnuo: { valore: 2540, dal: "2025-03-01", al: "2026-02-28", daInizio: false },
      fasce: { f1: 812, f2: 790, f3: 938, di: "annuo" },
      letture: "effettive",
      offerta: "prezzo fisso",
      quotaFissaMese: 7.2,
      prezzoMedioConsumi: 0.1623,
      potenzaImpegnata: 3,
      potenzaDisponibile: 3.3,
      spesaAnnua: { valore: 712.35, dal: "2025-03-01", al: "2026-02-28" },
      pcs_kWhSmc: null,
    });
  });

  it("Edison Energia, luce: letture in parte stimate, offerta a prezzo variabile", () => {
    const r = readBill(fixture("edison-luce"));
    expect(r).toMatchObject({
      fornitore: "Edison Energia",
      servizio: "luce",
      periodo: { dal: "2026-09-01", al: "2026-10-31" },
      consumoPeriodo: 386,
      consumoAnnuo: { valore: 3120, dal: "2025-11-01", al: "2026-10-31", daInizio: false },
      fasce: { f1: 1010, f2: 980, f3: 1130, di: "annuo" },
      letture: "in parte stimate",
      offerta: "prezzo variabile",
      quotaFissaMese: 10.5,
      prezzoMedioConsumi: 0.198,
      potenzaImpegnata: 4.5,
      potenzaDisponibile: 4.95,
    });
  });

  it("A2A Energia, gas: consumo da inizio fornitura, non un anno", () => {
    const r = readBill(fixture("a2a-gas"));
    expect(r).toMatchObject({
      fornitore: "A2A Energia",
      servizio: "gas",
      consumoPeriodo: 38,
      consumoAnnuo: { valore: 290, dal: "2026-02-01", al: "2026-09-30", daInizio: true },
      letture: "effettive",
      offerta: "prezzo fisso",
      quotaFissaMese: 9,
      prezzoMedioConsumi: 0.95,
    });
    expect(r.pcs_kWhSmc).toBeCloseTo(10.7, 2);
  });

  it("un altro fornitore: lettore comune, sui nomi stabiliti da ARERA", () => {
    const r = readBill(fixture("altro-luce"));
    expect(r).toMatchObject({
      fornitore: null,
      servizio: "luce",
      periodo: { dal: "2026-06-01", al: "2026-06-30" },
      consumoPeriodo: 245,
      consumoAnnuo: { valore: 2780, dal: "2025-07-01", al: "2026-06-30", daInizio: false },
      potenzaImpegnata: 3,
      offerta: "altra",
      letture: "effettive",
      fasce: null,
    });
  });

  it("PDF senza testo o testo che non è una bolletta: messaggio chiaro", () => {
    expect(() => readBill("")).toThrow("non contiene testo");
    expect(() => readBill("   \n  ")).toThrow("non contiene testo");
    expect(() => readBill("Verbale della riunione di condominio del 3 marzo")).toThrow("Non sembra una bolletta");
  });
});

describe("3B: nessun dato personale", () => {
  const PERSONAL = ["ESEMPIO", "ESMMRA", "IT000E", "00000000000000", "9999999999999", "777 777", "5555555", "1111111", "VIA ", "Via ", "8888888888", "C-000000", "Trend Casa"];
  for (const name of FIXTURES)
    it(`${name}: né POD o PDR, né codice cliente, né nome, né indirizzo nel risultato`, () => {
      const r = readBill(fixture(name));
      const p = exampleProject();
      const out = JSON.stringify(r) + JSON.stringify(billUpdates(p, r));
      for (const s of PERSONAL) expect(out).not.toContain(s);
    });

  it("il lettore delle bollette non conserva il testo letto", () => {
    const r = readBill(fixture("plenitude-gas"));
    expect(JSON.stringify(r).length).toBeLessThan(1500);
  });
});

describe("3B: dai campi letti al progetto, solo con la conferma", () => {
  it("gas: consumo annuo, periodo e potere calorifico proposti, con fonte e stato documentato", () => {
    const p = exampleProject();
    const ups = billUpdates(p, readBill(fixture("plenitude-gas")));
    expect(ups.map((u) => u.path)).toEqual(["consumption.gasSmcObserved", "consumption.observedPeriod", "system.gasPcs"]);
    const gas = ups[0];
    expect(gas.proposed).toBe(895);
    expect(gas.current).toBe(p.consumption.gasSmcObserved.value);
    const after = applyBillUpdates(p, ups, ["consumption.gasSmcObserved", "consumption.observedPeriod"]);
    expect(after.consumption.gasSmcObserved).toEqual({ value: 895, status: "documentato", source: "Bolletta di aprile 2025, letta nel browser" });
    expect(after.consumption.observedPeriod).toBe("dal 01/05/2024 al 30/04/2025");
    expect(after.system.gasPcs).toEqual(p.system.gasPcs); // non confermato: non cambia
    expect(p.consumption.gasSmcObserved).toEqual(exampleProject().consumption.gasSmcObserved); // il progetto di partenza resta com'era
  });

  it("nessuna conferma, nessun cambiamento", () => {
    const p = exampleProject();
    const ups = billUpdates(p, readBill(fixture("enel-luce")));
    expect(applyBillUpdates(p, ups, [])).toEqual(p);
  });

  it("luce: consumo annuo agli altri usi e potenza contrattuale", () => {
    const p = exampleProject();
    const ups = billUpdates(p, readBill(fixture("enel-luce")));
    expect(ups.map((u) => [u.path, u.proposed])).toEqual([["consumption.electricityKwh", 2540], ["tariffs.contractPower", 3]]);
    expect(ups[0].note).toMatch(/pompa di calore|condizionatori/);
  });

  it("con il FV già installato e i consumi dalla bolletta, il consumo annuo sono i prelievi", () => {
    const p = exampleProject();
    p.existingPv.present = true;
    p.existingPv.consumptionFrom = "bolletta";
    expect(billUpdates(p, readBill(fixture("enel-luce")))[0].path).toBe("existingPv.gridImportKwh");
    p.existingPv.consumptionFrom = "inverter";
    const ups = billUpdates(p, readBill(fixture("enel-luce")));
    expect(ups.map((u) => u.path)).toEqual(["tariffs.contractPower"]);
  });

  it("consumo da inizio fornitura: non si propone come consumo annuo", () => {
    const p = exampleProject();
    const r = readBill(fixture("a2a-gas"));
    const ups = billUpdates(p, r);
    expect(ups.map((u) => u.path)).toEqual(["system.gasPcs"]);
    expect(r.avvisi.join(" ")).toContain("da inizio fornitura");
  });

  it("una bolletta del gas non propone nulla per la luce, e viceversa", () => {
    const p = exampleProject();
    expect(billUpdates(p, readBill(fixture("plenitude-gas"))).some((u) => u.path.includes("electricity") || u.path.includes("contractPower"))).toBe(false);
    expect(billUpdates(p, readBill(fixture("edison-luce"))).some((u) => u.path.includes("gas"))).toBe(false);
  });
});

describe("3B: testo del PDF e libreria", () => {
  it("i pezzi di testo di pdf.js diventano righe: stessa altezza, da sinistra a destra, pagina per pagina", () => {
    const text = linesFromItems([
      { str: "B", x: 50, y: 700, page: 1 },
      { str: "A", x: 10, y: 700.8, page: 1 },
      { str: "C", x: 10, y: 680, page: 1 },
      { str: "D", x: 10, y: 700, page: 2 },
      { str: " ", x: 30, y: 680, page: 1 },
    ]);
    expect(text).toBe("A B\nC\nD");
  });

  it("pdf.js non entra nel file principale: si importa solo quando serve", () => {
    const dir = resolve(__dirname, "../src");
    const files = (sub: string): string[] =>
      readdirSync(resolve(dir, sub), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${sub}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${sub}/${e.name}`] : []));
    const all = files(".");
    for (const f of all) {
      const s = readFileSync(resolve(dir, f), "utf-8");
      expect(s, f).not.toMatch(/^import[^;]*["']pdfjs-dist["']/m); // pdfjs-dist mai importato all'avvio
      expect(s, f).not.toMatch(/from ["'][./]*pdf-text["']/); // il lettore del PDF si carica con import()
    }
    const loader = readFileSync(resolve(dir, "ui/pdf-text.ts"), "utf-8");
    expect(loader).toMatch(/import\(["']pdfjs-dist["']\)/);
    expect(loader).not.toMatch(/https?:\/\//); // nessun indirizzo esterno: libreria e worker serviti dal sito
  });
});
