import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleProject, toProjectFile } from "../src/engine";
import { createData } from "../mcp/dati";
import { createTools } from "../mcp/strumenti";
import { applicaModifiche, fonteVariante, leggiModifiche, MAX_MODIFICHE } from "../mcp/variante";

// Passo 2 degli strumenti per agenti AI: prova_variante (guida: docs/ecosistema/GUIDA-MCP.md), 19/11/2026.
const data = createData(resolve(__dirname, "../public/data"));
const file = (p = exampleProject()) => JSON.stringify(toProjectFile(p, null));
type Confronto = { id: string; van_prima_euro: number | null; van_dopo_euro: number | null; differenza_euro: number | null };
type Pacchetto = { id: string; van_euro: number | null };

describe("modifiche ammesse", () => {
  it("elenco chiuso, numeri finiti, motivo obbligatorio, niente doppioni, al massimo dieci", () => {
    expect(leggiModifiche([]).errori[0]).toMatch(/almeno una/);
    expect(leggiModifiche(Array(MAX_MODIFICHE + 1).fill({ campo: "pv.kWp", valore: 1, motivo: "x" })).errori[0]).toMatch(/Al massimo 10/);
    const bad = leggiModifiche([
      { campo: "building.floorArea", valore: 100, motivo: "x" },
      { campo: "pv.kWp", valore: "6", motivo: "x" },
      { campo: "tariffs.elecPrice", valore: 0.3, motivo: "  " },
      { campo: "tariffs.gasPrice", valore: 1.2, motivo: "x" },
      { campo: "tariffs.gasPrice", valore: 1.3, motivo: "x" },
    ]).errori.join(" ");
    for (const part of ["non ammesso", "serve un numero", "serve il motivo", "campo ripetuto"]) expect(bad).toContain(part);
  });

  it("ogni valore nuovo è un'ipotesi con il motivo come fonte; il progetto di partenza non cambia", () => {
    const p = exampleProject();
    const before = structuredClone(p);
    const { progetto, prima } = applicaModifiche(p, [{ campo: "tariffs.elecPrice", valore: 0.35, motivo: "chiesto dall'utente" }]);
    expect(progetto.tariffs.elecPrice).toEqual({ value: 0.35, status: "ipotizzato", source: fonteVariante("chiesto dall'utente"), confirmed: false });
    expect(prima["tariffs.elecPrice"]).toBe(before.tariffs.elecPrice.value);
    expect(p).toEqual(before);
  });
});

describe("prova_variante", () => {
  it("confronta prima e dopo con gli stessi numeri di valuta_progetto sul progetto cambiato", async () => {
    const tools = createTools(data);
    const tool = (n: string) => tools.find((t) => t.name === n)!;
    const out = await tool("prova_variante").run({ contenuto: file(), modifiche: [{ campo: "tariffs.elecPrice", valore: 0.35, motivo: "prova con la luce più cara" }, { campo: "economics.horizonYears", valore: 25, motivo: "chiesto dall'utente" }] });
    expect(out.isError).toBeFalsy();
    const s = out.structured as { progetto_id: string; confronto: Confronto[]; verdetto_prima: string; verdetto_dopo: string; modifiche: { applicata: boolean }[] };
    expect(s.modifiche.every((m) => m.applicata)).toBe(true);
    const original = await tool("valuta_progetto").run({ contenuto: file() });
    const changed = exampleProject();
    changed.tariffs.elecPrice = { value: 0.35, status: "ipotizzato", source: "x" };
    changed.economics.horizonYears = { value: 25, status: "ipotizzato", source: "x" };
    const manual = await tool("valuta_progetto").run({ contenuto: file(changed) });
    const byId = (rows: Pacchetto[]) => Object.fromEntries(rows.filter((r) => r.id !== "base").map((r) => [r.id, r.van_euro]));
    expect(Object.fromEntries(s.confronto.map((r) => [r.id, r.van_prima_euro]))).toEqual(byId(original.structured.pacchetti as Pacchetto[]));
    expect(Object.fromEntries(s.confronto.map((r) => [r.id, r.van_dopo_euro]))).toEqual(byId(manual.structured.pacchetti as Pacchetto[]));
    expect(s.verdetto_dopo).toBe((manual.structured.verdetto as { frase: string }).frase);
    // La variante resta in memoria: valuta_progetto con il nuovo progetto_id dà gli stessi numeri.
    const again = await tool("valuta_progetto").run({ progetto_id: s.progetto_id });
    expect(byId(again.structured.pacchetti as Pacchetto[])).toEqual(byId(manual.structured.pacchetti as Pacchetto[]));
    for (const part of ["Prima:", "Dopo:", "ipotizzato", "Limiti del modello:"]) expect(out.text).toContain(part);
  });

  it("con un preventivo non cambia la taglia del fotovoltaico: il costo resterebbe quello del preventivo", async () => {
    const tools = createTools(data);
    const out = await tools.find((t) => t.name === "prova_variante")!.run({ contenuto: file(), modifiche: [{ campo: "pv.kWp", valore: 6, motivo: "chiesto dall'utente" }] });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/taglia e prezzo vanno insieme/);
  });

  it("con la taglia indicativa kWp e kWh si leggono dalla curva del modello, senza cambiare la scelta", async () => {
    const tools = createTools(data);
    const tool = (n: string) => tools.find((t) => t.name === n)!;
    const made = await tool("crea_progetto").run({ comune: "Fossano", domanda: "fv", superficie_m2: 140, luce_kwh_anno: 3200, preventivo_fv: false, tetto_m2: 40 });
    const id = (made.structured as { progetto_id: string }).progetto_id;
    const out = await tool("prova_variante").run({ progetto_id: id, modifiche: [{ campo: "pv.kWp", valore: 6, motivo: "chiesto dall'utente" }, { campo: "battery.capacityKwh", valore: 10, motivo: "chiesto dall'utente" }] });
    expect(out.isError).toBeFalsy();
    const s = out.structured as { confronto: Confronto[]; dalla_curva: { trovata: boolean; fotovoltaico_kwp: number; batteria_kwh: number; van_euro: number; scelta_del_modello: { fotovoltaico_kwp: number } }[]; modifiche: { applicata: boolean }[] };
    expect(s.modifiche.map((m) => m.applicata)).toEqual([false, false]);
    expect(s.confronto.every((r) => r.differenza_euro === 0)).toBe(true);
    expect(s.dalla_curva[0]).toMatchObject({ trovata: true, fotovoltaico_kwp: 6, batteria_kwh: 10 });
    const value = await tool("valuta_progetto").run({ progetto_id: id });
    const sizing = (value.structured.taglia_indicativa as { scelta_economica: { fotovoltaico_kwp: number } }[])[0];
    expect(s.dalla_curva[0].scelta_del_modello.fotovoltaico_kwp).toBe(sizing.scelta_economica.fotovoltaico_kwp);
    expect(out.text + JSON.stringify(out.structured)).not.toContain("Fossano");
  });

  it("un valore fuori intervallo non dà risultati e dice l'intervallo", async () => {
    const tools = createTools(data);
    const out = await tools.find((t) => t.name === "prova_variante")!.run({ contenuto: file(), modifiche: [{ campo: "tariffs.elecPrice", valore: 9, motivo: "x" }] });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/Prezzo elettricità: 9 fuori dall'intervallo ammesso/);
  });
});
