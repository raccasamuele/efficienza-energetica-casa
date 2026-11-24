import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, type ProjectInput } from "../src/engine";
import { curveFromFiles } from "../src/engine/misure";
import { ConsumptionForm } from "../src/ui/forms";
import { FormContext } from "../src/ui/fields";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const ui = (p: ProjectInput) => text(renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><ConsumptionForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>));

const isoOf = (i: number) => new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10);
function portale(days: number, value: (h: number, iso: string) => number): string {
  const head = `pod;data_lettura;data_ricezione;motivazione;lettura_monoraria;lettura_f1;tipo_flusso;annomese_riferimento;${Array.from({ length: 96 }, (_, i) => `ea${i + 1}`).join(";")}`;
  const rows = Array.from({ length: days }, (_, i) => {
    const iso = isoOf(i);
    return `IT001E12345678;${iso};${iso};normale;0;0;x;202201;${Array.from({ length: 96 }, (_, j) => (value(Math.floor(j / 4), iso) / 4).toFixed(4)).join(";")}`;
  });
  return [head, ...rows].join("\n");
}
const twoYears = () => curveFromFiles([portale(730, (h, iso) => (h >= 18 && h < 22 ? 1 : 0.1) * (iso.startsWith("2022") ? 1.2 : 1))]).curve;
const immissioni = () => {
  const c = curveFromFiles([portale(365, (h) => (h >= 10 && h < 16 ? 0.5 : 0))]).curve;
  return { ore: c.ore, giorni: c.giorni, dal: "2023-01-01", al: "2023-12-31" };
};

function withPv(from: ProjectInput["existingPv"]["consumptionFrom"]): ProjectInput {
  const p = exampleProject();
  p.goal = "batteria";
  p.existingPv.present = true;
  p.existingPv.consumptionFrom = from;
  return p;
}

describe("3A nell'interfaccia", () => {
  it("senza FV: la curva mostra gli anni di misura con il loro consumo", () => {
    const p = exampleProject();
    p.consumption.measuredCurve = twoYears();
    const s = ui(p);
    expect(s).toContain("Anni di misura");
    expect(s).toMatch(/ultimi 12 mesi[^.]*kWh/);
    expect(s).toMatch(/12 mesi prima[^.]*kWh/);
  });

  it("con il FV: si può scegliere la curva del contatore, con due file separati", () => {
    const before = ui(withPv("inverter"));
    expect(before).toContain("Dalla curva del contatore (prelievi e immissioni)");
    expect(before).not.toContain("File delle immissioni");
    const s = ui(withPv("contatore"));
    expect(s).toContain("File dei prelievi");
    expect(s).toContain("File delle immissioni");
    expect(s).not.toContain("Consumo elettrico totale della casa (app dell'inverter)");
  });

  it("con prelievi e immissioni caricati: niente scelta del profilo, consumo ricostruito spiegato", () => {
    const p = withPv("contatore");
    p.consumption.measuredCurve = { ...twoYears(), immissioni: immissioni() };
    const s = ui(p);
    expect(s).not.toContain("Profilo orario degli altri usi");
    expect(s).toContain("Immissioni dal contatore");
    expect(s).toContain("autoconsumo");
  });

  it("nei risultati, accanto ai consumi: prelievi misurati e calcolati", () => {
    const p = withPv("contatore");
    p.consumption.measuredCurve = { ...twoYears(), immissioni: immissioni() };
    const ev = evaluate(p, milano);
    const s = text(renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={milano} />));
    expect(s).toMatch(/ricostruiti dal contatore · prelievi misurati [\d.]+ kWh, calcolati [\d.]+ kWh/);
  });

  it("il report dice da dove vengono i consumi ricostruiti", () => {
    const p = withPv("contatore");
    p.goal = "completo";
    p.consumption.measuredCurve = { ...twoYears(), immissioni: immissioni() };
    const ev = evaluate(p, milano);
    const rep = text(renderToStaticMarkup(<Report p={p} ev={ev} climate={milano} sens={null} />));
    expect(rep).toContain("Ricostruito da prelievi e immissioni del contatore");
    expect(rep).toContain("immissioni dal 01/01/2023 al 31/12/2023");
    expect(rep).not.toContain("IT001");
  });
});
