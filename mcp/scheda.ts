import html from "./scheda.html?raw";
import type { ResourceDef } from "./protocollo";

/**
 * Scheda nella chat (MCP Apps, estensione `io.modelcontextprotocol/ui`, specifica stabile 2026-01-26): i client che la
 * supportano (Claude Desktop, claude.ai) mostrano `scheda.html` insieme al risultato di crea_progetto e
 * valuta_progetto. Gli altri client la ignorano e usano il testo, che resta completo.
 */
export const SCHEDA_URI = "ui://casa/scheda.html";
export const MIME_MCP_APP = "text/html;profile=mcp-app";

/** Da mettere nel `_meta` di uno strumento. La chiave piatta «ui/resourceUri» è quella vecchia, per i client di prima. */
export const SCHEDA_META = { ui: { resourceUri: SCHEDA_URI }, "ui/resourceUri": SCHEDA_URI };

export const SCHEDA: ResourceDef = {
  uri: SCHEDA_URI,
  name: "scheda",
  title: "Scheda di Casa",
  description: "Riquadro con verdetto, numeri principali, stato dei dati, limiti e avvertenza di un progetto di Casa.",
  mimeType: MIME_MCP_APP,
  // Nessun accesso alla rete né a risorse esterne: la CSP predefinita del client basta. Il bordo è già nella scheda.
  _meta: { ui: { prefersBorder: false } },
  text: () => html,
};
