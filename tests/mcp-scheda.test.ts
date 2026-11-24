import { describe, expect, it } from "vitest";
import { createHandler } from "../mcp/protocollo";
import { MIME_MCP_APP, SCHEDA, SCHEDA_URI } from "../mcp/scheda";
import { createTools } from "../mcp/strumenti";
import { createData } from "../mcp/dati";
import { resolve } from "node:path";

// Scheda nella chat (MCP Apps), chiesta da Samuele il 23/11/2026 («procedi con l'interfaccia in chat»).
const tools = createTools(createData(resolve(__dirname, "../public/data")));
const handler = () => createHandler({ name: "casa", title: "Casa", version: "0", instructions: "i" }, tools, [SCHEDA]);
const req = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params });

describe("scheda nella chat (MCP Apps)", () => {
  it("dichiara le risorse e la scheda su tutti gli strumenti", async () => {
    const h = handler();
    const init = await h(req(1, "initialize", { protocolVersion: "2025-06-18" })) as { result: { capabilities: Record<string, unknown> } };
    expect(init.result.capabilities.resources).toEqual({ listChanged: false });
    const list = await h(req(2, "tools/list")) as { result: { tools: { name: string; _meta?: { ui?: { resourceUri?: string }; "ui/resourceUri"?: string } }[] } };
    expect(list.result.tools).toHaveLength(8);
    // Samuele, 23/11/2026: con la scheda solo su due strumenti ha dovuto chiedere a Claude di aprirla.
    for (const t of list.result.tools) {
      expect(t._meta?.ui?.resourceUri).toBe(SCHEDA_URI);
      expect(t._meta?.["ui/resourceUri"]).toBe(SCHEDA_URI);
    }
  });

  it("elenca e legge la scheda con il tipo MCP Apps, senza risorse esterne", async () => {
    const h = handler();
    const list = await h(req(1, "resources/list")) as { result: { resources: Record<string, unknown>[] } };
    expect(list.result.resources).toEqual([{ uri: SCHEDA_URI, name: "scheda", title: "Scheda di Casa", description: SCHEDA.description, mimeType: MIME_MCP_APP }]);
    const read = await h(req(2, "resources/read", { uri: SCHEDA_URI })) as { result: { contents: { uri: string; mimeType: string; text: string; _meta?: unknown }[] } };
    const [c] = read.result.contents;
    expect(c.uri).toBe(SCHEDA_URI);
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c._meta).toEqual({ ui: { prefersBorder: false } });
    expect(c.text.startsWith("<!doctype html>")).toBe(true);
    // Il protocollo della scheda: avvio, risultato, link e dimensione.
    for (const m of ["ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "ui/open-link", "ui/notifications/size-changed"]) expect(c.text).toContain(`"${m}"`);
    // Nessuna risorsa esterna e nessun HTML costruito dai dati.
    expect(c.text).not.toMatch(/<(script|link|img)[^>]+(src|href)=/i);
    expect(c.text).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(c.text).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/);
  });

  it("rifiuta una risorsa sconosciuta", async () => {
    const r = await handler()(req(1, "resources/read", { uri: "ui://casa/altro.html" })) as { error: { code: number; message: string } };
    expect(r.error.code).toBe(-32002);
    const t = await handler()(req(2, "resources/templates/list")) as { result: unknown };
    expect(t.result).toEqual({ resourceTemplates: [] });
  });

  it("senza risorse il server resta com'era: niente capacità resources", async () => {
    const h = createHandler({ name: "t", title: "T", version: "0", instructions: "i" }, []);
    const init = await h(req(1, "initialize", {})) as { result: { capabilities: Record<string, unknown> } };
    expect(init.result.capabilities.resources).toBeUndefined();
    expect(((await h(req(2, "resources/list"))) as { error: { code: number } }).error.code).toBe(-32601);
  });
});
