import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION } from "../src/engine";
import { createData } from "./dati";
import { createHandler, serveStdio, type ServerInfo } from "./protocollo";
import { SCHEDA } from "./scheda";
import { createTools } from "./strumenti";

/**
 * Server MCP di Casa: gira sul computer di chi lo usa e parla con l'agente da stdin e stdout.
 * Uso: node dist-mcp/casa-mcp.mjs [--dati <cartella public/data>] [--sito <indirizzo del sito per «Apri in Casa»>]
 */
export const INFO: ServerInfo = {
  name: "casa",
  title: "Casa: interventi energetici",
  version: ENGINE_VERSION,
  instructions: "Strumenti di Casa (casa.raccasamuele.it) su un file del progetto salvato dal sito. Gira sul computer dell'utente e non modifica file. Riporta sempre insieme ai numeri lo stato dei dati, i limiti del modello e l'avvertenza. Quando puoi, passa il percorso del file invece del contenuto. Nei client che la supportano (Claude Desktop, claude.ai) ogni strumento mostra anche una scheda di Casa nella chat: per far vedere i risultati all'utente chiama lo strumento, per esempio valuta_progetto con il progetto_id subito dopo crea_progetto, invece di riassumerli a parole o di aprire il sito nel browser. Il link «Apri in Casa» lo apre l'utente dal pulsante della scheda.",
};

function dataDir(argv: string[]): string {
  const i = argv.indexOf("--dati");
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]);
  return resolve(dirname(fileURLToPath(import.meta.url)), "../public/data");
}

const argv = process.argv.slice(2);
const dir = dataDir(argv);
const sitoAt = argv.indexOf("--sito");
const sito = sitoAt >= 0 && /^https?:\/\//.test(argv[sitoAt + 1] ?? "") ? argv[sitoAt + 1] : undefined;
serveStdio(createHandler(INFO, createTools(createData(dir), { sito }), [SCHEDA]));
process.stderr.write(`casa-mcp ${ENGINE_VERSION}: dati in ${dir}\n`);
