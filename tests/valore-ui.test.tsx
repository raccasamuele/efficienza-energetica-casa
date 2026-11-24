import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, q, type Evaluation, type Goal, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { evaluationForGoal } from "../src/ui/goals";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const text = (el: JSX.Element) => renderToStaticMarkup(el).replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const form = (p: ProjectInput) => text(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
const outputs = (p: ProjectInput, ev: Evaluation = evaluationForGoal(evaluate(p, climate), p.goal)) => [text(<Results p={p} ev={ev} climate={climate} sens={null} />), text(<Report p={p} ev={ev} climate={climate} sens={null} />)];

describe("Scenario del valore della casa nell'interfaccia", () => {
  it("è disponibile in tutti i percorsi e chiede classe e valore solo se acceso", () => {
    const p = exampleProject();
    for (const goal of ["completo", "fv", "batteria", "pdc", "serramenti"] as Goal[]) {
      p.goal = goal;
      expect(form(p)).toContain("Prova uno scenario con il valore della casa");
    }
    expect(form(p)).not.toContain("Classe energetica di oggi (dall'APE)");
    p.economics.homeValue.enabled = true;
    const s = form(p);
    for (const label of ["Classe energetica di oggi (dall'APE)", "Valore di mercato della casa oggi", "Non lo so (ipotesi: F)", "Una stima tua o di un'agenzia: il programma non conosce i prezzi delle case. Senza valore vedi solo le percentuali."]) expect(s).toContain(label);
    expect(s).toContain("è un'indicazione, non una perizia né un APE. Il confronto principale non cambia.");
  });
  it("risultati e report: tabella separata, fonte, ipotesi F e invito a inserire il valore", () => {
    const p = exampleProject();
    for (const s of outputs(p)) expect(s).not.toContain("Se un giorno vendi: valore della casa");
    p.economics.homeValue.enabled = true;
    for (const s of outputs(p)) {
      expect(s).toContain("Se un giorno vendi: valore della casa");
      expect(s).toContain("VAN con il valore della casa");
      expect(s).toContain("Stima indicativa, non una perizia né un APE.");
      expect(s).toContain("Banca d'Italia");
      expect(s).toContain("Classe di oggi non indicata: ipotesi F, una delle più frequenti fra le case in vendita.");
      expect(s).toContain("Indica il valore di mercato della casa nel passo Interventi per vedere gli euro.");
      expect(s).toContain("alla fine dei 20 anni");
    }
    p.economics.homeValue.energyClass = "E";
    p.economics.homeValue.marketValue = q(300000);
    for (const s of outputs(p)) {
      expect(s).not.toContain("Classe di oggi non indicata");
      expect(s).not.toContain("Indica il valore di mercato della casa nel passo Interventi");
      expect(s).toContain("E →");
    }
  });
  it("mostra la nota al posto della tabella e colloca il blocco dopo l'incentivo", () => {
    const p = exampleProject(); p.economics.homeValue.enabled = true;
    Object.assign(p.economics.incentive, { enabled: true, source: "Regola", date: "2026-11-05" }); p.economics.incentive.windowsPct = q(50);
    for (const s of outputs(p)) expect(s.indexOf("Se un giorno vendi: valore della casa")).toBeGreaterThan(s.indexOf("Con un incentivo"));
    const note = "Senza riscaldamento a gas o elettrico nel modello non si può stimare la classe dopo i lavori.";
    const ev = { ...evaluate(p, climate), homeValue: null, homeValueNote: note };
    for (const s of outputs(p, ev)) {
      expect(s).toContain(note);
      expect(s).not.toContain("VAN con il valore della casa");
    }
  });
});
