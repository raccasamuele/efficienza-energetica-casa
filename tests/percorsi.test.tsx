// Percorsi «Cosa vuoi verificare?»: passi e pacchetti per domanda, dati nascosti, prima schermata, file.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, parseProjectFile, runSensitivity, toProjectFile, type Evaluation, type Goal, type PackageId, type ProjectInput } from "../src/engine";
import { Entry } from "../src/App";
import { GOALS, evaluationForGoal, goalSections, goalSteps } from "../src/ui/goals";
import { nextActions, startProject } from "../src/ui/journey";
import { InterventionsForm } from "../src/ui/interventions";
import { ConsumptionForm } from "../src/ui/forms";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { FormContext } from "../src/ui/fields";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function forGoal(g: Goal): ProjectInput {
  return startProject("rapida", true, g);
}

/** Cambia tutto ciò che il percorso FV non chiede: casa, finestre, impianto, gas, PDC e serramenti. */
function changeHiddenForPv(p: ProjectInput) {
  const b = p.building;
  b.uWall.value *= 1.8;
  b.uUpper.value *= 0.5;
  b.uWindow.value = 4.9;
  b.gWindow.value = 0.85;
  b.floorArea.value = 180;
  b.airChange.value = 0.8;
  p.system.boilerEfficiency.value = 0.75;
  p.service.setpoint.value = 21;
  p.consumption.gasSmcObserved.value = 2500;
  p.tariffs.gasPrice.value = 1.6;
  p.windows.uWindow.value = 1.0;
  p.heatPump.copFactor.value = 0.8;
}

describe("Domande: passi e pacchetti", () => {
  it("cinque domande, il quadro completo mostra tutto come oggi", () => {
    expect(GOALS.map((g) => g.id)).toEqual(["fv", "batteria", "pdc", "serramenti", "tariffa", "completo"]);
    expect(goalSteps("completo")).toEqual(["localita", "edificio", "impianto", "consumi", "interventi", "risultati", "sensibilita", "report"]);
    expect(goalSteps("fv")).toEqual(["localita", "consumi", "interventi", "risultati", "sensibilita", "report"]);
    expect(goalSteps("batteria")).toEqual(goalSteps("fv"));
    expect(goalSections("fv")).not.toContain("Edificio");
    expect(goalSections("pdc")).toContain("Pompa di calore");
    expect(goalSections("pdc")).not.toContain("Fotovoltaico");
  });

  it("i risultati della domanda tengono solo i pacchetti pertinenti, con gli stessi numeri", () => {
    const ev = evaluate(forGoal("fv"), milano);
    const shown = evaluationForGoal(ev, "fv");
    expect(shown.packages.map((r) => r.id)).toEqual(["base", "P"]);
    expect(pk(shown, "P")).toBe(pk(ev, "P"));
    expect(evaluationForGoal(ev, "pdc").packages.map((r) => r.id)).toEqual(["base", "H"]);
    expect(evaluationForGoal(ev, "serramenti").packages.map((r) => r.id)).toEqual(["base", "W"]);
    expect(evaluationForGoal(ev, "completo").packages).toHaveLength(8);
  });

  it("la sensibilità cerca il migliore solo fra i pacchetti della domanda", () => {
    const p = forGoal("pdc");
    const ev = evaluate(p, milano);
    const sens = runSensitivity(p, milano, ev, ["base", "H"]);
    expect([null, "H"]).toContain(sens.nominalBest);
    for (const v of sens.variants) expect([null, "H"]).toContain(v.best);
  });

  it("partire da una domanda imposta FV esistente o batteria accanto al FV nuovo", () => {
    expect(forGoal("batteria").existingPv.present).toBe(true);
    expect(forGoal("fv").battery.enabled).toBe(true);
    expect(forGoal("fv").existingPv.present).toBe(false);
    expect(forGoal("completo").battery.enabled).toBe(false);
    expect(startProject("rapida", false, "pdc").goal).toBe("pdc");
  });

  it("le prossime azioni indicano solo dati dei passi mostrati", () => {
    const p = startProject("rapida", false, "fv");
    const paths = nextActions(p).map((a) => a.path);
    expect(paths.some((x) => x.startsWith("building.") || x.startsWith("system.") || x.startsWith("heatPump") || x.startsWith("windows"))).toBe(false);
  });
});

