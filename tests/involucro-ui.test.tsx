import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { evaluationForGoal, GOALS, goalSections } from "../src/ui/goals";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const text = (el: JSX.Element) => renderToStaticMarkup(el).replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const form = (p: ProjectInput) => text(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);

describe("Interfaccia involucro", () => {
  it("mostra le scelte applicabili, riepilogo e scenari", () => {
    const p = exampleProject();
    let s = form(p);
    for (const label of ["Involucro: serramenti e isolamento", "Cambio i serramenti", "Cappotto", "Isolamento del sottotetto"]) expect(s).toContain(label);
    p.envelope.walls.enabled = true;
    p.economics.incentive.enabled = true;
    s = form(p);
    expect(s).toContain("U da 0,95 a 0,22 W/m²K su 182 m²");
    for (const [name, price] of [["basso", 110], ["centrale", 160], ["alto", 220]] as const) expect(s).toContain(`Scenario ${name} · ${price}`);
    expect(s).toContain("Involucro: quota della spesa");
    p.building.upper = "coperturaPiana"; p.building.lower = "terreno";
    s = form(p);
    expect(s).toContain("Isolamento del tetto");
    expect(s).not.toContain("Isolamento del sottotetto");
    expect(s).not.toContain("Isolamento del solaio");
    p.goal = "fv";
    s = form(p);
    expect(s).not.toContain("Involucro: serramenti e isolamento");
    expect(s).not.toContain("Cappotto");
    expect(goalSections("fv")).not.toContain("Isolamento");
    expect(GOALS.find((g) => g.id === "serramenti")!.question).toBe("Mi conviene cambiare i serramenti o isolare la casa?");
  });
  it("risultati e report mostrano il confronto solo con due parti e W visibile", () => {
    const p = exampleProject();
    const output = () => {
      const ev = evaluationForGoal(evaluate(p, climate), p.goal);
      return [text(<Results p={p} ev={ev} climate={climate} sens={null} />), text(<Report p={p} ev={ev} climate={climate} sens={null} />)];
    };
    for (const s of output()) expect(s).not.toContain("Quanto vale ogni lavoro sull'involucro");
    p.envelope.walls.enabled = true;
    const [results, report] = output();
    for (const s of [results, report]) {
      expect(s).toContain("Quanto vale ogni lavoro sull'involucro");
      expect(s).toContain("Tutto insieme");
      // riscaldamento continuo: i risparmi di serramenti e cappotto quasi si sommano
      expect(s).toContain("quasi quanto la somma dei lavori da soli");
      expect(s).toContain("Confronto prima della taratura sulla bolletta, con la caldaia: con la pompa di calore gli euro sono diversi.");
    }
    expect(report).toContain("Involucro");
    expect(report).toContain("cappotto 12 cm λ 0,035 su 182 m² (U da 0,95 a 0,22), ponti come oggi");
    expect(report).toContain("Costo stimato, non da preventivo: 160 €/m² su 182 m²");
    expect(report).toContain("umidità e condensa non verificate");
    p.goal = "fv";
    for (const s of output()) expect(s).not.toContain("Quanto vale ogni lavoro sull'involucro");
  });
});
