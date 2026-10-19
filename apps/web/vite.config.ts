import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.SKYSCORE_API ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/docs": { target: api, changeOrigin: true },
      "/openapi.json": { target: api, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
