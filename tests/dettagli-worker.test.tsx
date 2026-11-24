import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { comparePower, compareTariffs, envelopeBreakdown, evaluate, exampleProject, resultDetails, type ProjectInput } from "../src/engine";
import { createEngineClient } from "../src/ui/engine-client";
import { DetailsContext } from "../src/ui/dettagli";
import { TariffeBlock } from "../src/ui/tariffe";
import { loadMilano } from "./helpers";

// Tappa C del piano dopo la 8: tariffe, lavori sull'involucro e beneficio dei pannelli con l'auto passano nel worker.
const climate = loadMilano();

function full(): ProjectInput {
  const p = exampleProject();
  p.ev.enabled = true;
  for (const kind of ["walls", "roof", "floor"] as const) p.envelope[kind].enabled = true;
  return p;
}

describe("dettagli dei Risultati nel worker", () => {
  it("sono gli stessi numeri del calcolo nella pagina", () => {
    const p = full();
    const ev = evaluate(p, climate);
    const d = resultDetails(p, climate, ev);
    const base = ev.packages.find((r) => r.id === "base")!;
    expect(Object.keys(d.tariffs)).toEqual(ev.packages.map((r) => r.id));
    for (const r of ev.packages) expect(d.tariffs[r.id]).toEqual(compareTariffs(p, climate, r));
    expect(d.power).toEqual(comparePower(p, climate, base));
    expect(d.envelope).toEqual(envelopeBreakdown(p, climate, ev));
    expect(d.envelope?.parts.length).toBe(4);
    // Il beneficio dei pannelli è la differenza fra due valutazioni, con e senza l'auto.
    const without = evaluate({ ...p, ev: { ...p.ev, enabled: false } }, climate);
    const withNpv = ev.packages.find((r) => r.id === "P")!.cash!.npv!;
    const withoutNpv = without.packages.find((r) => r.id === "P")!.cash!.npv!;
    expect(d.panelBenefit).toEqual({ withNpv, withoutNpv, added: withNpv - withoutNpv });
  });

  it("senza confronto delle tariffe, senza auto e senza isolamenti restano vuoti", () => {
    const p = exampleProject();
    p.tariffCompare = undefined;
    const d = resultDetails(p, climate, evaluate(p, climate));
    expect(d).toEqual({ envelope: null, tariffs: {}, power: null, panelBenefit: null });
  });

  it("arrivano identici attraverso il cliente del motore (ripiego senza Worker)", async () => {
    const p = full();
    const client = createEngineClient(() => null);
    client.climate(climate);
    const fromClient = await client.request("details", { project: p, climateId: p.climateId });
    expect(fromClient).toEqual(resultDetails(p, climate, evaluate(p, climate)));
    client.dispose();
  });

  it("il blocco delle tariffe mostra gli stessi numeri dal worker e calcolati nella pagina", () => {
    const p = exampleProject();
    const ev = evaluate(p, climate);
    const html = renderToStaticMarkup(<TariffeBlock p={p} climate={climate} ev={ev} />);
    const fromWorker = renderToStaticMarkup(<DetailsContext.Provider value={{ details: resultDetails(p, climate, ev) }}><TariffeBlock p={p} climate={climate} ev={ev} /></DetailsContext.Provider>);
    expect(html).toContain("Tariffe della luce");
    expect(fromWorker).toBe(html);
  });

  it("finché il worker non risponde la domanda sulle tariffe dice che sta calcolando", () => {
    const p = exampleProject();
    p.goal = "tariffa";
    const ev = evaluate(p, climate);
    const html = renderToStaticMarkup(<DetailsContext.Provider value={{ details: null }}><TariffeBlock p={p} climate={climate} ev={ev} /></DetailsContext.Provider>);
    expect(html).toContain('role="status"');
    expect(html).toContain("Sto calcolando il confronto delle tariffe");
  });
});
