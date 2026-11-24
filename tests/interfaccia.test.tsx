import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { checkProject, exampleProject, ENGINE_VERSION, type Issue } from "../src/engine";
import { InfoTip } from "../src/ui/info-tip";
import { FormContext, QField } from "../src/ui/fields";
import { groupIssues, IssueList } from "../src/ui/issues";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { Icon } from "../src/ui/icons";
import { Results } from "../src/ui/results";
import { evaluate } from "../src/engine";
import { FIELDS } from "../src/ui/metadata";
import { documentQuote } from "../src/ui/journey";
import { loadMilano } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("Indicatori e icone", () => {
  it("riconosce dati completi senza dichiarare validato il modello PDC", () => {
    const p = exampleProject();
    p.mode = "documentata";
    p.building.geometryMode = "aree";
    p.building.windowMode = "aree";
    for (const orientation of ["N", "E", "S", "O"] as const) {
      p.building.wallArea[orientation].value = 40;
      p.building.windowArea[orientation].value = 4;
    }
    for (const rule of FIELDS) { rule.get(p).status = "documentato"; rule.get(p).source = "Rilievo tecnico e scheda n. 42"; }
    p.location.siteAltitude = { value: 122, status: "misurato", source: "Rilievo altimetrico n. 42" };
    p.tariffs.date = "2026-10-29";
    p.consumption.observedPeriod = "Ottobre 2025 – settembre 2026";
    for (const name of ["windows", "heatPump", "pv"] as const) p[name].cost = documentQuote({ ...p[name].cost, quoteSource: "Offerta n. 42 del fornitore", quoteDate: "2026-10-29" });
    const climate = loadMilano();
    const ev = evaluate(p, climate);
    expect(ev.ok).toBe(true);
    const s = renderToStaticMarkup(<Results p={p} ev={ev} climate={climate} sens={null} />);
    const text = s.replace(/<[^>]*>/g, "");
    expect(text).toContain("completi e tracciabili");
    expect(text).toContain("PDC indicativa");
    expect(s).not.toContain("Esplorazione su ipotesi");
  });
  it("usa 31 coppie WebP 1x/2x sotto 12 KB con semantica decorativa o etichetta esplicita", () => {
    const root = new URL("../public/icons/", import.meta.url);
    const files = readdirSync(root);
    expect(files).toHaveLength(62);
    for (const file of files) {
      const path = new URL(file, root);
      expect(file).toMatch(/^([a-z]+(?:-[a-z]+)*?)(-2x)?\.webp$/);
      expect(statSync(path).size).toBeLessThanOrEqual(12000);
      const bytes = readFileSync(path);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
      if (!file.includes("-2x")) {
        expect(files).toContain(file.replace(".webp", "-2x.webp"));
        const name = file.slice(0, -5) as Parameters<typeof Icon>[0]["name"];
        const markup = renderToStaticMarkup(<Icon name={name} />);
        expect(markup).toContain(`icons/${file} 1x, /icons/${name}-2x.webp 2x`);
        expect(markup).toContain('width="24" height="24"');
      }
    }
    expect(renderToStaticMarkup(<Icon name="casa" />)).toContain('alt="" aria-hidden="true"');
    const labeled = renderToStaticMarkup(<Icon name="casa" label="Edificio" />);
    expect(labeled).toContain('alt="Edificio"');
    expect(labeled).not.toContain('aria-hidden="true"');
  });
});

describe("Interfaccia Casa: azioni del percorso", () => {
  it("offre modalità, importazione ed esempio solo all'ingresso", () => {
    // prima la domanda: modalità, esempio e partenza compaiono dopo la scelta (verificato su Entry in percorsi.test.tsx)
    const entry = renderToStaticMarkup(<App />);
    expect(entry).toContain('aria-label="Cosa vuoi verificare?"');
    expect(entry).toContain("Le mie case");
    // chi torna con un lavoro salvato rivede le cinque domande e può riprendere
    vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: { ...exampleProject(), goal: "batteria" } }) } });
    const back = renderToStaticMarkup(<App />);
    expect(back).toContain('aria-label="Cosa vuoi verificare?"');
    expect(back).toContain("Hai un lavoro salvato in questo browser");
    expect(back).toContain("Riprendi");
    expect(back).toContain("Ho già il fotovoltaico: mi conviene la batteria?");
    expect(back).toContain("Mi conviene il fotovoltaico, con o senza batteria?");
    expect(back).not.toContain("Salva il progetto</button>");
    const header = back.match(/<header[\s\S]*?<\/header>/)![0];
    expect(header).not.toContain("<button");
    expect(header).not.toContain("Esplorazione su ipotesi");
    expect(header).not.toContain("Confronto documentato");
  });
});

