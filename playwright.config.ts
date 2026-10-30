import { defineConfig, devices } from "@playwright/test";

// Baselines are only valid from the Linux container (scripts/visual-docker.sh),
// where fonts are pinned. See docs/01-design.md section 12.3.
export default defineConfig({
  testDir: "apps/playground/tests",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" },
  },
  use: {
    baseURL: "http://localhost:5199",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: "pnpm --filter playground dev",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
  },
});
