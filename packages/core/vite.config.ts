import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { xlViewerWorker } from "./build/worker-plugin.ts";

const src = (p: string) => fileURLToPath(new URL("./src/" + p, import.meta.url));

export default defineConfig({
  plugins: [
    xlViewerWorker({ emit: true }),
    {
      name: "xl-viewer-css",
      writeBundle() {
        mkdirSync("dist", { recursive: true });
        copyFileSync("styles/xl-viewer.css", "dist/xl-viewer.css");
      },
    },
  ],
  build: {
    target: "es2022",
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    lib: {
      entry: {
        index: src("index.ts"),
        "locales/en": src("locales/en.ts"),
        "locales/ko": src("locales/ko.ts"),
      },
      formats: ["es"],
    },
    rolldownOptions: {
      external: [/^echarts(\/.*)?$/, "fflate", "numfmt"],
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
