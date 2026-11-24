import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, type Issue, type PackageResult, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { Results, technicalTitle } from "../src/ui/results";
import { loadMilano } from "./helpers";

// Proposte C e D della tappa E del piano dopo la 8, chieste da Samuele il 19/11/2026.
const climate = loadMilano();
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const results = (p: ProjectInput) => renderToStaticMarkup(<Results ev={evaluate(p, climate)} p={p} sens={null} climate={climate} />);
const form = (p: ProjectInput, issues: Issue[] = [], doc = false) => renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={doc} issues={issues} climate={climate} /></FormContext.Provider>);
/** Gruppi chiusi del passo Interventi: titolo e se sono aperti. */
const groups = (html: string) => [...html.matchAll(/<details class="section fold-block group"( open="")?><summary><span class="group-head"><h3>(?:<span[^>]*>.*?<\/span>)([^<]*)<\/h3>(?:<span class="small muted group-status">([^<]*)<\/span>)?/g)].map(([, open, title, status]) => ({ title, open: !!open, status }));

describe("C: dettaglio del pacchetto più corto", () => {
  it("i dati tecnici sono in un riquadro chiuso e i conti dell'anno restano visibili, due valori per riga", () => {
    const html = results(exampleProject());
    const detail = html.slice(html.indexOf("Dettaglio: "));
    const fold = detail.match(/<details class="fold"><summary>(Dati tecnici: [^<]*)<\/summary>([\s\S]*?)<\/details>/);
    expect(fold).not.toBeNull();
    expect(fold![1]).toMatch(/^Dati tecnici: pompa di calore/);
    expect(fold![2]).toContain("SCOP senza ausiliari");
    expect(detail).toMatch(/<h4>Conti dell&#x27;anno, voce per voce<\/h4><div class="table-wrap"><table class="data cards-sm cards-compact">/);
    expect(text(detail)).toContain("Totale (prima di cessione e manutenzione)");
  });

  it("il titolo nomina solo i dati che il pacchetto ha", () => {
    const r = (x: Partial<PackageResult>) => ({ coolingNotes: [], has: { P: false }, ...x }) as unknown as PackageResult;
    expect(technicalTitle(r({}))).toBeNull();
    expect(technicalTitle(r({ has: { P: true } } as Partial<PackageResult>))).toBe("Dati tecnici: fotovoltaico");
    expect(technicalTitle(r({ has: { P: true }, battery: {} } as Partial<PackageResult>))).toBe("Dati tecnici: fotovoltaico e batteria");
    expect(technicalTitle(r({ hp: {}, coolingNotes: ["x"], has: { P: true }, battery: {} } as Partial<PackageResult>))).toBe("Dati tecnici: pompa di calore, raffrescamento, fotovoltaico e batteria");
  });
});

describe("D: gruppi chiudibili nel passo Interventi", () => {
  it("nel quadro completo ogni gruppo è chiuso, con una riga che dice che cosa c'è dentro", () => {
    const p = exampleProject();
    p.goal = "completo";
    const html = form(p);
    expect(groups(html)).toEqual([
      { title: "Involucro: serramenti e isolamento", open: false, status: expect.stringMatching(/^Serramenti nuovi: sì · isolamento: (sì|no)$/) },
      { title: "Impianto: pompa di calore e acqua calda", open: false, status: expect.stringMatching(/^Pompa di calore: sì · scaldacqua nuovo: (sì|no)/) },
      { title: "Fotovoltaico", open: false, status: expect.stringMatching(/kWp$|^Taglia indicativa/) },
      { title: "Batteria (facoltativa)", open: false, status: expect.stringMatching(/^(Sì|No)/) },
      { title: "Parametri economici", open: false, status: expect.stringMatching(/^Orizzonte \d+ anni · incentivo: /) },
    ]);
    // I campi restano nella pagina: chiusi, non tolti. «Hai già un preventivo?» sta dentro il gruppo del FV.
    expect(html).toContain("Hai già un preventivo?");
    expect(html.indexOf("Hai già un preventivo?")).toBeGreaterThan(html.indexOf(">Fotovoltaico</h3>"));
    expect(html).toContain("Cambio i serramenti");
    expect(html).toContain("Piano nel tempo");
  });

  it("un gruppo con un errore è aperto; gli altri restano chiusi", () => {
    const p = exampleProject();
    p.goal = "completo";
    const error: Issue = { section: "Fotovoltaico", severity: "errore", message: "Il tetto indicato non basta." };
    const warning: Issue = { section: "Economia", severity: "esplorativo", message: "Orizzonte ipotizzato." };
    const open = groups(form(p, [error, warning])).filter((g) => g.open).map((g) => g.title);
    expect(open).toEqual(["Fotovoltaico", "Batteria (facoltativa)"]);
  });

  it("nelle domande su un solo intervento e in modalità documentata i gruppi restano aperti come prima", () => {
    for (const goal of ["pdc", "serramenti", "fv", "batteria"] as const) {
      const p = exampleProject();
      p.goal = goal;
      if (goal === "batteria") p.existingPv.present = true;
      const html = form(p);
      expect(groups(html), goal).toEqual([]);
      expect(html, goal).toMatch(/<div class="section"><h3><span class="section-icon"/);
    }
    const p = exampleProject();
    p.goal = "completo";
    p.mode = "documentata";
    expect(groups(form(p, [], true))).toEqual([]);
  });
});
