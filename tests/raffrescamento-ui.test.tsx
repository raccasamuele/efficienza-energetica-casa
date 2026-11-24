import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { SystemForm } from "../src/ui/forms";
import { QuickSystemSummer } from "../src/ui/quick";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { coolingProject, loadMilano } from "./helpers";

const milano = loadMilano();
const html = renderToStaticMarkup;

describe("Raffrescamento — interfaccia e report", () => {
  it("Rapida chiede raffrescamento, terminali e schermature", () => {
    const s = html(<QuickSystemSummer p={exampleProject()} up={() => {}} />);
    for (const t of ["D&#x27;estate raffreschi la casa?", "Che terminali ha l&#x27;impianto?", "tende o persiane esterne"]) expect(s).toContain(t);
  });

  it("Documentata espone i dati estivi con fonte, Rapida li tiene nelle ipotesi tecniche", () => {
    const p = coolingProject();
    const doc = html(<FormContext.Provider value={{ project: p }}><SystemForm p={p} up={() => {}} doc issues={[]} /></FormContext.Provider>);
    for (const t of ["EER degli split a 35 °C", "Potenza degli split", "Differenza massima con l&#x27;esterno", "Terminali dell&#x27;impianto"]) expect(doc).toContain(t);
    const quick = html(<FormContext.Provider value={{ project: p }}><SystemForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
    expect(quick).toContain("D&#x27;estate raffreschi la casa?");
    expect(quick).toContain("Vedi le ipotesi tecniche");
  });

  it("i risultati mostrano il raffrescamento a chi raffresca e la nota a chi no", () => {
    const p = coolingProject();
    const s = html(<Results ev={evaluate(p, milano)} p={p} sens={null} climate={milano} />);
    expect(s).toContain("Raffrescamento");
    expect(s).toContain("Fabbisogno di raffrescamento");
    expect(s).not.toContain("NaN");
    const q = exampleProject();
    const t = html(<Results ev={evaluate(q, milano)} p={q} sens={null} climate={milano} />);
    expect(t).toContain("non conteggiato perché la casa non è raffrescata");
    expect(t).not.toContain("NaN");
  });

  it("il report non dice più che il raffrescamento non è modellato", () => {
    const p = coolingProject();
    const s = html(<Report p={p} ev={evaluate(p, milano)} climate={milano} sens={null} />);
    expect(s).not.toMatch(/raffrescamento non modellato/i);
    expect(s).toContain("umidità");
    expect(s).toContain("Temperatura estiva in casa");
  });
});
