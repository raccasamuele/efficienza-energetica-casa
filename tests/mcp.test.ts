import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, comuneByCode, exampleProject, locationFromComune, prepareClimate, toProjectFile, type ClimatePackage, type ProjectInput } from "../src/engine";
import { createEngineRuntime } from "../src/engine/worker-runtime";
import type { EngineResponse } from "../src/engine/worker-protocol";
import { evaluationForGoal, goalInfo } from "../src/ui/goals";
import { verdetto, verdettoFrase } from "../src/ui/verdetto";
import { createData } from "../mcp/dati";
import { createHandler, PROTOCOL_VERSIONS, serveStdio, type Response, type ToolDef } from "../mcp/protocollo";
import { AVVERTENZA, NOTA_STATO } from "../mcp/risposte";
import { createTools } from "../mcp/strumenti";
import { readPublicJson } from "./helpers";

// Passo 1 degli strumenti per agenti AI (guida: docs/ecosistema/GUIDA-MCP.md), chiesto da Samuele il 19/11/2026.
const dataDir = resolve(__dirname, "../public/data");
const data = createData(dataDir);
const tools = createTools(data);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const climate = data.climate("015146").climate!;
const file = (p: ProjectInput) => JSON.stringify(toProjectFile(p, climate));
const run = async (name: string, args: Record<string, unknown>) => tool(name).run(args);

/** Il calcolo del sito: lo stesso esecutore del Web Worker, con il clima preparato come nella pagina. */
function siteEvaluation(p: ProjectInput) {
  const site: ClimatePackage = prepareClimate(readPublicJson("packages/015146.json"), readPublicJson("gradi-giorno.json") as never, "015146").climate;
  const runtime = createEngineRuntime();
  let out: EngineResponse | null = null;
  runtime({ id: 0, type: "climate", climate: site }, () => {});
  runtime({ id: 1, type: "evaluate", input: { project: p, climateId: "015146" } }, (r) => { out = r; });
  const r = out as EngineResponse | null;
  if (!r || r.type !== "result" || r.kind !== "evaluate") throw new Error("calcolo del sito non riuscito");
  return r.result;
}

describe("protocollo MCP scritto a mano", () => {
  const echo: ToolDef = { name: "eco", title: "Eco", description: "", inputSchema: { type: "object" }, annotations: {}, run: (a) => ({ text: `eco ${String(a.x)}`, structured: { x: a.x } }) };
  const boom: ToolDef = { ...echo, name: "rotto", run: () => { throw new Error("guasto"); } };
  const handler = () => createHandler({ name: "t", title: "T", version: "0", instructions: "i" }, [echo, boom]);
  const req = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });

  it("concorda la versione, risponde a ping e notifiche, elenca gli strumenti senza il codice", async () => {
    const h = handler();
    expect(((await h(req(1, "initialize", { protocolVersion: "2024-11-05" }))) as Response).result).toMatchObject({ protocolVersion: "2024-11-05", serverInfo: { name: "t" }, capabilities: { tools: {} } });
    expect(((await handler()(req(1, "initialize", { protocolVersion: "1999-01-01" }))) as Response).result).toMatchObject({ protocolVersion: PROTOCOL_VERSIONS[0] });
    expect(await h({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await h(req(2, "ping"))).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    const list = ((await h(req(3, "tools/list"))) as Response).result as { tools: Record<string, unknown>[] };
    expect(list.tools.map((t) => t.name)).toEqual(["eco", "rotto"]);
    expect(list.tools[0]).not.toHaveProperty("run");
  });

  it("errori del protocollo con i codici JSON-RPC; un guasto dello strumento diventa isError", async () => {
    const h = handler();
    expect(((await h(req(1, "tools/call", { name: "nessuno" }))) as Response).error?.code).toBe(-32602);
    expect(((await h(req(2, "tools/call", { name: "eco", arguments: [1] }))) as Response).error?.code).toBe(-32602);
    expect(((await h(req(3, "resources/list"))) as Response).error?.code).toBe(-32601);
    expect(((await h([req(4, "ping")])) as Response).error?.code).toBe(-32600);
    expect(((await h({ jsonrpc: "1.0", id: 5, method: "ping" })) as Response).error?.code).toBe(-32600);
    const broken = ((await h(req(6, "tools/call", { name: "rotto" }))) as Response).result as { isError: boolean; content: { text: string }[] };
    expect(broken.isError).toBe(true);
    expect(broken.content[0].text).toContain("guasto");
  });

  it("structuredContent dalla versione 2025-06-18; prima il JSON va in un secondo blocco di testo", async () => {
    const recent = handler();
    await recent(req(1, "initialize", { protocolVersion: "2025-06-18" }));
    expect(((await recent(req(2, "tools/call", { name: "eco", arguments: { x: 7 } }))) as Response).result).toEqual({ content: [{ type: "text", text: "eco 7" }], structuredContent: { x: 7 }, isError: false });
    const old = handler();
    await old(req(1, "initialize", { protocolVersion: "2024-11-05" }));
    expect(((await old(req(2, "tools/call", { name: "eco", arguments: { x: 7 } }))) as Response).result).toEqual({ content: [{ type: "text", text: "eco 7" }, { type: "text", text: "{\"x\":7}" }], isError: false });
  });

  it("su stdio: una risposta per riga, nell'ordine, e JSON rotto con -32700", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: unknown[] = [];
    output.on("data", (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach((l) => lines.push(JSON.parse(l))));
    serveStdio(handler(), input, output);
    input.write(JSON.stringify(req(1, "ping")) + "\n{rotto\n" + JSON.stringify(req(2, "tools/call", { name: "eco", arguments: { x: 1 } })) + "\n");
    input.end();
    await new Promise((r) => setTimeout(r, 50));
    expect(lines.map((l) => (l as Response).id)).toEqual([1, null, 2]);
    expect((lines[1] as Response).error?.code).toBe(-32700);
  });
});

