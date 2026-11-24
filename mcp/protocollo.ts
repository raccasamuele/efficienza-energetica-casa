import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/**
 * Strato minimo del Model Context Protocol (MCP) su stdio, scritto a mano: nessuna dipendenza nuova.
 * Messaggi JSON-RPC 2.0, uno per riga. Metodi: initialize, ping, tools/list, tools/call, resources/list,
 * resources/templates/list, resources/read; le notifiche ricevute si ignorano. Se la chiamata porta `_meta.progressToken`, gli strumenti lunghi mandano `notifications/progress`.
 */

/** Dalla più recente: si risponde con quella chiesta dal client se la conosciamo, altrimenti con la prima. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** Da questa versione i risultati possono avere `structuredContent`. */
const STRUCTURED_FROM = "2025-06-18";

export interface ToolOutput {
  /** Testo in italiano, da citare così com'è. */
  text: string;
  structured: Record<string, unknown>;
  isError?: boolean;
}

/** Avanzamento di uno strumento lungo: passi fatti, passi in tutto, frase breve. */
export type Progress = (done: number, total: number, message?: string) => void;

export interface ToolContext { progress?: Progress }

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  /** Es. `ui.resourceUri`: la scheda MCP Apps che il client mostra nella chat con il risultato. */
  _meta?: Record<string, unknown>;
  run: (args: Record<string, unknown>, context?: ToolContext) => ToolOutput | Promise<ToolOutput>;
}

/** Risorsa di sola lettura, es. la scheda HTML di MCP Apps (`ui://…`). */
export interface ResourceDef {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  _meta?: Record<string, unknown>;
  text: () => string;
}

export interface ServerInfo { name: string; title: string; version: string; instructions: string }

type Id = string | number;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
export type Response = { jsonrpc: "2.0"; id: Id | null; result?: unknown; error?: { code: number; message: string } };
export type Notification = { jsonrpc: "2.0"; method: string; params: Record<string, unknown> };

const isId = (v: unknown): v is Id => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
const ok = (id: Id, result: unknown): Response => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id | null, code: number, message: string): Response => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Gestore dei messaggi: restituisce la risposta, o null per le notifiche. */
export function createHandler(info: ServerInfo, tools: ToolDef[], resources: ResourceDef[] = []) {
  let version = PROTOCOL_VERSIONS[0];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const byUri = new Map(resources.map((r) => [r.uri, r]));

  return async function handle(raw: unknown, notify?: (n: Notification) => void): Promise<Response | null> {
    if (Array.isArray(raw)) return fail(null, -32600, "Richieste multiple non supportate.");
    const msg = (raw && typeof raw === "object" ? raw : {}) as Message;
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isId(msg.id) ? fail(msg.id, -32600, "Richiesta JSON-RPC non valida.") : null;
    if (msg.id === undefined) return null; // notifica (es. notifications/initialized)
    if (!isId(msg.id)) return fail(null, -32600, "Identificativo della richiesta non valido.");
    const id = msg.id;
    const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;
    // Senza risorse i metodi resources/* restano non supportati, come prima della scheda nella chat.
    if (!resources.length && msg.method.startsWith("resources/")) return fail(id, -32601, `Metodo non supportato: ${msg.method.slice(0, 60)}.`);
    switch (msg.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        version = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return ok(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false }, ...(resources.length ? { resources: { listChanged: false } } : {}) },
          serverInfo: { name: info.name, title: info.title, version: info.version },
          instructions: info.instructions,
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: tools.map(({ run: _run, ...def }) => def) });
      case "resources/list":
        return ok(id, { resources: resources.map(({ text: _text, _meta: _m, ...def }) => def) });
      case "resources/templates/list":
        return ok(id, { resourceTemplates: [] });
      case "resources/read": {
        const res = typeof params.uri === "string" ? byUri.get(params.uri) : undefined;
        if (!res) return fail(id, -32002, `Risorsa sconosciuta: ${String(params.uri).slice(0, 80)}.`);
        return ok(id, { contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text(), ...(res._meta ? { _meta: res._meta } : {}) }] });
      }
      case "tools/call": {
        const tool = typeof params.name === "string" ? byName.get(params.name) : undefined;
        if (!tool) return fail(id, -32602, `Strumento sconosciuto: ${String(params.name).slice(0, 60)}.`);
        const args = params.arguments ?? {};
        if (!args || typeof args !== "object" || Array.isArray(args)) return fail(id, -32602, "Gli argomenti devono essere un oggetto.");
        const meta = (params._meta && typeof params._meta === "object" ? params._meta : {}) as Record<string, unknown>;
        const token = meta.progressToken;
        let last = 0;
        const progress = notify && isId(token) ? (done: number, total: number, message?: string) => {
          // L'avanzamento deve crescere a ogni notifica.
          if (!(done > last)) return;
          last = done;
          notify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: done, total, ...(message ? { message } : {}) } });
        } : undefined;
        let out: ToolOutput;
        try {
          out = await tool.run(args as Record<string, unknown>, { progress });
        } catch (e: unknown) {
          out = { text: `Errore interno dello strumento: ${e instanceof Error ? e.message : String(e)}`, structured: {}, isError: true };
        }
        const structured = version >= STRUCTURED_FROM;
        return ok(id, {
          content: structured ? [{ type: "text", text: out.text }] : [{ type: "text", text: out.text }, { type: "text", text: JSON.stringify(out.structured) }],
          ...(structured ? { structuredContent: out.structured } : {}),
          isError: out.isError === true,
        });
      }
      default:
        return fail(id, -32601, `Metodo non supportato: ${msg.method.slice(0, 60)}.`);
    }
  };
}

/** Collega il gestore a stdin e stdout. Su stdout passano solo i messaggi del protocollo. */
export function serveStdio(handle: (raw: unknown, notify?: (n: Notification) => void) => Promise<Response | null>, input: Readable = process.stdin, output: Writable = process.stdout) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    // In ordine: le risposte escono nell'ordine delle richieste.
    queue = queue.then(async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        output.write(JSON.stringify(fail(null, -32700, "Messaggio non leggibile: JSON non valido.")) + "\n");
        return;
      }
      const response = await handle(raw, (n) => output.write(JSON.stringify(n) + "\n"));
      if (response) output.write(JSON.stringify(response) + "\n");
    });
  });
  return lines;
}
