import { describe, expect, it } from "vitest";
import { exampleProject, parseProjectFile } from "../src/engine";
import { parseEnergyProfile, projectFromProfile } from "../src/engine/profilo";
import { parseMeterFile, curveFromFiles } from "../src/engine/misure";
import { readBill } from "../src/engine/bolletta";
import { codificaRisposte, leggiRisposte } from "../src/ui/crea-progetto";
import { leggiCase } from "../src/ui/case";

// Test di sicurezza del 23/11/2026 (docs/sicurezza/TEST-2026-11-23.md, punto 4): dati che arrivano da fuori, fatti
// apposta per rompere. Ogni ingresso deve rifiutarli con un messaggio, senza eccezioni inattese, senza bloccare la
// pagina e senza toccare i prototipi degli oggetti.
const progetto = () => JSON.stringify({ schemaVersion: 1, engineVersion: "0.18.0", input: exampleProject() });
const veloce = <T,>(f: () => T, ms = 1500): T => {
  const t = performance.now();
  const r = f();
  expect(performance.now() - t).toBeLessThan(ms);
  return r;
};
const nessunInquinamento = () => {
  expect(({} as Record<string, unknown>).inquinato).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, "inquinato")).toBe(false);
};

describe("progetto JSON importato", () => {
  it("rifiuta testo non JSON, versioni sbagliate e file troppo grandi", () => {
    for (const t of ["", "null", "[]", "\"x\"", "{", "{\"schemaVersion\":2}", "{\"schemaVersion\":1}", "{\"schemaVersion\":1,\"input\":null}"])
      expect(parseProjectFile(t, null).file).toBeUndefined();
    expect(parseProjectFile(" ".repeat(2_000_001), null).errors).toEqual(["File troppo grande."]);
  });

  it("rifiuta numeri infiniti, tipi sbagliati e strutture troppo profonde, in fretta", () => {
    expect(parseProjectFile(progetto().replace(/"value":\d+(\.\d+)?/, "\"value\":1e999"), null).file).toBeUndefined();
    const tipo = JSON.parse(progetto());
    tipo.input.consumption.electricityKwh.value = "3200";
    expect(parseProjectFile(JSON.stringify(tipo), null).file).toBeUndefined();
    for (const n of [100, 5_000, 100_000]) {
      const profondo = progetto().replace("\"input\":{", `"input":{"extra":${"[".repeat(n)}${"]".repeat(n)},`);
      expect(veloce(() => parseProjectFile(profondo, null)).file).toBeUndefined();
    }
    const lista = JSON.parse(progetto());
    lista.input.pv.otherQuotes = Array.from({ length: 10_000 }, () => ({}));
    expect(veloce(() => parseProjectFile(JSON.stringify(lista), null)).file).toBeUndefined();
  });

  it("le chiavi __proto__ e constructor non cambiano i prototipi", () => {
    const testo = progetto().replace("{\"schemaVersion\":1,", "{\"__proto__\":{\"inquinato\":1},\"constructor\":{\"prototype\":{\"inquinato\":1}},\"schemaVersion\":1,")
      .replace("\"input\":{", "\"input\":{\"__proto__\":{\"inquinato\":1},");
    parseProjectFile(testo, null);
    parseProjectFile(testo, null, undefined, { draft: true });
    nessunInquinamento();
  });

  it("un nome lunghissimo o con markup resta testo", () => {
    const p = JSON.parse(progetto());
    p.input.name = "<img src=x onerror=alert(1)>" + "a".repeat(100_000);
    const r = parseProjectFile(JSON.stringify(p), null);
    expect(r.file?.input.name.startsWith("<img")).toBe(true); // React lo scrive come testo, mai come HTML
  });
});

describe("profilo energetico", () => {
  it("rifiuta profili rotti senza eccezioni", () => {
    const rotti = ["{", "{}", "{\"formato\":\"profilo-energetico\"}", JSON.stringify({ formato: "profilo-energetico", versione: 1, scenari: "x" }),
      JSON.stringify({ formato: "profilo-energetico", versione: 1, scenari: Array(21).fill({}) }),
      JSON.stringify({ formato: "profilo-energetico", versione: 1, comune: { codice_istat: 1 }, scenari: [{ id: "a", nome: "a", attuale: true, consumi: { kwh_annui: 1, ore: Array(864).fill(-1), stato: "misurato" } }] }),
      JSON.stringify({ formato: "profilo-energetico", versione: 1, comune: null, scenari: [{ id: "a", nome: "a", attuale: true, consumi: { kwh_annui: 1, ore: Array(8760).fill(1), stato: "misurato" } }] })];
    for (const t of rotti) {
      expect(parseEnergyProfile(t).profile).toBeUndefined();
      expect(projectFromProfile(t, exampleProject()).input).toBeUndefined();
    }
    expect(parseEnergyProfile(" ".repeat(2_000_001)).errors[0]).toMatch(/troppo grande/);
  });

  it("le chiavi __proto__ non cambiano i prototipi", () => {
    projectFromProfile("{\"__proto__\":{\"inquinato\":1},\"formato\":\"profilo-energetico\",\"versione\":1,\"scenari\":[{\"__proto__\":{\"inquinato\":1}}]}", exampleProject());
    nessunInquinamento();
  });
});

