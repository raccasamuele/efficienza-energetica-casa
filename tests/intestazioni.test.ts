import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Intestazioni di sicurezza del sito (public/_headers), test di sicurezza del 23/11/2026
// (docs/sicurezza/TEST-2026-11-23.md, punto 3).
const leggi = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

function regoleTutto(): Map<string, string> {
  const righe = leggi("public/_headers").split(/\r?\n/).filter((r) => r.trim() !== "" && !r.trimStart().startsWith("#"));
  expect(righe[0]).toBe("/*");
  const intestazioni = new Map<string, string>();
  for (const riga of righe.slice(1)) {
    expect(riga).toMatch(/^\s+\S/);
    const i = riga.indexOf(":");
    intestazioni.set(riga.slice(0, i).trim().toLowerCase(), riga.slice(i + 1).trim());
  }
  return intestazioni;
}

function direttive(csp: string): Map<string, string[]> {
  return new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([nome, ...valori]) => [nome, valori]));
}

describe("intestazioni di sicurezza del sito", () => {
  it("ci sono tutte, per ogni file del sito", () => {
    const h = regoleTutto();
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("permissions-policy")).toContain("camera=()");
    // HSTS solo per Casa: includeSubDomains e preload varrebbero anche per gli altri siti del dominio.
    expect(h.get("strict-transport-security")).toBe("max-age=31536000");
    const csp = direttive(h.get("content-security-policy") ?? "");
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'"]);
    expect(csp.get("worker-src")).toEqual(["'self'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    // Niente scorciatoie che annullano la CSP.
    for (const valori of csp.values()) for (const v of ["'unsafe-inline'", "'unsafe-eval'", "*", "http:", "https:"]) expect(valori).not.toContain(v);
  });

  it.each(["public/privacy.html", "public/crediti.html"])("l'hash dello stile di %s è nella CSP", (pagina) => {
    const stili = [...leggi(pagina).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    expect(stili.length).toBeGreaterThan(0);
    const consentiti = direttive(regoleTutto().get("content-security-policy") ?? "").get("style-src") ?? [];
    for (const s of stili) expect(consentiti).toContain(`'sha256-${createHash("sha256").update(s).digest("base64")}'`);
  });

  it("le pagine non hanno script o attributi di stile scritti dentro", () => {
    for (const p of ["index.html", "public/privacy.html", "public/crediti.html"]) {
      const html = leggi(p);
      for (const m of html.matchAll(/<script\b[^>]*>/g)) expect(m[0]).toMatch(/\ssrc=/);
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it("la pagina dei crediti nomina le fonti con le licenze e i file da scaricare esistono", () => {
    const html = leggi("public/crediti.html");
    for (const testo of ["© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap contributors</a>", "opendatacommons.org/licenses/odbl/1-0/",
      "creativecommons.org/licenses/by/4.0/", "creativecommons.org/licenses/by-sa/4.0/", "open-meteo.com/en/licence", "Copernicus",
      "SIL Open Font License 1.1", "licenza MIT", "licenza ISC", "licenza Apache 2.0", "Mozilla Foundation"]) expect(html).toContain(testo);
    // Il file dei profili ARERA da scaricare è identico a quello usato dal motore, e ne porta fonte e licenza.
    expect(leggi("public/data/profili-arera.json")).toBe(leggi("src/engine/data/profili-arera.json"));
    expect(JSON.parse(leggi("public/data/profili-arera.json"))).toMatchObject({ licence: "CC BY-SA 4.0" });
    expect(html).toContain('href="./data/profili-arera.json"');
    expect(html).toContain('href="./licenze-terze-parti.txt"');
  });

  it("licenze-terze-parti.txt contiene il testo intero della licenza di ogni pacchetto del sito", () => {
    // Se cambia una versione, va rifatto copiando il file LICENSE del pacchetto installato.
    const testo = leggi("public/licenze-terze-parti.txt");
    const pacchetto = JSON.parse(leggi("package.json")) as { dependencies: Record<string, string> };
    for (const nome of [...Object.keys(pacchetto.dependencies), "scheduler"]) {
      const info = JSON.parse(leggi(`node_modules/${nome}/package.json`)) as { version: string; license: string };
      expect(testo).toContain(`${info.version} — ${info.license}`);
      expect(testo).toContain(leggi(`node_modules/${nome}/LICENSE`).replace(/\r\n/g, "\n").trimEnd());
    }
  });

  it("il piè di pagina del sito e il report portano alla pagina dei crediti", () => {
    expect(leggi("src/App.tsx")).toContain('<a href="./crediti.html">Crediti e licenze</a>');
    expect(leggi("src/ui/report.tsx")).toContain('<a href="./crediti.html">');
  });
});
