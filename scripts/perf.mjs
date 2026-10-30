// Measures parse time and paint time for the 100k-row fixture in a real browser.
// Generate the file first: pnpm fixtures -- --large
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const FILE = "generated/perf/large-100k.xlsx";
if (!existsSync(resolve("fixtures", FILE))) {
  console.error(`Missing fixtures/${FILE}. Run: pnpm fixtures -- --large`);
  process.exit(1);
}

const server = await createServer({
  configFile: resolve("apps/playground/vite.config.ts"),
  root: resolve("apps/playground"),
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://localhost:${server.config.server.port}/?fixture=generated/basic.xlsx`);
  await page.waitForFunction(() => window.__xlViewer?.ready === true);
  const result = await page.evaluate(async (file) => {
    const viewer = window.__xlViewer.viewer;
    const buf = await (await fetch("/" + file)).arrayBuffer();
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await viewer.open(buf.slice(0));
      runs.push(performance.now() - t0);
    }
    const scroller = document.querySelector(".xv-scroll");
    const frames = [];
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (let i = 0; i < 120; i++) {
      scroller.scrollTop += 400 + (i % 7) * 37;
      scroller.scrollLeft = (i % 10) * 120;
      await nextFrame();
      frames.push(viewer.getStats().frameMs);
    }
    frames.sort((a, b) => a - b);
    return {
      openMs: runs,
      frameAvg: frames.reduce((a, b) => a + b, 0) / frames.length,
      frameP95: frames[Math.floor(frames.length * 0.95)],
      frameMax: frames[frames.length - 1],
      hitRate: viewer.getStats().measureHitRate,
    };
  }, FILE);
  const fmt = (n) => n.toFixed(1);
  console.log(`open (parse + first paint), 3 runs: ${result.openMs.map(fmt).join(", ")} ms`);
  console.log(
    `paint per frame at 1920x1080: avg ${fmt(result.frameAvg)} ms, p95 ${fmt(result.frameP95)} ms, max ${fmt(result.frameMax)} ms`,
  );
  console.log(`text measure cache hit rate: ${(result.hitRate * 100).toFixed(0)}%`);
} finally {
  await browser.close();
  await server.close();
}
