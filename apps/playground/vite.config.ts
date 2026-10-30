import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { xlViewerWorker } from "../../packages/core/build/worker-plugin.ts";

const root = (p: string) => fileURLToPath(new URL("../../" + p, import.meta.url));

export default defineConfig({
  base: process.env.PLAYGROUND_BASE ?? "/",
  plugins: [vue(), xlViewerWorker()],
  resolve: {
    alias: [
      { find: /^@xl-viewer\/core\/styles\.css$/, replacement: root("packages/core/styles/xl-viewer.css") },
      { find: /^@xl-viewer\/core\/locales\/(.*)$/, replacement: root("packages/core/src/locales/$1.ts") },
      { find: /^@xl-viewer\/core$/, replacement: root("packages/core/src/index.ts") },
      { find: /^@xl-viewer\/vue$/, replacement: root("packages/vue/src/index.ts") },
    ],
  },
  publicDir: root("fixtures"),
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  // The ECharts chunk is large by nature and only loads for sheets with charts.
  build: { chunkSizeWarningLimit: 700 },
});
