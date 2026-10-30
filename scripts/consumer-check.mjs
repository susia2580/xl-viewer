// Packs @xl-viewer/core, installs it into throwaway Vite and webpack 5 apps,
// and checks in a browser that the inline worker and `workerUrl` both work.
import { execFileSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(".");
const work = resolve(".consumer-tmp");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();

run("pnpm", ["--filter", "@xl-viewer/core", "build"], root);
const tgz = run("pnpm", ["pack", "--pack-destination", work], resolve("packages/core")).trim().split("\n").pop();
const tarball = resolve(work, tgz.split("/").pop());

const page = `import { createViewer } from "@xl-viewer/core";
const params = new URLSearchParams(location.search);
const warnings = [];
const viewer = createViewer(document.getElementById("app"), {
  workerUrl: params.get("worker") || undefined,
  onWarning: (w) => warnings.push(w.code),
});
fetch("./sample.xlsx")
  .then((r) => r.arrayBuffer())
  .then((b) => viewer.open(b))
  .then(
    () => { window.__result = { ok: true, warnings, sheets: viewer.getSheetNames() }; },
    (e) => { window.__result = { ok: false, error: String(e) }; },
  );
`;
const html = (script) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app" style="width:900px;height:500px"></div>${script}</body></html>`;

function setup(name, pkg, files) {
  const dir = join(work, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "public"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true, type: "module", ...pkg }, null, 2));
  for (const [f, content] of Object.entries(files)) writeFileSync(join(dir, f), content);
  copyFileSync(resolve("fixtures/generated/basic.xlsx"), join(dir, "public/sample.xlsx"));
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  return dir;
}

const viteDir = setup(
  "vite-app",
  { dependencies: { "@xl-viewer/core": "file:" + tarball }, devDependencies: { vite: "^8.3.5" } },
  { "index.html": html('<script type="module" src="/src/main.js"></script>'), "src/main.js": page },
);
run("npx", ["vite", "build"], viteDir);
copyFileSync(join(viteDir, "node_modules/@xl-viewer/core/dist/parser.worker.js"), join(viteDir, "dist/parser.worker.js"));

const webpackDir = setup(
  "webpack-app",
  { dependencies: { "@xl-viewer/core": "file:" + tarball }, devDependencies: { webpack: "^5.112.2", "webpack-cli": "^6.0.1" } },
  {
    "src/main.js": page,
    "webpack.config.js": `export default { mode: "production", entry: "./src/main.js", output: { path: new URL("./dist", import.meta.url).pathname, publicPath: "auto", clean: true } };`,
  },
);
run("npx", ["webpack"], webpackDir);
writeFileSync(join(webpackDir, "dist/index.html"), html('<script src="main.js"></script>'));
copyFileSync(join(webpackDir, "public/sample.xlsx"), join(webpackDir, "dist/sample.xlsx"));
copyFileSync(join(webpackDir, "node_modules/@xl-viewer/core/dist/parser.worker.js"), join(webpackDir, "dist/parser.worker.js"));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".xlsx": "application/octet-stream", ".css": "text/css" };
function serve(dir) {
  const server = createServer((req, res) => {
    const path = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

const browser = await chromium.launch({ channel: "chromium" });
let failed = false;
try {
  for (const [label, dir] of [
    ["vite", join(viteDir, "dist")],
    ["webpack 5", join(webpackDir, "dist")],
  ]) {
    const server = await serve(dir);
    const base = `http://localhost:${server.address().port}/`;
    for (const mode of ["inline", "workerUrl"]) {
      const p = await browser.newPage();
      await p.goto(base + (mode === "workerUrl" ? "?worker=./parser.worker.js" : ""));
      const result = await p.waitForFunction(() => window.__result, null, { timeout: 30000 }).then((h) => h.jsonValue());
      const charts = await p.locator(".xv-chart svg").count();
      const ok = result.ok && !result.warnings.includes("WORKER_UNAVAILABLE") && charts === 2;
      failed ||= !ok;
      console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(10)} ${mode.padEnd(10)} ${JSON.stringify({ ...result, charts })}`);
      await p.close();
    }
    server.close();
  }
} finally {
  await browser.close();
  if (!failed) rmSync(work, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
