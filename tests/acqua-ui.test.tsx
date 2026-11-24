import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { SystemForm } from "../src/ui/forms";
import { InterventionsForm } from "../src/ui/interventions";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { evaluationForGoal, goalSections, GOALS } from "../src/ui/goals";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const text = (el: JSX.Element) => renderToStaticMarkup(el).replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const form = (p: ProjectInput, system = false) => text(<FormContext.Provider value={{ project: p }}>{system ? <SystemForm p={p} up={() => {}} doc={false} issues={[]} /> : <InterventionsForm p={p} up={() => {}} doc={false} issues={[]} />}</FormContext.Provider>);

describe("Acqua calda nell'interfaccia", () => {
  it("Impianto: gas, boiler e dati del fabbisogno", () => {
    const p = exampleProject();
    expect(form(p, true)).toContain("Acqua calda e cucina");
    p.system.acsOnGas = false;
    expect(form(p, true)).toContain("Acqua calda con un boiler elettrico (è già nei consumi della luce)");
    p.dhw.todayElectric = true;
    const s = form(p, true);
    expect(s).toContain("Persone in casa");
    expect(s).toContain("35 poco, 50 medio, 75 molto");
  });
  it("Interventi: impianto a livelli, scaldacqua e scenari", () => {
    const p = exampleProject(); let s = form(p);
    for (const label of ["Impianto: pompa di calore e acqua calda", "Pompa di calore per il riscaldamento", "Scaldacqua nuovo"]) expect(s).toContain(label);
    p.dhw.replace = true; p.economics.incentive.enabled = true; s = form(p);
    for (const label of ["Acqua calda all'anno", "dal gas di oggi", "Scenario basso", "Scenario centrale", "Scenario alto", "COP della scheda (EN 16147)", "Impianto: quota della spesa"]) expect(s).toContain(label);
    p.heatPump.included = false;
    expect(form(p)).not.toContain("Pompa di calore (solo riscaldamento)");
    expect(GOALS.find((g) => g.id === "pdc")!.question).toBe("Mi conviene la pompa di calore, per il riscaldamento o l'acqua calda?");
    expect(goalSections("pdc")).toContain("Acqua calda"); expect(goalSections("fv")).not.toContain("Acqua calda");
  });
  it("risultati e report: tabella con FV, fonte del fabbisogno e limiti", () => {
    const p = exampleProject(); p.dhw.replace = true; p.dhw.todayElectric = true; p.system.acsOnGas = false;
    const output = () => {
      const ev = evaluationForGoal(evaluate(p, climate), p.goal);
      return [text(<Results p={p} ev={ev} climate={climate} sens={null} />), text(<Report p={p} ev={ev} climate={climate} sens={null} />)];
    };
    for (const s of output()) {
      for (const label of ["Acqua calda", "Dal fotovoltaico", "Ore sotto 40 °C", "Boiler elettrico di oggi", "Acqua fredda a", "3 persone", "niente stratificazione"]) expect(s).toContain(label);
    }
    p.goal = "serramenti"; p.dhw.todayElectric = false; p.system.acsOnGas = true;
    for (const s of output()) expect(s).not.toContain("Dal fotovoltaico");
  });
  it("solare termico: campi, integrazione a gas solo con l'acqua calda a gas, colonne e limiti", () => {
    const p = exampleProject(); p.dhw.replace = true; p.dhw.newType = "solare";
    let s = form(p);
    for (const label of ["Solare termico", "Superficie dei pannelli", "Pannelli rivolti a", "Sud, inclinati 35°", "Caldaia a gas di oggi", "Resistenza elettrica", "Prezzo del solare termico (stima)", "Scenario centrale", "fino a 80 °C"]) expect(s).toContain(label);
    expect(s).not.toContain("COP della scheda");
    p.dhw.solarBackup = "gas"; s = form(p);
    expect(s).toContain("la caldaia di oggi tiene l'acqua a 45 °C");
    p.system.acsOnGas = false; p.dhw.todayElectric = true; p.dhw.solarBackup = "elettrico";
    expect(form(p)).not.toContain("Caldaia a gas di oggi");
    p.system.acsOnGas = true; p.dhw.todayElectric = false; p.dhw.solarBackup = "gas";
    const ev = evaluationForGoal(evaluate(p, climate), p.goal);
    for (const out of [text(<Results p={p} ev={ev} climate={climate} sens={null} />), text(<Report p={p} ev={ev} climate={climate} sens={null} />)])
      for (const label of ["Dal sole (pannelli)", "Gas d'integrazione", "Smc", "correlazione di Erbs", "integrazione con la caldaia a gas"]) expect(out).toContain(label);
  });
});
