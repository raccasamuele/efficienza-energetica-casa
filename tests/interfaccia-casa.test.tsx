import { Children, isValidElement, type ReactElement, type ReactNode, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, runSensitivity, type Q } from "../src/engine";
import App from "../src/App";
import { BuildingForm, SystemForm, ConsumptionForm } from "../src/ui/forms";
import { InterventionsForm } from "../src/ui/interventions";
import { Check, FormContext, NumberInput, QField } from "../src/ui/fields";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { SensitivityView } from "../src/ui/sensitivity";
import { loadMilano } from "./helpers";

function elements(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => isValidElement<{ children?: ReactNode }>(child) ? [child, ...elements(child.props.children)] : []);
}
function field(q: Q, doc = false, allowUnknown = true) {
  let tree: ReactNode;
  let result = q;
  function Probe() {
    tree = QField({ label: "Dato", q, onChange: (value) => { result = value; }, showSource: doc, allowUnknown });
    return tree;
  }
  const html = renderToStaticMarkup(<Probe />);
  const nodes = elements(tree);
  return {
    html,
    value: () => result,
    input: (nodes.find((node) => node.type === NumberInput) as ReactElement<ComponentProps<typeof NumberInput>>).props,
    check: (nodes.find((node) => node.type === Check) as ReactElement<ComponentProps<typeof Check>> | undefined)?.props,
  };
}

describe("Tappa 4: Casa", () => {
  it("mostra Casa nell'intestazione e nel titolo HTML", () => {
    expect(renderToStaticMarkup(<App />)).toContain("<strong>Casa</strong>");
    expect(readFileSync("index.html", "utf8")).toContain("<title>Casa — confronto degli interventi energetici</title>");
  });
  it("in Rapida nasconde tutti i menu dello stato nei quattro passi; in Documentata li conserva", () => {
    const p = exampleProject();
    for (const Form of [BuildingForm, SystemForm, ConsumptionForm, InterventionsForm]) {
      const render = (doc: boolean) => renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><Form p={p} up={() => {}} doc={doc} issues={[]} /></FormContext.Provider>);
      p.mode = "documentata";
      const before = structuredClone(p);
      const documented = render(true);
      expect(documented.match(/class="status"/g)!.length).toBeGreaterThan(0);
      p.mode = "rapida";
      const quick = render(false);
      expect(quick).not.toContain('class="status"');
      expect(quick).toContain("Non lo so");
      p.mode = "documentata";
      expect(render(true)).toBe(documented);
      expect(p).toEqual(before);
    }
  });
  it("Non lo so imposta e toglie sconosciuto, senza cambiare valore o fonte", () => {
    const q: Q = { value: 120, status: "documentato", source: "Rilievo", confirmed: true };
    const first = field(q);
    first.check!.onChange(true);
    expect(first.value()).toEqual({ ...q, status: "sconosciuto", confirmed: false });
    const second = field(first.value());
    expect(second.check!.checked).toBe(true);
    expect(second.html).toContain("st-sconosciuto");
    second.check!.onChange(false);
    expect(second.value()).toEqual({ ...q, status: "ipotizzato", confirmed: false });
    expect(field(q, false, false).check).toBeUndefined();
    expect(field(q, true).check).toBeUndefined();
  });
  it("scrivere in Rapida conserva documentato e misurato anche con una fonte ereditata", () => {
    for (const status of ["documentato", "misurato", "ipotizzato", "sconosciuto"] as const) {
      const f = field({ value: 120, status, source: "Esempio ereditato", confirmed: true });
      f.input.onChange(150);
      expect(f.value().status).toBe(status === "sconosciuto" ? "ipotizzato" : status);
      expect(f.value().value).toBe(150);
      expect(f.value().confirmed).toBe(false);
    }
  });
  it("i testi UI di Risultati, Sensibilità e Report non mostrano V1, TMY o dominio", () => {
    const p = exampleProject();
    const climate = loadMilano();
    const ev = evaluate(p, climate);
    const sens = runSensitivity(p, climate, ev);
    const report = renderToStaticMarkup(<Report p={p} ev={ev} climate={climate} sens={sens} />);
    expect(report).toContain("Casa — confronto preliminare degli interventi energetici");
    const forbidden = /\bV1\b|\bTMY\b|\bdominio\b/i;
    const renderedTexts = [renderToStaticMarkup(<Results p={p} ev={ev} climate={climate} sens={sens} />), renderToStaticMarkup(<SensitivityView p={p} sens={sens} running={false} />), report].map((html) => html.replace(/<[^>]*>/g, ""));
    // La parte D esclude i messaggi del motore, che saranno trattati in una tappa futura.
    const engineTexts = [...new Set([
      ...ev.packages.flatMap((r) => [...r.services.map((s) => s.generator), ...r.blockers, ...r.conditions]),
      ...ev.issues.map((i) => i.message),
      climate.manifest.note, climate.manifest.attribution, ...climate.manifest.transformations,
    ].filter((text) => forbidden.test(text)).map((text) => renderToStaticMarkup(<span>{text}</span>).replace(/<[^>]*>/g, "")))]
      .filter((text) => renderedTexts.some((rendered) => rendered.includes(text)));
    // Dalla tappa B (messaggi del motore) e dalla proposta E della tappa E (testi del clima) non resta nessuna eccezione.
    expect(engineTexts).toEqual([]);
    for (const rendered of renderedTexts) {
      const text = engineTexts.reduce((remaining, exact) => remaining.split(exact).join(""), rendered);
      expect(text).not.toMatch(forbidden);
      expect(text).toMatch(/Guadagno.*anni \(VAN\)/);
    }
  }, 120000);
});