describe("I dati nascosti non cambiano la risposta", () => {
  it("FV: casa, finestre e caldaia non spostano il VAN del FV né quello della batteria, senza condizionatori", () => {
    const a = forGoal("fv");
    const b = forGoal("fv");
    changeHiddenForPv(b);
    const ea = pk(evaluate(a, milano), "P");
    const eb = pk(evaluate(b, milano), "P");
    expect(eb.cash!.npv).toBeCloseTo(ea.cash!.npv, 6);
    expect(eb.battery!.npvBattery!).toBeCloseTo(ea.battery!.npvBattery!, 6);
    expect(eb.battery!.without.npv!).toBeCloseTo(ea.battery!.without.npv!, 6);
    // la situazione attuale invece cambia: il dato nascosto è usato, ma non per questa risposta
    expect(pk(evaluate(b, milano), "base").gasSmc).not.toBeCloseTo(pk(evaluate(a, milano), "base").gasSmc, 0);
  });

  it("batteria sul FV esistente: lo stesso", () => {
    const a = forGoal("batteria");
    const b = forGoal("batteria");
    changeHiddenForPv(b);
    expect(pk(evaluate(b, milano), "P").cash!.npv).toBeCloseTo(pk(evaluate(a, milano), "P").cash!.npv, 6);
  });

  it("con i condizionatori la casa conta: per questo il percorso fa una domanda in più", () => {
    const a = forGoal("fv");
    a.cooling.today = "split";
    const b = structuredClone(a);
    changeHiddenForPv(b);
    expect(pk(evaluate(b, milano), "P").cash!.npv).not.toBeCloseTo(pk(evaluate(a, milano), "P").cash!.npv, 0);
  });

  it("PDC e serramenti: FV e batteria nascosti non cambiano la loro risposta", () => {
    for (const [g, id] of [["pdc", "H"], ["serramenti", "W"]] as const) {
      const a = forGoal(g);
      const b = forGoal(g);
      b.pv.kWp.value = 9;
      b.battery.enabled = true;
      b.battery.capacityKwh.value = 20;
      b.tariffs.exportPrice.value = 0.3;
      expect(pk(evaluate(b, milano), id).cash!.npv).toBeCloseTo(pk(evaluate(a, milano), id).cash!.npv, 6);
    }
  });
});

describe("Prima schermata", () => {
  const s = renderToStaticMarkup(<Entry goal="completo" onGoal={() => {}} mode="rapida" onStart={() => {}} onImport={() => {}} />);
  it("mostra le cinque domande con i dati che servono e il numero di passi, senza tempi", () => {
    for (const g of GOALS) expect(text(s)).toContain(g.question);
    expect(text(s)).toContain("Serve: bolletta della luce, tetto, preventivo · 3 passi di dati");
    expect(text(s)).toContain("5 passi di dati");
    expect(text(s)).not.toMatch(/minut|secondi|\bore\b/i);
    expect(s).not.toContain("https://cer.raccasamuele.it");
  });
  it("Rapida e Documentata arrivano dopo la scelta della domanda", () => {
    expect(text(s)).not.toContain("Come vuoi inserire i dati?");
    expect(text(s)).not.toContain("Importa un progetto o un profilo");
    const old = renderToStaticMarkup(<Entry mode="rapida" onStart={() => {}} />);
    expect(text(old)).toContain("Come vuoi inserire i dati?");
  });
});

describe("Moduli e risultati per domanda", () => {
  const ui = (p: ProjectInput, el: JSX.Element) => text(renderToStaticMarkup(<FormContext.Provider value={{ project: p }}>{el}</FormContext.Provider>));
  it("percorso FV: interventi solo FV e batteria; consumi con la domanda sui condizionatori", () => {
    const p = forGoal("fv");
    const s = ui(p, <InterventionsForm p={p} up={() => {}} doc={false} issues={[]} />);
    expect(s).toContain("Fotovoltaico");
    expect(s).toContain("Batteria (facoltativa)");
    expect(s).not.toContain("Serramenti nuovi");
    expect(s).not.toContain("Pompa di calore (solo riscaldamento)");
    const c = ui(p, <ConsumptionForm p={p} up={() => {}} doc={false} issues={[]} />);
    expect(c).toContain("D'estate usi i condizionatori?");
    expect(c).not.toContain("Gas totale in bolletta");
  });
  it("percorso batteria: FV esistente nei consumi, niente FV nuovo negli interventi", () => {
    const p = forGoal("batteria");
    const c = ui(p, <ConsumptionForm p={p} up={() => {}} doc={false} issues={[]} />);
    expect(c).toContain("Fotovoltaico già installato");
    expect(c).not.toContain("La casa ha già un impianto fotovoltaico");
    const s = ui(p, <InterventionsForm p={p} up={() => {}} doc={false} issues={[]} />);
    expect(s).toContain("Batteria per il fotovoltaico che hai già");
    expect(s).not.toMatch(/Sostituzioni previste FV/);
  });
  it("risultati e report del FV dicono il verdetto della batteria e il limite orario", () => {
    const p = forGoal("fv");
    const ev = evaluationForGoal(evaluate(p, milano), "fv");
    const r = text(renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={milano} />));
    expect(r).toContain("La batteria da sola");
    expect(r).toMatch(/conviene il fotovoltaico senza batteria|Convengono sia|non conviene né|con la batteria sì/);
    expect(r).toContain("dentro l'ora non si vedono");
    const rep = text(renderToStaticMarkup(<Report p={p} ev={ev} climate={milano} sens={null} />));
    expect(rep).toContain("Domanda: Mi conviene il fotovoltaico, con o senza batteria?");
    expect(rep).toContain("Costi batteria");
    expect(rep).not.toContain("Costi pompa di calore");
    expect(rep).toContain("Tesla Powerwall 2");
  });
});

describe("Salvataggio della domanda", () => {
  it("il file e la bozza ricordano la domanda; un file senza domanda si apre come quadro completo", () => {
    const p = forGoal("pdc");
    const back = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano);
    expect(back.file!.input.goal).toBe("pdc");
    const draft = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: "0.3.0", input: { ...exampleProject(), goal: undefined } }), null, undefined, { draft: true });
    expect(draft.file!.input.goal).toBe("completo");
    expect(draft.warnings.join(" ")).not.toContain("Campi assenti");
  });
});
