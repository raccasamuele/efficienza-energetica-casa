/// <reference types="vitest" />
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
  },
});
