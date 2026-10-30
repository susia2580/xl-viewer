import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";

const VIRTUAL_ID = "virtual:xl-viewer-worker";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ENTRY = fileURLToPath(new URL("../src/worker/parser.worker.ts", import.meta.url));

/** Bundles the parser worker into one classic script, with all dependencies inlined. */
export async function bundleWorker(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    build: {
      write: false,
      minify: true,
      target: "es2022",
      lib: { entry: ENTRY, formats: ["iife"], name: "XlViewerParserWorker", fileName: () => "parser.worker.js" },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ("output" in r ? r.output : []));
  const chunk = outputs.find((o) => o.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("Worker bundle produced no chunk");
  return chunk.code;
}

/**
 * Provides `virtual:xl-viewer-worker` (the worker source as a string) and,
 * in library builds, also emits it as `parser.worker.js` for `workerUrl`.
 */
export function xlViewerWorker(options: { emit?: boolean } = {}): Plugin {
  let source: Promise<string> | undefined;
  return {
    name: "xl-viewer-worker",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined;
      source ??= bundleWorker();
      const code = await source;
      if (options.emit) this.emitFile({ type: "asset", fileName: "parser.worker.js", source: code });
      return `export default ${JSON.stringify(code)};`;
    },
    // Re-bundle when worker sources change during dev.
    handleHotUpdate(ctx) {
      if (ctx.file.includes("/packages/core/src/")) source = undefined;
    },
  };
}
