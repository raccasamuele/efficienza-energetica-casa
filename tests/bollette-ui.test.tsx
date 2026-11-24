import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { exampleProject, type ProjectInput } from "../src/engine";
import { readBill } from "../src/engine/bolletta";
import { BillResult } from "../src/ui/bill";
import { ConsumptionForm } from "../src/ui/forms";
import { FormContext } from "../src/ui/fields";

const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const fixture = (name: string) => readFileSync(resolve(__dirname, `fixtures/bollette/${name}.txt`), "utf-8");
const result = (p: ProjectInput, name: string, chosen: string[] = []) =>
  text(renderToStaticMarkup(<BillResult p={p} reading={readBill(fixture(name))} chosen={chosen} onToggle={() => {}} onApply={() => {}} onClose={() => {}} />));

describe("3B nell'interfaccia", () => {
  it("nel passo dei consumi c'è la lettura della bolletta, con la promessa sulla privacy", () => {
    const p = exampleProject();
    const s = text(renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><ConsumptionForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>));
    expect(s).toContain("Leggi una bolletta (PDF)");
    expect(s).toMatch(/resta sul tuo dispositivo/);
    expect(s).toMatch(/POD/);
  });

  it("gas: fornitore, periodo, valori da confermare uno per uno e valori solo letti", () => {
    const s = result(exampleProject(), "plenitude-gas");
    expect(s).toContain("Bolletta del gas · Eni Plenitude · dal 01/03/2025 al 30/04/2025");
    expect(s).toContain("Da confermare, uno per uno");
    expect(s).toMatch(/Gas totale in bolletta: 895 Smc\/anno/);
    expect(s).toContain("Letti, non usati nel calcolo");
    expect(s).toMatch(/senza imposte/);
    expect(s).toContain("Usa i valori confermati (0)");
    expect(s).not.toMatch(/ESEMPIO|00000000000000|9999999999999/);
  });

  it("il pulsante conta i valori confermati", () => {
    expect(result(exampleProject(), "plenitude-gas", ["consumption.gasSmcObserved", "system.gasPcs"])).toContain("Usa i valori confermati (2)");
  });

  it("fornitore senza modello e consumo da inizio fornitura: avvisi visibili", () => {
    expect(result(exampleProject(), "altro-luce")).toContain("lettore comune");
    expect(result(exampleProject(), "a2a-gas")).toContain("da inizio fornitura");
  });

  it("nel percorso del fotovoltaico una bolletta del gas non propone nulla", () => {
    const p = exampleProject();
    p.goal = "fv";
    const s = result(p, "plenitude-gas");
    expect(s).not.toContain("Gas totale in bolletta:");
    expect(s).toMatch(/il gas non cambia il risultato/i);
  });
});