describe("Riepiloghi delle ipotesi", () => {
  const issues: Issue[] = [
    { section: "Edificio", severity: "esplorativo", message: "Superficie utile riscaldata: ipotizzato, serve un dato documentato o misurato." },
    { section: "Edificio", severity: "esplorativo", message: "U pareti: ipotizzato, serve un dato documentato o misurato." },
    { section: "Edificio", severity: "esplorativo", message: "Ricambi d'aria: serve una stima tecnica motivata e confermata esplicitamente (un preset non basta)." },
    { section: "Edificio", severity: "esplorativo", message: "Modalità rapida: valori preimpostati dichiarati, risultati indicativi." },
  ];
  it("classifica per metadati, conta i campi e conserva i link", () => {
    const groups = groupIssues(issues);
    expect(Object.values(groups).map((g) => g.length)).toEqual([2, 1, 1]);
    const s = renderToStaticMarkup(<IssueList issues={issues} sections={["Edificio"]} />);
    expect(s).toContain("Dati da misurare o documentare (2)");
    expect(s).toContain("Stime tecniche da confermare (1)");
    expect(s).toContain("Scelte del percorso (1)");
    expect(s).toContain('href="#campo-building-uWall" data-field="building.uWall"');
    expect(s).toContain('data-field="building.floorArea"');
    expect(s).toContain('data-field="building.airChange"');
    expect(s).not.toContain("Esplorativo:");
    expect(s).not.toContain('<details class="issue-summary" open');
    expect(s.match(/Serve un dato documentato o misurato/g)).toHaveLength(1);
  });
  it("apre il riepilogo e separa gli errori bloccanti", () => {
    const s = renderToStaticMarkup(<IssueList issues={[...issues, { section: "Edificio", severity: "errore", message: "U pareti: fuori intervallo." }]} sections={["Edificio"]} />);
    expect(s).toContain('<details class="issue-summary" open=""');
    expect(s).toContain('role="alert"');
    expect(s).toContain("Errori da correggere (1)");
    expect(s).toContain("U pareti: fuori intervallo.");
  });
  it("riconosce tutti i campi tecnici dell'esempio tramite FIELDS", () => {
    const groups = groupIssues(checkProject(exampleProject()));
    expect(groups.tecnico.some((i) => i.path === "building.thermalBridgeDeltaU")).toBe(true);
    expect(groups.dato.some((i) => i.path === "building.uWall")).toBe(true);
    expect(groups.percorso.some((i) => i.label === "Modalità rapida")).toBe(true);
  });
});

describe("Spiegazioni su richiesta", () => {
  it("ha un comando accessibile, inizialmente chiuso e associato al dettaglio", () => {
    const s = renderToStaticMarkup(<InfoTip id="dettaglio" label="Superficie">Solo locali riscaldati</InfoTip>);
    expect(s).toContain('type="button"');
    expect(s).toContain('aria-label="Spiegazione: Superficie"');
    expect(s).toContain('aria-expanded="false" aria-controls="dettaglio"');
    expect(s).toContain('id="dettaglio"');
    expect(s).toContain('hidden=""');
    expect(s).toContain("Solo locali riscaldati");
  });
  it("collega al campo il suggerimento anche da chiuso", () => {
    const p = exampleProject();
    const s = renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><QField label="Superficie" q={p.building.floorArea} showSource={false} hint="Solo locali riscaldati" onChange={() => {}} /></FormContext.Provider>);
    expect(s).toContain('aria-describedby="campo-building-floorArea-unit campo-building-floorArea-hint"');
    expect(s).toContain('aria-controls="campo-building-floorArea-hint"');
    expect(s).toContain('id="campo-building-floorArea-hint"');
  });
});

describe("Pubblicazione — nomi delle icone e intestazione del report", () => {
  it("le icone hanno nomi sicuri negli URL (Cloudflare non serve la «@» nei percorsi)", () => {
    for (const file of readdirSync(new URL("../public/icons", import.meta.url))) expect(file).toMatch(/^[a-z0-9-]+\.webp$/);
    expect(renderToStaticMarkup(<Icon name="casa" />)).not.toContain("@");
  });
  it("il report non usa più l'etichetta «Esplorazione su ipotesi»", async () => {
    const { Report } = await import("../src/ui/report");
    const p = exampleProject();
    const s = renderToStaticMarkup(<Report p={p} ev={evaluate(p, loadMilano())} climate={loadMilano()} sens={null} />);
    expect(s).not.toContain("Esplorazione su ipotesi");
    expect(s).toContain("Stima con ipotesi da completare");
  });
});
