import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, type Issue, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { BuildingForm, LocationForm } from "../src/ui/forms";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { plainClimateText } from "../src/ui/testi-clima";
import { loadMilano } from "./helpers";

// Proposte A, B, E della tappa E del piano dopo la 8, scelte da Samuele il 19/11/2026.
const climate = loadMilano();
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const results = (p: ProjectInput) => renderToStaticMarkup(<Results ev={evaluate(p, climate)} p={p} sens={null} climate={climate} />);
const report = (p: ProjectInput) => renderToStaticMarkup(<Report ev={evaluate(p, climate)} p={p} sens={null} climate={climate} />);
/** Il riquadro chiuso con il titolo dato, se c'è. */
const folded = (html: string, title: string) => new RegExp(`<details class="fold fold-block"><summary><h3>${title.replace(/[?]/g, "\\?")}</h3></summary>`).test(html);

describe("A: tariffe e «Dove finisce la spesa?» chiusi fuori dalla loro domanda", () => {
  it("nel quadro completo sono chiusi sotto il titolo, con il contenuto intatto", () => {
    const p = exampleProject();
    p.goal = "completo";
    const html = results(p);
    expect(folded(html, "Tariffe della luce")).toBe(true);
    expect(folded(html, "Dove finisce la spesa?")).toBe(true);
    expect(html).toContain("Energia e oneri");
    // «Con i consumi della bolletta» resta aperto nello stesso riquadro.
    expect(html).not.toMatch(/<summary><h3>Con i consumi della bolletta/);
  });

  it("nella domanda sulle tariffe e nel Report restano aperti", () => {
    const p = exampleProject();
    p.goal = "tariffa";
    const html = results(p);
    expect(html).toContain("<h3>Tariffe della luce</h3>");
    expect(folded(html, "Tariffe della luce")).toBe(false);
    expect(folded(html, "Dove finisce la spesa?")).toBe(false);
    p.goal = "completo";
    const doc = report(p);
    expect(doc).toContain("<h3>Tariffe della luce</h3>");
    expect(doc).not.toContain("fold-block");
  });
});

describe("B: ogni errore una volta sola nel passo", () => {
  const error: Issue = { section: "Edificio", severity: "errore", message: "U pareti: fuori intervallo." };
  const warning: Issue = { section: "Edificio", severity: "esplorativo", message: "U pareti: valore ipotizzato." };
  const building = (issues: Issue[]) => {
    const p = exampleProject();
    return renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><BuildingForm p={p} up={() => {}} doc={false} issues={issues} /></FormContext.Provider>);
  };

  it("in cima al passo l'errore, in fondo solo gli avvisi e il rimando", () => {
    const html = building([error, warning]);
    expect(html.split("U pareti: fuori intervallo.").length - 1).toBe(1);
    expect(html.indexOf("U pareti: fuori intervallo.")).toBeLessThan(html.indexOf("C&#x27;è un errore da correggere: <a href=\"#riepilogo-errori\" data-section=\"Edificio\">è in cima al passo</a>."));
    expect(html).toContain("Dati da misurare o documentare (1)");
    expect(html.match(/<details class="issue-summary"/g)).toHaveLength(2);
  });

  it("senza avvisi in fondo resta solo il rimando; senza errori nessun rimando", () => {
    const only = building([error, { ...error, message: "U tetto: fuori intervallo." }]);
    expect(text(only)).toContain("Ci sono 2 errori da correggere: sono in cima al passo .");
    expect(only).not.toContain("Nessun problema segnalato");
    const none = building([warning]);
    expect(none).not.toContain("in cima al passo");
  });

  it("dove il passo non ha errori in cima (Località) il riepilogo li mostra ancora", () => {
    const p = exampleProject();
    const issue: Issue = { section: "Località", severity: "errore", message: "Comune non trovato." };
    const html = renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><LocationForm p={p} up={() => {}} doc={false} issues={[issue]} climate={null} index={null} comuni={null} comuniError={null} setProject={() => {}} /></FormContext.Provider>);
    expect(html).toContain("Comune non trovato.");
    expect(html).not.toContain("in cima al passo");
  });
});

describe("E: testi dei pacchetti clima con parole semplici", () => {
  const forbidden = /\bTMY\b|esplorativ/i;

  it("nessun pacchetto clima mostra «TMY» o «scelta esplorativa» dopo la traduzione", () => {
    const dir = resolve(__dirname, "../public/data/packages");
    let seen = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const m = JSON.parse(readFileSync(resolve(dir, file), "utf-8")).manifest;
      if (!m) continue;
      for (const t of [m.note, m.attribution, ...m.transformations] as string[]) {
        if (forbidden.test(t)) seen++;
        expect(plainClimateText(t), file).not.toMatch(forbidden);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  it("le frasi tradotte restano corrette e l'attribuzione dei dati resta", () => {
    expect(plainClimateText(climate.manifest.note)).toBe("Modello pvlib alimentato da anno tipico di PVGIS, non produzione calcolata dal servizio FV di PVGIS. L'anno tipico rappresenta condizioni tipiche, non un anno futuro né gli estremi di progetto.");
    expect(plainClimateText(climate.manifest.attribution)).toContain("PVGIS © Unione Europea, JRC (anno tipico, PVGIS 5.3)");
    expect(plainClimateText("vento: 2 ore con valori negativi del TMY (≥ −3 m/s) portate a 0")).toBe("vento: 2 ore con valori negativi dell'anno tipico (≥ −3 m/s) portate a 0");
    expect(climate.manifest.transformations.map(plainClimateText).join(" ")).toContain("valore indicativo arrotondato a 0,5 °C");
  });

  it("il Report non mostra più «TMY» né «scelta esplorativa»", () => {
    const doc = text(report(exampleProject()));
    expect(doc).toContain("anno tipico");
    expect(doc).not.toMatch(forbidden);
  });
});
