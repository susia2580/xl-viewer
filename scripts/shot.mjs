// Renders a fixture in the playground and saves a PNG.
// Usage: pnpm shot <fixture> [--sheet N] [--mouse x,y] [--size 1280x800] [--browser chromium|firefox|webkit] [--out file]
import { mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "@playwright/test";
import { createServer } from "vite";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sheet: { type: "string", default: "0" },
    mouse: { type: "string" },
    scroll: { type: "string" },
    size: { type: "string", default: "1280x800" },
    browser: { type: "string", default: "chromium" },
    out: { type: "string" },
    dpr: { type: "string", default: "1" },
    lang: { type: "string", default: "ko" },
  },
});

const fixture = positionals[0] ?? "generated/basic.xlsx";
const [width, height] = values.size.split("x").map(Number);
const out = resolve(
  values.out ??
    `.shots/${fixture.replace(/\//g, "_").replace(/\.xlsx$/, "")}.${values.sheet}${values.mouse ? ".hover" : ""}${values.scroll ? ".scrolled" : ""}.${values.browser}.png`,
);

const server = await createServer({
  configFile: resolve("apps/playground/vite.config.ts"),
  root: resolve("apps/playground"),
  logLevel: "error",
});
await server.listen();
const url = `http://localhost:${server.config.server.port}/?fixture=${encodeURIComponent(fixture)}&sheet=${values.sheet}&lang=${values.lang}`;

const engine = { chromium, firefox, webkit }[values.browser];
const browser = await engine.launch(values.browser === "chromium" ? { channel: "chromium" } : {});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(values.dpr) });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__xlViewer?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  if (values.scroll) {
    const [sx, sy] = values.scroll.split(",").map(Number);
    await page.evaluate(([x, y]) => document.querySelector(".xv-scroll")?.scrollTo(x, y), [sx, sy]);
    await page.waitForTimeout(300);
  }
  if (values.mouse) {
    // Coordinates are relative to the viewer element.
    const [x, y] = values.mouse.split(",").map(Number);
    const box = await page.locator(".viewer").boundingBox();
    await page.mouse.move((box?.x ?? 0) + x, (box?.y ?? 0) + y);
    await page.waitForTimeout(200);
  }
  mkdirSync(dirname(out), { recursive: true });
  await page.locator(".viewer").screenshot({ path: out });
  const state = await page.evaluate(() => window.__xlViewer?.error ?? "ok");
  console.log(`${basename(out)} (${state})`);
} finally {
  await browser.close();
  await server.close();
}
