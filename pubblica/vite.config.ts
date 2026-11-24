import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// I file di Casa sono la build della radice (npm run build là): qui si pubblicano così come sono.
export default defineConfig({
  plugins: [cloudflare()],
  publicDir: process.env.SITO_DIST ?? "../dist",
});
