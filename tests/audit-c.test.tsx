// Regressioni del Blocco C: percorsi, provenienza, input accessibili e stampa.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkProject, evaluate, exampleProject, parseProjectFile, toProjectFile } from "../src/engine";
import { Entry } from "../src/App";
import { FormContext, NumberInput, QField, SelectField } from "../src/ui/fields";
import { BuildingForm, CostEditor, SystemForm } from "../src/ui/forms";
import { InterventionsForm } from "../src/ui/interventions";
import { documentQuote, editValue, journey, JourneySummary, nextActions, setChoice, startProject } from "../src/ui/journey";
import { FIELDS, fieldError, fieldId } from "../src/ui/metadata";
import { HelpDiagram } from "../src/ui/illustrations";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const p = exampleProject();
const ev = evaluate(p, climate);
const html = renderToStaticMarkup;
const props = { p, up: () => {}, issues: [] };

describe("UX-01 — preventivi e percorso Documentata", () => {
  it("espone stato e fonte dell'importo separati dallo stato della voce", () => {
    const s = html(<CostEditor block={p.pv.cost} title="FV" onChange={() => {}} doc path="pv.cost" />);
    expect(s).toContain("Stato voce"); expect(s).toContain("Origine dell&#x27;importo");
    expect(s).toContain("Fonte: Origine"); expect(s).toContain("Ho trascritto questi importi dal preventivo");
    expect(s).toContain('value="documentato"');
  });
  it("richiede una conferma esplicita, mantiene sconosciute ed escluse", () => {
    const b = structuredClone(p.heatPump.cost);
    b.items[0].status = "sconosciuto";
    b.quoteSource = "Offerta n. 15 del fornitore, riscontro del tecnico"; b.quoteDate = "2026-10-28";
    expect(b.items[1].amount.status).toBe("ipotizzato");
    const next = documentQuote(b);
    expect(next.items[0]).toEqual(b.items[0]);
    for (const it of next.items.filter((i) => i.status === "incluso")) expect(it.amount).toMatchObject({ status: "documentato", source: b.quoteSource, date: b.quoteDate });
    expect(next.items.filter((i) => i.status === "escluso")).toEqual(b.items.filter((i) => i.status === "escluso"));
  });
  it.each(["", "Esempio didattico", "Preset: costo", "Da sostituire"])("non documenta un riferimento inadeguato: %s", (source) => {
    const b = { ...p.pv.cost, quoteSource: source, quoteDate: "2026-10-28" };
    expect(documentQuote(b)).toBe(b);
  });
  it("non documenta senza data", () => expect(documentQuote({ ...p.pv.cost, quoteSource: "Offerta 21", quoteDate: "" }).items[0].amount.status).toBe("ipotizzato"));
  it("conserva fonte, data e conferma in export/import", () => {
    const d = exampleProject();
    d.pv.cost = documentQuote({ ...d.pv.cost, quoteSource: "Offerta FV n. 15", quoteDate: "2026-10-28" });
    d.building.airChange = { value: 0.4, status: "ipotizzato", source: "Stima tecnica motivata dal rilievo", confirmed: true };
    const r = parseProjectFile(JSON.stringify(toProjectFile(d, climate)), climate);
    expect(r.errors).toEqual([]); expect(r.file!.input.pv.cost).toEqual(d.pv.cost);
    expect(r.file!.input.building.airChange.confirmed).toBe(true);
  });
  it("Documentata espone perimetro, fonte, conferma tecnica e COP anche col catalogo", () => {
    const d = exampleProject(); d.building.lower = "terreno";
    const s = html(<FormContext.Provider value={{ project: d }}><BuildingForm {...props} p={d} doc /><InterventionsForm {...props} p={d} doc /></FormContext.Provider>);
    expect(s).toContain(fieldId("building.exposedPerimeter"));
    expect(s).toContain("Confermo la stima tecnica motivata: Ricambi d&#x27;aria");
    expect(s).toContain(fieldId("heatPump.copFactor"));
  });
});

