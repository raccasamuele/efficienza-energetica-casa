import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, parseComuni, parseProjectFile, q, toProjectFile } from "../src/engine";
import { codificaRisposte, controllaRisposte, creaProgetto, leggiRisposte } from "../src/ui/crea-progetto";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

// Punto 6 della verifica dei 5 punti emersi dalla prova in Claude Desktop (23/11/2026): con gli split il modello aggiunge
// da sé il loro consumo, ma di solito la bolletta li comprende già. Samuele, 23/11/2026: «Chiedere in bolletta».
const climate = loadMilanoLegacy();
const comuni = parseComuni(readPublicJson("comuni.json"));
const index = (readPublicJson("packages/index.json") as { climates: never[] }).climates;
const conSplit = () => { const p = exampleProject(); p.cooling.today = "split"; p.consumption.electricityKwh = q(3200); return p; };
const base = (p: ReturnType<typeof exampleProject>) => evaluate(p, climate).packages.find((r) => r.id === "base")!;

describe("split già compresi nella bolletta", () => {
  it("di serie gli split si aggiungono alla luce indicata, come prima", () => {
    const p = conSplit();
    expect(p.cooling.alreadyInConsumption).toBe(false);
    const r = base(p);
    expect(r.otherUses_kWh).toBeCloseTo(3200, 6);
    expect(r.cooling!.elec_kWh).toBeGreaterThan(100);
  });

  it("se la bolletta li comprende, il loro consumo si toglie dagli altri usi: il totale resta la bolletta", () => {
    const p = conSplit(), prima = base(p);
    p.cooling.alreadyInConsumption = true;
    const r = base(p);
    expect(r.cooling!.elec_kWh).toBeCloseTo(prima.cooling!.elec_kWh, 6);
    expect(r.otherUses_kWh).toBeCloseTo(3200 - prima.cooling!.elec_kWh, 6);
    expect(r.otherUses_kWh + r.cooling!.elec_kWh).toBeCloseTo(3200, 6);
  });

  it("senza split la casella non cambia niente", () => {
    const p = exampleProject(); p.consumption.electricityKwh = q(3200);
    const prima = base(p);
    p.cooling.alreadyInConsumption = true;
    expect(base(p).otherUses_kWh).toBeCloseTo(prima.otherUses_kWh, 6);
  });

  it("errore leggibile se gli split consumano più della luce indicata", () => {
    const p = conSplit(); p.cooling.alreadyInConsumption = true; p.consumption.electricityKwh = q(300);
    const ev = evaluate(p, climate);
    expect(ev.ok).toBe(false);
    expect(ev.issues.some((i) => i.severity === "errore" && /condizionatori/.test(i.message))).toBe(true);
  });

  it("i progetti salvati prima si aprono con la casella spenta, senza avvisi, e danno gli stessi numeri", () => {
    const p = conSplit();
    const file = toProjectFile(p, climate) as unknown as { input: { cooling: Record<string, unknown> } };
    delete file.input.cooling.alreadyInConsumption;
    const r = parseProjectFile(JSON.stringify(file), climate);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).not.toMatch(/alreadyInConsumption/);
    expect(r.file!.input.cooling.alreadyInConsumption).toBe(false);
    expect(base(r.file!.input).otherUses_kWh).toBeCloseTo(base(p).otherUses_kWh, 6);
  });

  it("con il FV esistente e i prelievi in bolletta la casella non si applica: gli split sono già nel calcolo dei prelievi", () => {
    const p = conSplit(); p.existingPv.present = true; p.existingPv.consumptionFrom = "bolletta"; p.existingPv.gridImportKwh = q(2500);
    const prima = base(p);
    p.cooling.alreadyInConsumption = true;
    expect(base(p).otherUses_kWh).toBeCloseTo(prima.otherUses_kWh, 6);
  });

  it("crea_progetto e il link «Apri in Casa» portano la risposta split_in_bolletta", () => {
    const fossano = comuni.find((c) => c.name === "Fossano")!.code;
    const ok = controllaRisposte({ comune: fossano, domanda: "completo", raffrescamento: "split", luce_kwh_anno: 3200, split_in_bolletta: true });
    expect(ok.errori).toEqual([]);
    expect(creaProgetto(ok.risposte!, comuni, index).progetto!.cooling.alreadyInConsumption).toBe(true);
    expect(leggiRisposte(codificaRisposte(ok.risposte!)).risposte).toEqual(ok.risposte);
    expect(controllaRisposte({ comune: fossano, domanda: "completo", split_in_bolletta: "sì" }).errori).toEqual(["split_in_bolletta: sì o no."]);
    // Senza la risposta resta come prima: spenta.
    const senza = controllaRisposte({ comune: fossano, domanda: "completo", raffrescamento: "split" });
    expect(creaProgetto(senza.risposte!, comuni, index).progetto!.cooling.alreadyInConsumption).toBe(false);
  });
});
