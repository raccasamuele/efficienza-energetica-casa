import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { curveCell, CURVE_CELLS, evaluatePaths, toProjectFile } from "../src/engine";
import { batteryParams, simulateBattery } from "../src/engine/battery";
import { pvProduction } from "../src/engine/electric";
import { packageSeries } from "../src/engine/profilo";
import { controllaRisposte, creaProgetto, trovaComune } from "../src/ui/crea-progetto";
import { createData } from "../mcp/dati";
import { createTools, openProject } from "../mcp/strumenti";

// Verifica dei 5 punti emersi dalla prova degli strumenti in Claude Desktop (motore 0.18.0), 23/11/2026.
// Verifica del 23/11/2026 dei 5 punti emersi dalla prova in Claude Desktop. Casa di prova: Fossano, 120 m², 2 piani, prima del 1990,
// non isolata, doppi vetri, radiatori, caldaia a gas, split, 3.200 kWh a 0,28 €/kWh, 1.400 Smc a 1,10 €/Smc, tetto 40 m².
const data = createData(resolve(__dirname, "../public/data"));
const CASA = { comune: "Fossano", superficie_m2: 120, piani: 2, epoca: "prima1990", isolamento: "no", vetri: "doppio", raffrescamento: "split", terminali: "radiatori", luce_kwh_anno: 3200, gas_smc_anno: 1400, prezzo_luce_euro_kwh: 0.28, prezzo_gas_euro_smc: 1.1, tetto_m2: 40 };

/** Il progetto come lo crea crea_progetto, aperto come lo apre il server. */
function casa(domanda: "completo" | "fv") {
  const comuni = data.comuni()!;
  const code = trovaComune("Fossano", comuni).comune!.code;
  const p = creaProgetto(controllaRisposte({ ...CASA, domanda, comune: code }).risposte!, comuni, data.index()!).progetto!;
  const o = openProject(data, JSON.stringify(toProjectFile(p, null)));
  if ("errors" in o) throw new Error(o.errors.join("; "));
  return o;
}

async function strumenti(domanda: "completo" | "fv") {
  const tools = createTools(data);
  const tool = (n: string) => tools.find((t) => t.name === n)!;
  const made = await tool("crea_progetto").run({ ...CASA, domanda });
  return { tool, id: (made.structured as { progetto_id: string }).progetto_id };
}

type Percorso = { etichetta: string; van_euro: number; spesa_per_anno_euro: number[] };

describe("punto 1: «il tuo percorso» con interventi senza costi", () => {
  it("il motore non calcola un percorso che passa da pacchetti senza conti completi, e lo dice", () => {
    const { p, climate, ev } = casa("completo");
    // Il piano ereditato dall'esempio mette tutto «subito»; PDC e serramenti non hanno costi.
    expect(p.plan!.custom).toEqual({ W: 0, H: 0, P: 0 });
    expect(ev.packages.find((r) => r.id === "WHP")!.economicsComplete).toBe(false);
    const result = evaluatePaths(p, climate, ev);
    // Prima della correzione: VAN = −10.710 €, cioè solo il costo del FV senza nessun risparmio.
    expect(result.custom).toBeNull();
    expect(result.notes.join(" ")).toMatch(/Il tuo percorso .* non si calcola/);
    expect(result.notes.join(" ")).toMatch(/involucro/);
    expect(result.notes.join(" ")).toMatch(/impianto/);
  });

  it("piano_nel_tempo non mostra più il VAN uguale a meno l'investimento", async () => {
    const { tool, id } = await strumenti("completo");
    const out = await tool("piano_nel_tempo").run({ progetto_id: id });
    const percorsi = out.structured.percorsi as Percorso[];
    expect(percorsi.some((x) => x.etichetta === "Il tuo percorso")).toBe(false);
    expect(percorsi.some((x) => x.van_euro === -x.spesa_per_anno_euro.reduce((a, b) => a + b, 0))).toBe(false);
    expect(out.text).toMatch(/Il tuo percorso .* non si calcola/);
  });
});