describe("UX-02 / UX-03 — ingresso e Rapida", () => {
  it.each(["rapida", "documentata"] as const)("offre due partenze e spiega il percorso %s", (mode) => {
    const s = html(<Entry mode={mode} onStart={() => {}} />);
    expect(s).toContain("Inizia con la tua casa"); expect(s).toContain("Esplora un esempio");
    expect(s.replace(/<[^>]*>/g, "")).toContain("stesso motore");
  });
  it("la casa personale non eredita Milano come località e i vuoti non diventano zero", () => {
    const d = startProject("rapida");
    expect(d.location.code).toBe(""); expect(d.name).toBe("La mia casa");
    expect(d.building.floorArea.status).toBe("sconosciuto"); expect(d.building.floorArea.value).toBeGreaterThan(0);
    expect(d.building.floorArea.source).toContain("ereditata");
    expect(d.pv.cost.items.every((it) => it.status === "sconosciuto")).toBe(true);
  });
  it("identifica esempio, scelte ignote e conteggio delle ipotesi", () => {
    const d = startProject("documentata", true);
    setChoice(d, "shape", "nonso");
    expect(journey(d)?.origin).toBe("esempio"); expect(journey(d)?.choices.shape).toBe("nonso");
    const s = html(<JourneySummary p={d} />);
    expect(s).toContain("ereditate dall&#x27;esempio");
    const assumed = FIELDS.filter((r) => r.applies(d) && ["ipotizzato", "sconosciuto"].includes(r.get(d).status)).length;
    expect(s.replace(/<[^>]*>/g, "")).toContain(`Ipotesi numeriche: ${assumed}`);
  });
  it("le modifiche non conservano la fonte dell'esempio né la conferma del vecchio numero", () => {
    expect(editValue({ value: 120, status: "documentato", source: "Esempio", confirmed: true }, 130)).toMatchObject({ value: 130, status: "ipotizzato", confirmed: false });
    expect(editValue(p.building.floorArea, 130).source).not.toMatch(/esempio/i);
  });
  it("Rapida offre domande osservabili e scelte non note; tecniche nei details", () => {
    const s = html(<FormContext.Provider value={{ project: p }}><BuildingForm {...props} doc={false} /><SystemForm {...props} doc={false} /></FormContext.Provider>);
    expect(s).toContain("Epoca di costruzione indicativa"); expect(s).toContain("Che vetri riconosci?");
    expect(s).toContain("Non lo so, usa un&#x27;ipotesi dichiarata");
    const before = s.slice(0, s.indexOf('id="campo-building-uWall"'));
    expect(before.lastIndexOf("<details")).toBeGreaterThan(before.lastIndexOf("</details>"));
    expect(s).toContain("Vedi le ipotesi tecniche");
  });
});

describe("UX-04 — confronto diagnostico neutro", () => {
  it("distingue il consumo ipotetico ed evita il badge verde di verifica", () => {
    const s = html(<Results ev={ev} p={p} sens={null} climate={climate} />);
    expect(s).toContain("Confronto con un consumo ipotetico"); expect(s).toContain("Lo scarto non misura l&#x27;accuratezza");
    expect(s).not.toContain("% diagnostico");
  });
  it("mostra periodo e origine del consumo trascritto", () => {
    const d = structuredClone(p); d.consumption.gasSmcObserved.status = "documentato"; d.consumption.gasSmcObserved.source = "Bolletta 42"; d.consumption.observedPeriod = "ott 2025 – set 2026";
    const s = html(<Results ev={evaluate(d, climate)} p={d} sens={null} climate={climate} />);
    expect(s).toContain("Bolletta 42"); expect(s).toContain("ott 2025 – set 2026");
  });
  it("un dato dichiarato non noto non è chiamato bolletta non inserita", () => {
    const d = structuredClone(p); d.consumption.gasSmcObserved.status = "sconosciuto";
    const s = html(<Results ev={evaluate(d, climate)} p={d} sens={null} climate={climate} />);
    expect(s).toContain("Dato presente ma dichiarato non noto"); expect(s).not.toContain("bolletta non inserita");
  });
  it("traduce ore e kWh estrapolati accanto al dettaglio PDC", () => {
    const s = html(<Results ev={ev} p={p} sens={null} climate={climate} />);
    expect(s).toContain("condizioni sono fuori dai punti di prova"); expect(s).toContain("programma estende la stima");
  });
});

