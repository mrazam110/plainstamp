import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), about: resolve(__dirname, "about.html"), privacy: resolve(__dirname, "privacy.html") } },
  },
});