describe("punto 2: «Inserisci il prezzo elettrico» anche con il prezzo dato", () => {
  it("voluto: il prezzo detto a voce entra, ma resta un'ipotesi da documentare", async () => {
    const { tool, id } = await strumenti("completo");
    const out = await tool("valuta_progetto").run({ progetto_id: id });
    expect(out.text).toMatch(/Spesa all'anno/);
    const { p } = casa("completo");
    expect(p.tariffs.elecPrice).toMatchObject({ value: 0.28, status: "ipotizzato" });
  });
});

describe("punto 3: autosufficienza con 2,5 kWp e 7,5 kWh", () => {
  it("resta sotto il limite di una batteria perfetta che sposta l'energia dentro lo stesso giorno", () => {
    const { p, climate, ev } = casa("fv");
    const base = ev.packages.find((r) => r.id === "base")!;
    const demand = packageSeries(p, climate, base).demand;
    const pv = pvProduction(climate, p.pv.plane, 2.5, p.pv.lossPct.value);
    const b = simulateBattery(demand, pv, { ...batteryParams(p), capacity_kWh: 7.5 }).balance;
    const motore = (b.demand_kWh - b.import_kWh) / b.demand_kWh;
    let giorno = 0;
    for (let d = 0; d < demand.length / 24; d++) {
      let c = 0, f = 0;
      for (let h = d * 24; h < d * 24 + 24; h++) { c += demand[h]; f += pv[h]; }
      giorno += Math.min(c, f) / 1000;
    }
    expect(motore).toBeLessThanOrEqual(giorno / b.demand_kWh);
    // I consumi sono 3.200 kWh della bolletta più gli split calcolati dal modello.
    expect(b.demand_kWh).toBeGreaterThan(3200);
  });
});

describe("punto 4: la curva di scrivi_profilo", () => {
  it("ha 864 valori medi (non 8.760) e, pesati con i giorni, sommano ai kWh dichiarati", async () => {
    const { tool, id } = await strumenti("fv");
    const out = await tool("scrivi_profilo").run({ progetto_id: id });
    const consumi = (out.structured.profilo as { scenari: { consumi: { kwh_annui: number; ore: number[] } }[] }).scenari[0].consumi;
    expect(consumi.ore).toHaveLength(CURVE_CELLS);
    const giorni = new Array<number>(CURVE_CELLS).fill(0);
    for (let h = 0; h < 8760; h++) giorni[curveCell(h)]++;
    expect(consumi.ore.reduce((s, v, i) => s + v * giorni[i], 0)).toBeCloseTo(consumi.kwh_annui, 0);
    expect(out.text).toMatch(/864 valori medi/);
  });
});

type Modifica = { campo: string; prima: number | null; dopo: number };
type Curva = { pacchetto: string; trovata: boolean; motivo?: string; scelta_del_modello: { fotovoltaico_kwp: number; batteria_kwh: number } };

describe("punto 5: prova_variante con la taglia indicativa", () => {
  it("come valore di partenza mostra la taglia scelta dal modello, non quella ereditata dall'esempio", async () => {
    const { tool, id } = await strumenti("fv");
    const out = await tool("prova_variante").run({ progetto_id: id, modifiche: [{ campo: "pv.kWp", valore: 6, motivo: "chiesto dall'utente" }, { campo: "battery.capacityKwh", valore: 5, motivo: "chiesto dall'utente" }] });
    const s = out.structured as { modifiche: Modifica[]; dalla_curva: Curva[] };
    const scelta = s.dalla_curva[0].scelta_del_modello;
    // Prima della correzione: 4 kWp e 5 kWh, i valori dell'esempio che il modello non usa.
    expect(s.modifiche.find((m) => m.campo === "pv.kWp")!.prima).toBe(scelta.fotovoltaico_kwp);
    expect(s.modifiche.find((m) => m.campo === "battery.capacityKwh")!.prima).toBe(scelta.batteria_kwh);
    expect(out.text).not.toMatch(/4 kWp → 6 kWp/);
    expect(out.text).toMatch(/scelta dal modello/);
  });

  it("se la taglia non è nella curva dice il motivo vero: qui la batteria non è nel progetto", async () => {
    const { tool, id } = await strumenti("completo");
    const out = await tool("prova_variante").run({ progetto_id: id, modifiche: [{ campo: "pv.kWp", valore: 6, motivo: "chiesto dall'utente" }, { campo: "battery.capacityKwh", valore: 5, motivo: "chiesto dall'utente" }] });
    const curva = (out.structured as { dalla_curva: Curva[] }).dalla_curva;
    expect(curva.every((x) => !x.trovata)).toBe(true);
    expect(curva.every((x) => /batteria/.test(x.motivo ?? ""))).toBe(true);
    expect(out.text).not.toMatch(/oltre il tetto o fuori dai passi/);
  });

  it("oltre il tetto lo dice con il massimo, e 6 kWp da soli si trovano", async () => {
    const { tool, id } = await strumenti("fv");
    const oltre = await tool("prova_variante").run({ progetto_id: id, modifiche: [{ campo: "pv.kWp", valore: 9, motivo: "chiesto dall'utente" }] });
    const c = (oltre.structured as { dalla_curva: Curva[] }).dalla_curva[0];
    expect(c.trovata).toBe(false);
    expect(c.motivo).toMatch(/tetto/);
    expect(c.motivo).toMatch(/7 kWp/);
    const sei = await tool("prova_variante").run({ progetto_id: id, modifiche: [{ campo: "pv.kWp", valore: 6, motivo: "chiesto dall'utente" }] });
    expect((sei.structured as { dalla_curva: Curva[] }).dalla_curva[0].trovata).toBe(true);
  });
});
