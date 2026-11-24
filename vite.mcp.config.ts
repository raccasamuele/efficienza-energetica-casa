import { defineConfig } from "vite";

/** Server MCP per agenti AI: un solo file per Node, con il motore dentro (docs/ecosistema/GUIDA-MCP.md). */
export default defineConfig({
  publicDir: false,
  logLevel: "warn",
  ssr: { noExternal: true },
  build: {
    ssr: "mcp/server.ts",
    outDir: "dist-mcp",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: { output: { entryFileNames: "casa-mcp.mjs" } },
  },
});
