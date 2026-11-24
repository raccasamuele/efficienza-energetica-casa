import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createData } from "../mcp/dati";
import { createTools } from "../mcp/strumenti";
import { codificaRisposte, controllaRisposte, creaProgetto, FONTE_UTENTE, leggiRisposte, LINK_PREFIX, trovaComune, type Risposte } from "../src/ui/crea-progetto";

// crea_progetto e link «Apri in Casa», chiesti da Samuele il 19/11/2026 («si fai così»).
const data = createData(resolve(__dirname, "../public/data"));
const comuni = data.comuni()!;
const index = data.index()!;
const tool = (tools: ReturnType<typeof createTools>, name: string) => tools.find((t) => t.name === name)!;

describe("risposte e comune", () => {
  it("trova il comune per nome, nome con provincia o codice ISTAT; con nomi uguali chiede la provincia", () => {
    expect(trovaComune("Fossano", comuni).comune?.sigla).toBe("CN");
    expect(trovaComune("  fossano (cn) ", comuni).comune?.name).toBe("Fossano");
    expect(trovaComune("015146", comuni).comune?.name).toBe("Milano");
    const castro = trovaComune("Castro", comuni);
    expect(castro.comune).toBeUndefined();
    expect(castro.errore).toMatch(/Castro \(BG\).*Castro \(LE\)|Castro \(LE\).*Castro \(BG\)/);
    expect(trovaComune("Castro (LE)", comuni).comune?.sigla).toBe("LE");
    expect(trovaComune("Fossanoo", comuni).errore).toMatch(/non trovato.*Fossano \(CN\)/);
  });

  it("controlla le risposte: domanda, scelte e numeri ammessi, nessun campo sconosciuto", () => {
    expect(controllaRisposte({ comune: "004089", domanda: "fv", superficie_m2: 120 }).errori).toEqual([]);
    const bad = controllaRisposte({ comune: "4089", domanda: "batteria", epoca: "1970", superficie_m2: "120", nome: "Mario" }).errori.join(" ");
    for (const part of ["Comune non valido", "Domanda non valida", "epoca", "superficie_m2", "sconosciuta: nome"]) expect(bad).toContain(part);
  });

  it("il link porta solo le risposte e si rilegge uguale; un link alterato non apre niente", () => {
    const r: Risposte = { comune: "004089", domanda: "fv", superficie_m2: 140, luce_kwh_anno: 3200, preventivo_fv: false };
    const code = codificaRisposte(r);
    expect(code.length).toBeLessThan(200);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(leggiRisposte(code)).toEqual({ risposte: r, errori: [] });
    expect(leggiRisposte(code.slice(0, -6) + "AAAAAA").risposte).toBeUndefined();
    expect(leggiRisposte("x".repeat(2001)).errori).toEqual(["Link troppo lungo."]);
    const injected = codificaRisposte({ ...r, script: "<b>" } as unknown as Risposte);
    expect(leggiRisposte(injected).errori.join(" ")).toContain("risposte sconosciute");
  });

  it("dal link il sito non ripete i nomi di campo scritti da chi ha fatto il link", () => {
    const r: Risposte = { comune: "004089", domanda: "fv" };
    const testo = "Chiama subito questo numero";
    const read = leggiRisposte(codificaRisposte({ ...r, [testo]: 1, altro: 2 } as unknown as Risposte));
    expect(read.risposte).toBeUndefined();
    expect(read.errori).toEqual(["Il link contiene risposte sconosciute."]);
    expect(read.errori.join(" ")).not.toContain("Chiama");
  });

  it("l'errore del clima mancante non porta il percorso del computer al servizio dell'agente", () => {
    const dir = resolve(__dirname, "cartella-che-non-esiste");
    const { error } = createData(dir).climate("015146");
    expect(error).toBe("Clima 015146 non trovato nella cartella dei dati.");
    expect(error).not.toContain(dir);
  });
});