describe("controlla_progetto e valuta_progetto", () => {
  it("valuta_progetto dà gli stessi numeri e la stessa frase del sito", async () => {
    for (const goal of ["completo", "fv", "pdc"] as const) {
      const p = exampleProject();
      p.goal = goal;
      const out = await run("valuta_progetto", { contenuto: file(p) });
      expect(out.isError, goal).toBeFalsy();
      const site = evaluationForGoal(siteEvaluation(p), p.goal, p);
      const s = out.structured as { pacchetti: { id: string; van_euro: number | null; spesa_annua_euro: number }[]; verdetto: { frase: string } };
      expect(s.pacchetti.map((r) => r.id), goal).toEqual(site.packages.map((r) => r.id));
      expect(s.pacchetti.map((r) => r.van_euro), goal).toEqual(site.packages.map((r) => r.id === "base" ? null : Math.round(r.cash!.npv)));
      expect(s.pacchetti.map((r) => r.spesa_annua_euro), goal).toEqual(site.packages.map((r) => Math.round(r.costs.total)));
      expect(s.verdetto.frase, goal).toBe(verdettoFrase(verdetto(site, p, null)!, site, p));
      expect(out.text).toContain(s.verdetto.frase);
    }
  });

  it("ogni risposta porta motore, clima, domanda, stato dei dati, limiti e avvertenza", async () => {
    const p = exampleProject();
    for (const name of ["controlla_progetto", "valuta_progetto"]) {
      const out = await run(name, { contenuto: file(p) });
      expect(out.structured, name).toMatchObject({ motore: ENGINE_VERSION, clima: { codice: "015146", capoluogo: "Milano", zona: "E" }, domanda: goalInfo(p.goal).question, avvertenza: AVVERTENZA });
      const stato = out.structured.stato_dei_dati as { ipotizzati: number; nota: string };
      expect(stato.ipotizzati, name).toBeGreaterThan(0);
      expect(stato.nota).toBe(NOTA_STATO);
      expect(out.structured.limiti as string).toContain("non un investimento raccomandato");
      for (const part of [AVVERTENZA, NOTA_STATO, "Limiti del modello:", ENGINE_VERSION]) expect(out.text, `${name}: ${part}`).toContain(part);
    }
  });

  it("nessun dato personale: nome, comune, codice ISTAT, preventivi, email e POD restano fuori", async () => {
    const p = exampleProject();
    const comuni = data.comuni()!;
    p.location = locationFromComune(comuneByCode("015209", comuni)!); // Sesto San Giovanni, clima di Milano
    p.name = "Casa di Mario Rossi, mario.rossi@example.com";
    p.windows.cost.name = "Offerta Serramenti Bianchi";
    p.windows.cost.supplier = "Bianchi Infissi srl";
    p.consumption.electricityKwh.source = "bolletta POD IT001E12345678";
    for (const name of ["controlla_progetto", "valuta_progetto"]) {
      const out = await run(name, { contenuto: file(p) });
      const all = out.text + JSON.stringify(out.structured);
      for (const secret of ["Mario Rossi", "mario.rossi@example.com", "Sesto San Giovanni", "015209", "Bianchi", "IT001E12345678"]) expect(all, `${name}: ${secret}`).not.toContain(secret);
      expect(all).toContain("Milano"); // il capoluogo del clima resta
    }
  });

  it("un progetto con errori: controlla li elenca, valuta non dà risultati", async () => {
    const p = exampleProject();
    p.building.floorArea.value = -5;
    const check = await run("controlla_progetto", { contenuto: file(p) });
    const value = await run("valuta_progetto", { contenuto: file(p) });
    // Un valore fisicamente impossibile blocca già l'apertura, come nel sito.
    for (const out of [check, value]) {
      expect(out.isError).toBe(true);
      expect(out.structured.file_valido).toBe(false);
      expect(out.text).toMatch(/Il file non si apre/);
    }
  });

  it("legge il file dal percorso, solo .json, e rifiuta ingressi ambigui o non validi", async () => {
    const dir = mkdtempSync(join(tmpdir(), "casa-mcp-"));
    const path = join(dir, "progetto.json");
    writeFileSync(path, file(exampleProject()));
    expect((await run("controlla_progetto", { percorso: path })).isError).toBeFalsy();
    const errors = async (args: Record<string, unknown>) => { const o = await run("controlla_progetto", args); expect(o.isError).toBe(true); return o.text; };
    expect(await errors({})).toMatch(/percorso.*contenuto/);
    expect(await errors({ percorso: path, contenuto: "{}" })).toMatch(/uno dei tre/);
    expect(await errors({ percorso: join(dir, "progetto.txt") })).toMatch(/\.json/);
    expect(await errors({ percorso: join(dir, "manca.json") })).toMatch(/non trovato/);
    expect(await errors({ contenuto: "x".repeat(2_000_001) })).toMatch(/troppo grande/);
    expect(await errors({ contenuto: "{non json" })).toMatch(/JSON valido/);
    expect(await errors({ contenuto: JSON.stringify({ formato: "profilo-energetico", versione: 1 }) })).toMatch(/profilo energetico/);
  });

  it("gli strumenti si dichiarano di sola lettura e senza accesso esterno", () => {
    expect(tools.map((t) => t.name)).toEqual(["controlla_progetto", "valuta_progetto", "crea_progetto", "prova_variante", "sensibilita", "piano_nel_tempo", "confronta_preventivi", "scrivi_profilo"]);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });
});
