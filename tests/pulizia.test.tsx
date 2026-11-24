import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, RULES, type ProjectInput } from "../src/engine";
import { METODO_CASA, METODO_ID, methodForPath } from "../src/ui/info-tip";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { loadMilano } from "./helpers";

// Tappa 6 bis B: pulizia dell'interfaccia.
const milano = loadMilano();
const results = (p: ProjectInput) => renderToStaticMarkup(<Results ev={evaluate(p, milano)} p={p} sens={null} climate={milano} />);
const report = (p: ProjectInput) => renderToStaticMarkup(<Report ev={evaluate(p, milano)} p={p} sens={null} climate={milano} />);
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const srcFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? srcFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);

describe("6 bis B: collegamenti alle pagine tecniche", () => {
  it("ogni id usato nel codice è nell'elenco chiuso", () => {
    const used = new Set<string>();
    for (const f of srcFiles("src/ui")) for (const m of readFileSync(f, "utf8").matchAll(/method="([a-z0-9-]+)"/g)) used.add(m[1]);
    for (const r of RULES) { const id = methodForPath(r.path); if (id) used.add(id); }
    expect(used.size).toBeGreaterThan(15);
    for (const id of used) expect(METODO_ID).toContain(id);
  });

  it("l'elenco chiuso coincide con l'elenco dei collegamenti del portale (se PORTALE_COLLEGAMENTI lo indica)", () => {
    const file = process.env.PORTALE_COLLEGAMENTI;
    if (!file || !existsSync(file)) return;
    const casa = [...readFileSync(file, "utf8").matchAll(/metodo\/casa\.html#([a-z0-9-]+)/g)].map((m) => m[1]);
    expect([...METODO_ID].sort()).toEqual([...new Set(casa)].sort());
  });

  it("il collegamento apre la pagina tecnica in una nuova scheda e lo dice", () => {
    const html = results(exampleProject());
    expect(html).toContain(`href="${METODO_CASA}#economia-spesa-annua"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("(si apre in una nuova scheda)");
  });
});

describe("6 bis B: risultati più corti, report invariato", () => {
  it("condizioni e registro dei servizi stanno in sezioni chiuse sullo schermo", () => {
    const p = exampleProject();
    const html = results(p);
    expect(html).toMatch(/<details class="fold"><summary>Chi fa che cosa: riscaldamento, acqua calda, cucina<\/summary>/);
    // il testo resta nella pagina (cercabile e nei test), solo nascosto finché non si apre
    expect(text(html)).toContain("Servizio Vettore Generatore Energia finale");
  });

  it("una sola frase «preanalisi» per schermata: niente doppione nei risultati", () => {
    expect(text(results(exampleProject()))).not.toContain("Preanalisi: non è un APE né un risparmio garantito.");
  });

  it("il report mantiene i testi completi e indica la pagina tecnica", () => {
    const s = text(report(exampleProject()));
    expect(s).toContain("Il metodo di calcolo, con equazioni ed esempi, è descritto in raccasamuele.it/metodo/casa");
    expect(s).toContain("Qui sotto il riscaldamento di tutti i pacchetti è moltiplicato per");
    expect(s).toContain("Non è una misura dell'accuratezza del modello.");
    expect(s).not.toContain("Come lo calcoliamo");
  });
});
