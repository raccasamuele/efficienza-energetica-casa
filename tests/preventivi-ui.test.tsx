// Più preventivi nell'interfaccia: passo Interventi, risultati e report.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addQuote, compareQuotes, evaluate, exampleProject, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { InterventionsForm } from "../src/ui/interventions";
import { startProject } from "../src/ui/journey";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const form = (p: ProjectInput) => text(renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>));
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("Passo Interventi: altri preventivi", () => {
  it("ogni intervento del quadro completo ha «Altri preventivi» e il pulsante per aggiungerne", () => {
    const p = exampleProject();
    p.battery.enabled = true;
    const s = form(p);
    expect(count(s, "Altri preventivi (1 di 3)")).toBe(4);
    expect(count(s, "+ Aggiungi un altro preventivo")).toBe(4);
  });

  it("con la taglia indicativa niente preventivi di FV e batteria", () => {
    const p = startProject("rapida", true, "fv");
    p.battery.enabled = true;
    p.pv.sizing = "indicativa";
    expect(form(p)).not.toContain("Altri preventivi");
  });

  it("un'alternativa mostra specifiche, voci della lista, scambio e rimozione", () => {
    const p = startProject("rapida", true, "fv");
    addQuote(p, "pv");
    p.pv.otherQuotes[0].cost.supplier = "Ditta Solare B";
    const s = form(p);
    expect(s).toContain("Altri preventivi (2 di 3)");
    expect(s).toContain("Preventivo 2 · Ditta Solare B · 0 € · voci da chiarire");
    expect(s).toContain("Potenza dell'offerta");
    expect(s).toContain("Ponteggio o sicurezza in quota");
    expect(s).toContain("Usa questo preventivo nei risultati");
    expect(s).toContain("Rimuovi questo preventivo");
    expect(s).toContain("In uso nei risultati: «Preventivo 1»");
  });

  it("con tre preventivi il pulsante è spento e lo dice", () => {
    const p = startProject("rapida", true, "serramenti");
    addQuote(p, "windows");
    addQuote(p, "windows");
    const html = renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
    expect(html).toMatch(/<button type="button" class="btn small" disabled="">\+ Aggiungi un altro preventivo/);
    expect(text(html)).toContain("Al massimo 3 preventivi per intervento.");
  });

  it("il preventivo in uso elenca le voci della lista che non compaiono", () => {
    const s = form(exampleProject());
    expect(s).toContain("Voci che di solito ci sono e qui non compaiono: Linea elettrica, quadro e protezioni, Ponteggio o sicurezza in quota.");
    expect(s).toContain("Aggiungi le voci mancanti");
    expect(s).toContain("Nome dell'offerta");
    expect(s).toContain("Fornitore (facoltativo)");
    expect(s).toContain("Valido fino al");
  });
});

describe("Risultati e report: confronto dei preventivi", () => {
  const p = exampleProject();
  addQuote(p, "pv");
  const alt = p.pv.otherQuotes[0];
  alt.kWp.value = 6;
  alt.cost.forSize = 6;
  alt.cost.supplier = "Ditta B";
  alt.cost.items.forEach((it, i) => {
    it.status = i < 4 ? "incluso" : "escluso";
    it.amount = { value: 2500, status: "ipotizzato" };
  });
  const ev = evaluate(p, milano);
  const quotes = compareQuotes(p, milano, ev, ["pv"], new Date("2026-11-03"));

  it("i risultati mostrano la tabella con una colonna per preventivo e la frase sulla differenza", () => {
    const s = text(renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={milano} quotes={quotes} />));
    expect(s).toContain("Confronto dei preventivi");
    expect(s).toContain("Preventivo Preventivo 1 in uso Preventivo 2");
    expect(s).toContain("Ditta B");
    expect(s).toContain("€/kWp");
    expect(s).toMatch(/Preventivo 2 costa 1420 € in più di Preventivo 1 e aggiunge 2 kWp di pannelli: nel tuo profilo valgono \d+ € l'anno in più/);
  });

  it("senza alternative nessun confronto", () => {
    const q = exampleProject();
    const s = text(renderToStaticMarkup(<Results ev={evaluate(q, milano)} p={q} sens={null} climate={milano} quotes={[]} />));
    expect(s).not.toContain("Confronto dei preventivi");
  });

  it("il report riporta il confronto e le voci dell'alternativa", () => {
    const s = text(renderToStaticMarkup(<Report p={p} ev={ev} climate={milano} sens={null} quotes={quotes} />));
    expect(s).toContain("Confronto dei preventivi");
    expect(s).toContain("Costi fotovoltaico, «Preventivo 2» (alternativa)");
    expect(s).toContain("fornitore: Ditta B");
  });
});