describe("A11Y-02 / UX-06 / UX-07 — campi e report", () => {
  it("associa unità, hint ed errore di intervallo e marca il campo non valido", () => {
    const d = exampleProject(); d.building.floorArea.value = 10;
    const s = html(<FormContext.Provider value={{ project: d }}><QField label="Area" q={d.building.floorArea} hint="Solo stanze riscaldate" onChange={() => {}} showSource /></FormContext.Provider>);
    const id = fieldId("building.floorArea");
    expect(s).toContain(`aria-describedby="${id}-unit ${id}-hint ${id}-error"`);
    expect(s).toContain('aria-invalid="true"'); expect(s).toContain('inputMode="decimal"');
    expect(s).toContain(`id="${id}-error"`);
  });
  it("interi e intervalli non si correggono silenziosamente", () => {
    expect(fieldError({ value: 1.5, status: "ipotizzato" }, FIELDS.find((r) => r.path === "building.floors"))).toContain("intero");
    expect(fieldError({ value: 120, status: "ipotizzato" }, FIELDS[0])).toBeUndefined();
  });
  it("anche i numeri primitivi hanno errore associato per intervallo e interi", () => {
    const s = html(<NumberInput ariaLabel="Anno sostituzione" value={1.5} onChange={() => {}} min={1} max={20} integer />);
    expect(s).toContain('aria-invalid="true"'); expect(s).toContain("Inserisci un numero intero"); expect(s).toMatch(/aria-describedby="[^"]+-range"/);
  });
  it("un perimetro noto nullo è segnato al campo, uno sconosciuto resta ipotesi", () => {
    const r = FIELDS.find((r) => r.path === "building.exposedPerimeter")!;
    expect(fieldError({ value: 0, status: "misurato" }, r)).toContain("positivo");
    expect(fieldError({ value: 0, status: "sconosciuto" }, r)).toBeUndefined();
  });
  it("associa il suggerimento anche alle scelte", () => {
    const s = html(<SelectField label="Scelta" value="a" options={[{ value: "a", label: "A" }]} onChange={() => {}} hint="Spiegazione" />);
    expect(s).toMatch(/aria-describedby="([^"]+)-hint"/);
  });
  it("usa metadati e unità comuni in tutte le righe del report", () => {
    expect(FIELDS.every((r) => r.unit.length > 0)).toBe(true);
    const s = html(<Report p={p} ev={ev} climate={climate} sens={null} />);
    for (const unit of ["W/m²K", "Smc/anno", "€/kWh", "kJ/m²K", "adimensionale"]) expect(s).toContain(unit);
    expect(s).toContain("Fonti originali"); expect(s).toContain("Trasformazioni del progetto");
    expect(s).toContain("rispetto al consumo ipotetico");
  });
  it("propone tre priorità motivate con destinazioni vere, senza fingere influenza calcolata", () => {
    const a = nextActions(p);
    expect(a.map((x) => x.path)).toEqual(["tariffs.elecPrice", "system.designFlowTemp", "pv.cost"]);
    const d = startProject("rapida"); expect(nextActions(d)[0].path).toBe("location");
    const s = html(<JourneySummary p={p} expanded />);
    expect(s).toContain('data-field="tariffs.elecPrice"'); expect(s).toContain("non una graduatoria");
  });
  it("non attribuisce lo stato documentato globale al catalogo non validato", () => {
    const d = structuredClone(p); d.mode = "documentata";
    for (const r of FIELDS) { const q = r.get(d); q.status = "documentato"; q.source = "Documento tecnico di prova n. 12"; }
    d.building.geometryMode = "aree"; d.building.windowMode = "aree";
    for (const o of ["N", "E", "S", "O"] as const) { d.building.wallArea[o].value = 40; d.building.windowArea[o].value = 4; }
    for (const k of ["windows", "heatPump", "pv"] as const) d[k].cost = documentQuote({ ...d[k].cost, quoteSource: "Preventivo 12", quoteDate: "2026-10-28" });
    expect(checkProject(d).some((i) => i.message.includes("Costi") && i.message.includes("ipotetici"))).toBe(false);
    expect(checkProject(d).some((i) => i.message.includes("Catalogo PDC") && i.severity === "esplorativo")).toBe(true);
  });
});

describe("Mini schemi", () => {
  it.each(["forme", "superficie", "bolletta", "parete", "mandata", "fv", "tetto"] as const)("%s ha nome accessibile e didascalia HTML", (kind) => {
    const s = html(<HelpDiagram kind={kind} />); expect(s).toContain('role="img" aria-label='); expect(s).toContain("<figcaption");
  });
});

function contrast(a: string, b: string) {
  const lum = (hex: string) => hex.replace("#", "").match(/../g)!.map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("A11Y-01 / UX-05 — contrasto e nomi dei passi", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const tokens = (s: string) => Object.fromEntries([...s.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("@media")));
  const dark = { ...light, ...tokens(css.slice(css.indexOf(":root:not"), css.indexOf("* {"))) };
  const resolve = (t: Record<string, string>, key: string): string => t[key].startsWith("var(") ? resolve(t, t[key].slice(6, -1)) : t[key];
  it.each([["chiaro", light], ["scuro", dark]] as const)("testo AA su superfici e stati nel tema %s", (_, t) => {
    for (const fg of ["text", "muted", "accent-text", "warn-text", "bad-text"]) for (const bg of ["surface", "surface-2", "surface-3", "accent-soft"]) expect(contrast(resolve(t, fg), resolve(t, bg)), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const kind of ["ok", "warn", "bad", "info"]) expect(contrast(resolve(t, `${kind}-text`), resolve(t, `${kind}-soft`)), kind).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["accent-strong"], t["on-accent"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["control-line"], t["surface-2"])).toBeGreaterThanOrEqual(3);
  });
  it("non nasconde i nomi della navigazione mobile", () => {
    expect(css).not.toMatch(/\.nav button span[^}]*position:\s*absolute/);
    expect(css).toContain("flex: 0 0 auto"); expect(css).toContain("min-height: 44px");
  });
});

describe("Esportazione per la CER", () => {
  it("i risultati non offrono esportazioni per la CER", () => {
    const s = html(<Results ev={ev} p={p} sens={null} climate={climate} />);
    expect(s).not.toContain("Esporta per la CER"); expect(s).not.toContain("Per la comunità energetica"); expect(s).not.toContain("cer.raccasamuele.it");
  });
});