describe("curva del contatore (CSV)", () => {
  it("rifiuta file rotti con un messaggio, in fretta", () => {
    const rotti = ["", ";;;;", "pod;data_lettura\n", "giorno;00:00-00:15\n1;2", "\u0000".repeat(1000), "a;b\n".repeat(100_000),
      "pod;data_lettura;ea\nX;99/99/9999;1", "pod;data_lettura;ea\nX;" + "1".repeat(100_000) + ";1"];
    for (const t of rotti) expect(() => veloce(() => parseMeterFile(t))).toThrow(Error);
    expect(() => parseMeterFile("x".repeat(10_000_001))).toThrow(/10 MB/);
    expect(() => curveFromFiles(["a;b\n1;2"])).toThrow(Error);
  });
});

describe("testo della bolletta (PDF)", () => {
  it("testo vuoto o a caso: un errore leggibile o una lettura vuota, mai blocchi", () => {
    expect(() => readBill("")).toThrow(/non contiene testo/);
    const casuali = [
      "1".repeat(200_000),
      "consumo fatturato ".repeat(20_000),
      ("lettura rilevata " + "x".repeat(24) + " 01/01/2026 ").repeat(5_000),
      "1.000.000.000.000.000.000,".repeat(20_000),
      ("periodo di fatturazione: " + "dal ".repeat(50)).repeat(2_000),
    ];
    for (const t of casuali) {
      try { veloce(() => readBill(t), 3000); } catch (e) { expect(e).toBeInstanceOf(Error); }
    }
  });
});

describe("link «Apri in Casa» (#crea=)", () => {
  it("rifiuta link rotti, troppo lunghi o con campi in più", () => {
    for (const c of ["", "!!!", "%%%", "AAAA", btoa("{}"), btoa("[]"), btoa("{\"v\":2}"), "a".repeat(2001)])
      expect(leggiRisposte(c).risposte).toBeUndefined();
    const extra = btoa(JSON.stringify({ v: 1, comune: "001272", domanda: "fv", script: "<script>" })).replace(/=+$/, "");
    expect(leggiRisposte(extra).errori).toEqual(["Il link contiene risposte sconosciute."]);
    const tipo = btoa(JSON.stringify({ v: 1, comune: "001272", domanda: "fv", luce_kwh_anno: "1e999" })).replace(/=+$/, "");
    expect(leggiRisposte(tipo).risposte).toBeUndefined();
    expect(leggiRisposte(codificaRisposte({ comune: "001272", domanda: "fv" })).risposte).toBeDefined();
  });

  it("le chiavi __proto__ non cambiano i prototipi", () => {
    leggiRisposte(btoa("{\"v\":1,\"__proto__\":{\"inquinato\":1},\"comune\":\"001272\",\"domanda\":\"fv\"}").replace(/=+$/, ""));
    nessunInquinamento();
  });
});

describe("case salvate nel browser (localStorage) alterate", () => {
  const memoria = (dati: Record<string, string>) => {
    const m = new Map(Object.entries(dati));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
  };
  const BOZZA = "confronto-interventi:bozza:v1", CASE = "confronto-interventi:altre-case:v1", RIFIUTATE = "confronto-interventi:altre-case-rifiutate";

  it("una bozza o un elenco rotti non rompono la pagina: si conservano tra i dati rifiutati", () => {
    for (const [bozza, elenco] of [["{", "{"], ["null", "null"], ["[]", "{\"version\":1,\"case\":{}}"], [progetto().replace("\"value\":", "\"value\":\"x\","), "{\"version\":1,\"case\":[null,1,\"x\",{\"file\":{}}]}"],
      ["{\"__proto__\":{\"inquinato\":1}}", "{\"__proto__\":{\"inquinato\":1},\"version\":1,\"case\":[{\"__proto__\":{\"inquinato\":1},\"id\":\"a\",\"savedAt\":\"b\",\"file\":{\"__proto__\":{\"inquinato\":1}}}]}"]]) {
      const s = memoria({ [BOZZA]: bozza, [CASE]: elenco });
      const r = leggiCase(s);
      expect(r.attiva).toBeNull();
      expect(r.altre).toEqual([]);
      expect(s.m.get(RIFIUTATE)).toBe(elenco);
      expect(r.note.length).toBeGreaterThan(0);
    }
    nessunInquinamento();
  });

  it("troppe case: si tengono le prime 9, le altre tra i dati rifiutati", () => {
    const file = JSON.parse(progetto());
    const elenco = JSON.stringify({ version: 1, case: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, savedAt: "2026-11-23", file })) });
    const s = memoria({ [CASE]: elenco });
    const r = veloce(() => leggiCase(s), 10_000);
    expect(r.altre).toHaveLength(9);
    expect(s.m.get(RIFIUTATE)).toBe(elenco);
  });
});
