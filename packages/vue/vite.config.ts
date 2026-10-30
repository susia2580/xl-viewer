import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "index",
    },
    rolldownOptions: {
      external: ["vue", /^@xl-viewer\/core/],
    },
  },
});
