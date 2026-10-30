import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The sales report is not committed; its cases run only where the file exists.
const hasSales = existsSync(new URL("../../../fixtures/excel/sales-report.xlsx", import.meta.url));

async function open(page: Page, fixture: string, sheet = 0) {
  await page.goto(`/?fixture=${encodeURIComponent(fixture)}&sheet=${sheet}&lang=ko`);
  await page.waitForFunction(() => (window as unknown as { __xlViewer?: { ready?: boolean } }).__xlViewer?.ready === true);
  // Let charts load and fonts settle.
  await page.waitForTimeout(500);
}

const CASES: [string, number][] = [
  ["excel/sales-report.xlsx", 0],
  ["excel/sales-report.xlsx", 1],
  ["numbers/sales-report.xlsx", 0],
  ["generated/basic.xlsx", 0],
  ["generated/number-formats.xlsx", 0],
  ["generated/borders.xlsx", 0],
  ["generated/merges.xlsx", 0],
  ["generated/text.xlsx", 0],
  ["generated/freeze.xlsx", 0],
  ["generated/freeze-rows-only.xlsx", 0],
  ["generated/notes-images.xlsx", 0],
  ["generated/charts.xlsx", 0],
  ["generated/conditional.xlsx", 0],
];

for (const [fixture, sheet] of CASES) {
  const run = fixture.includes("sales-report") && !hasSales ? test.skip : test;
  run(`${fixture} sheet ${sheet}`, async ({ page }) => {
    await open(page, fixture, sheet);
    await expect(page.locator(".viewer")).toHaveScreenshot(`${fixture.replace(/[/.]/g, "_")}-${sheet}.png`);
  });
}

const salesTest = hasSales ? test : test.skip;

salesTest("note shows on hover", async ({ page }) => {
  await open(page, "excel/sales-report.xlsx");
  const box = await page.locator(".viewer").boundingBox();
  await page.mouse.move(box!.x + 260, box!.y + 32);
  await expect(page.locator(".xv-note")).toBeVisible();
  await expect(page.locator(".xv-note")).toContainText("해당 월·채널의 매출 금액");
  await expect(page.locator(".viewer")).toHaveScreenshot("sales-report-note-C1.png");
});

test("frozen panes stay in place while scrolling", async ({ page }) => {
  await open(page, "generated/freeze.xlsx");
  await page.locator(".xv-scroll").evaluate((el) => el.scrollTo(600, 900));
  await page.waitForTimeout(200);
  await expect(page.locator(".viewer")).toHaveScreenshot("freeze-scrolled.png");
});

test("frozen rows keep their row numbers when scrolled", async ({ page }) => {
  await open(page, "generated/freeze-rows-only.xlsx");
  await page.locator(".xv-scroll").evaluate((el) => el.scrollTo(0, 400));
  await page.waitForTimeout(200);
  await expect(page.locator(".viewer")).toHaveScreenshot("freeze-rows-only-scrolled.png");
});

salesTest("sheet tabs switch sheets", async ({ page }) => {
  await open(page, "excel/sales-report.xlsx");
  await page.getByRole("tab", { name: "항목정의" }).click();
  await expect(page.getByRole("tab", { name: "항목정의" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".xv-grid")).toHaveAttribute("aria-label", /항목정의/);
});
