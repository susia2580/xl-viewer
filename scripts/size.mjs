// Bundles the built packages the way an app would and checks gzip sizes
// against the budgets in docs/01-design.md section 3.5.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const BUDGET = { core: 68 * 1024, chart: 250 * 1024, vue: 3 * 1024 };
const tmp = resolve("scripts/.size-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const alias = {
  "@xl-viewer/core": resolve("packages/core/dist/index.js"),
  "@xl-viewer/vue": resolve("packages/vue/dist/index.js"),
};

async function bundle(name, code, external = []) {
  const entry = resolve(tmp, name + ".js");
  writeFileSync(entry, code);
  const out = await build({
    configFile: false,
    logLevel: "error",
    root: resolve("."),
    resolve: { alias },
    build: { write: false, minify: true, target: "es2022", rolldownOptions: { input: entry, external, output: { format: "es" } } },
  });
  return (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((o) => o.type === "chunk");
}

const gz = (code) => gzipSync(code, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + " KB";

try {
  const core = await bundle(
    "core",
    `import { createViewer } from "@xl-viewer/core";\ncreateViewer(document.body).open(new ArrayBuffer(8));\n`,
  );
  const entry = core.find((c) => c.isEntry);
  const has = (c, part) => c.moduleIds.some((id) => id.includes(part));
  const chart = core.filter((c) => !c.isEntry && has(c, "/echarts/"));
  const parser = core.filter((c) => !c.isEntry && !chart.includes(c));
  const coreSize = gz(entry.code);
  const chartSize = chart.reduce((s, c) => s + gz(c.code), 0);
  const vue = await bundle("vue", `import { XlViewer } from "@xl-viewer/vue";\nconsole.log(XlViewer);\n`, ["vue", /^@xl-viewer\/core/]);
  const vueSize = gz(vue.find((c) => c.isEntry).code);

  const rows = [
    ["core (parser worker inlined, no charts)", coreSize, BUDGET.core],
    ["chart chunk (ECharts modules)", chartSize, BUDGET.chart],
    ["vue wrapper", vueSize, BUDGET.vue],
  ];
  let failed = false;
  for (const [label, size, budget] of rows) {
    const ok = size <= budget;
    failed ||= !ok;
    console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(42)} ${kb(size).padStart(9)} / ${kb(budget)}`);
  }
  for (const c of parser)
    console.log(`info main-thread fallback chunk ${c.fileName.padEnd(26)} ${kb(gz(c.code)).padStart(9)} (loaded only if the worker fails)`);
  if (failed) process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
