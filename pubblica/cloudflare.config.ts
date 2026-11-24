import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Casa è un sito statico: un Worker con i file di ../dist (vite.config.ts, publicDir) su casa.raccasamuele.it,
// pubblicato con la CLI cf, come il sito della CER e il portale. I file (pagina e pacchetti clima) li servono gli
// static assets, senza consumare richieste del Worker; il codice risponde solo ai percorsi che non esistono.
export default defineConfig({
  worker: {
    name: "casa-sito",
    compatibilityDate: "2026-10-06",
    entrypoint,
    workersDev: false,
    domains: ["casa.raccasamuele.it"],
    assets: { notFoundHandling: "none" },
  },
});
