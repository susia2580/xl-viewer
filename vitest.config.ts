import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { xlViewerWorker } from "./packages/core/build/worker-plugin.ts";

export default defineConfig({
  plugins: [vue(), xlViewerWorker()],
  resolve: {
    alias: [{ find: /^@xl-viewer\/core$/, replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) }],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
    },
  },
});
