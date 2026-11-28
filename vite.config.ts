/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // Il runtime React separato mantiene il file principale sotto 500 kB.
        manualChunks: (id) => /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? "react" : undefined,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // Vitest 5 fa scadere anche i test sincroni lenti (Vitest 2 li lasciava finire): i calcoli orari
    // sulla casa intera superano i 5 s predefiniti, quindi il limite resta largo come prima.
    testTimeout: 120_000,
  },
});