describe("crea_progetto", () => {
  it("crea il progetto della modalità rapida: valori dell'utente come ipotesi, scheda, prossimi dati e link", async () => {
    const tools = createTools(data, { sito: "https://casa.example/" });
    const out = await tool(tools, "crea_progetto").run({ comune: "Fossano", domanda: "fv", superficie_m2: 140, epoca: "prima1990", vetri: "doppio", luce_kwh_anno: 3200, gas_smc_anno: 1500, preventivo_fv: false, tetto_m2: 30 });
    expect(out.isError).toBeFalsy();
    const s = out.structured as { progetto_id: string; link_apri_in_casa: string; scheda: { voce: string; valore: string; stato: string }[]; prossimi_dati: unknown[]; avvisi: string[]; clima: { capoluogo: string } };
    expect(s.progetto_id).toBe("casa-1");
    expect(s.link_apri_in_casa.startsWith(`https://casa.example/${LINK_PREFIX}`)).toBe(true);
    expect(s.scheda.find((r) => r.voce === "Comune")).toEqual({ voce: "Comune", valore: "Fossano (CN)", stato: "dato tuo" });
    expect(s.scheda.find((r) => r.voce === "Bollette")?.valore).toBe("3200 kWh luce · 1500 Smc gas all'anno");
    expect(s.clima.capoluogo).toBe("Torino");
    expect(s.avvisi.join(" ")).toMatch(/km/); // clima di Torino lontano da Fossano: lo stesso avviso del sito
    expect(out.text).toContain("ipotizzato");
    expect(out.text).toContain(s.link_apri_in_casa);

    // Il sito ricrea dal link lo stesso progetto che il server tiene in memoria.
    const code = s.link_apri_in_casa.split(LINK_PREFIX)[1];
    const fromLink = creaProgetto(leggiRisposte(code).risposte!, comuni, index).progetto!;
    expect(fromLink.building.floorArea).toEqual({ value: 140, status: "ipotizzato", source: FONTE_UTENTE, confirmed: false });
    expect(fromLink.pv.sizing).toBe("indicativa");
    expect(fromLink.pv.roofArea.value).toBe(30);

    // Valutazione con progetto_id: stessa strada di un file, comune tolto dalla risposta.
    const value = await tool(tools, "valuta_progetto").run({ progetto_id: s.progetto_id });
    expect(value.isError).toBeFalsy();
    expect((value.structured.verdetto as { frase: string }).frase).toMatch(/fotovoltaico|Fotovoltaico/i);
    expect(value.text + JSON.stringify(value.structured)).not.toContain("Fossano");
    const fromFile = await tool(tools, "valuta_progetto").run({ contenuto: JSON.stringify({ schemaVersion: 1, engineVersion: "0.18.0", input: fromLink }) });
    expect(fromFile.structured.pacchetti).toEqual(value.structured.pacchetti);
  });

  it("errori leggibili: valori fuori intervallo, comune ambiguo, progetto non creato", async () => {
    const tools = createTools(data);
    const crea = tool(tools, "crea_progetto");
    const negative = await crea.run({ comune: "Fossano", domanda: "pdc", superficie_m2: -5 });
    expect(negative.isError).toBe(true);
    expect(negative.text).toMatch(/Chiedi di nuovo/);
    expect((await crea.run({ comune: "Castro", domanda: "pdc" })).text).toMatch(/provincia/);
    expect((await crea.run({ comune: "Fossano", domanda: "auto" })).text).toMatch(/Domanda non valida/);
    expect((await tool(tools, "valuta_progetto").run({ progetto_id: "casa-9" })).text).toMatch(/non trovato/);
    expect(((await crea.run({ comune: "Fossano", domanda: "pdc" })).structured as { link_apri_in_casa: string }).link_apri_in_casa).toMatch(/^https:\/\/casa\.raccasamuele\.it\/#crea=/);
  });
});
