import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, q } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { ConsumptionForm } from "../src/ui/forms";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { loadMilano } from "./helpers";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { EvFields } from "../src/ui/auto";
import { Check, QField, SelectField } from "../src/ui/fields";
const text = (el: JSX.Element) => renderToStaticMarkup(el).replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
describe("Auto elettrica nell'interfaccia", () => {
  it("azioni reali dei campi: accensione e importi scritti conservati al cambio di presa", () => {
    const p = exampleProject();
    const nodes = (node: ReactNode): ReactElement[] => isValidElement(node) ? [node, ...Children.toArray(node.props.children).flatMap(nodes)] : [];
    const controls = () => nodes(EvFields({ p, up: (change) => { change(p); }, doc: false }));
    controls().find((n) => n.type === Check)!.props.onChange(true);
    expect(p.ev.enabled).toBe(true);
    expect(controls().some((n) => n.type === QField && n.props.path === "ev.kmYear")).toBe(true);
    controls().find((n) => n.type === QField && n.props.path === "ev.price")!.props.onChange({ ...p.ev.price, value: 2345 });
    controls().find((n) => n.type === SelectField && n.props.label === "Come ricarichi a casa")!.props.onChange("presa");
    expect(p.ev.price.value).toBeCloseTo(2345, 6);
    expect(p.ev.chargerKw.value).toBeCloseTo(3.7, 6);
  });
  it("nei consumi: interruttore, campi accesi e ipotesi visibili", () => {
    const p = exampleProject();
    const form = () => text(<FormContext.Provider value={{ project: p }}><ConsumptionForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
    expect(form()).toContain("In famiglia");
    expect(form()).not.toContain("Chilometri all'anno");
    p.ev.enabled = true;
    for (const s of ["Chilometri all'anno", "Le fasce orarie arrivano con la tappa 7", "Scenario basso", "Scenario centrale", "Scenario alto", "Non lo so"]) expect(form()).toContain(s);
  });
  it("risultati e report: tre strategie, scelta, sintesi e costi separati", () => {
    const p = exampleProject(); p.ev.enabled = true;
    const climate = loadMilano(), ev = evaluate(p, climate);
    for (const s of [text(<Results p={p} ev={ev} climate={climate} sens={null} />), text(<Report p={p} ev={ev} climate={climate} sens={null} />)]) {
      for (const label of ["Auto elettrica", "Appena arriva a casa", "Di notte", "Col sole del FV con un minimo garantito", "Con il FV, caricare col sole costa", "appena arrivi", "Usata nei pacchetti", "carburante", "Investimento della ricarica"]) expect(s).toContain(label);
    }
  });
  it("confronto carburante: descrive un costo maggiore senza attribuire un risparmio", () => {
    const p = exampleProject(); p.ev.enabled = true;
    p.ev.fuelL100 = q(2); p.ev.fuelPrice = q(0.5);
    const climate = loadMilano(), ev = evaluate(p, climate);
    const result = text(<Results p={p} ev={ev} climate={climate} sens={null} />);
    expect(result).toContain("l'elettrica costa");
    expect(result).toContain("in pi\u00f9");
  });
});
