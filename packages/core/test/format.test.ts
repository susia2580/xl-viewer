import { describe, expect, it } from "vitest";
import { cellName, colName, parseCellRef, parseRange, parseSheetRange } from "../src/format/address";
import { applyTint, normalizeRgb, resolveColor, themeSlot } from "../src/format/color";
import { NumberFormatter } from "../src/format/number";
import { colWidthToPx, ptToPx } from "../src/format/units";
import { excelScale } from "../src/chart/scale";

describe("address", () => {
  it("parses refs", () => {
    expect(parseCellRef("A1")).toEqual({ row: 0, col: 0 });
    expect(parseCellRef("$AB$12")).toEqual({ row: 11, col: 27 });
    expect(parseCellRef("XFD1048576")).toEqual({ row: 1048575, col: 16383 });
    expect(parseCellRef("A0")).toBeNull();
    expect(parseCellRef("1A")).toBeNull();
  });
  it("names columns", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colName(26)).toBe("AA");
    expect(colName(16383)).toBe("XFD");
    expect(cellName(2, 1)).toBe("B3");
  });
  it("parses ranges and sheet references", () => {
    expect(parseRange("B2:A1")).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(parseRange("$C:$C")).toEqual({ r1: 0, c1: 2, r2: 1048575, c2: 2 });
    expect(parseSheetRange("'It''s'!$A$1:$A$3")).toEqual({ sheet: "It's", range: { r1: 0, c1: 0, r2: 2, c2: 0 } });
    expect(parseSheetRange("매출현황!$B$26:$B$32")).toEqual({ sheet: "매출현황", range: { r1: 25, c1: 1, r2: 31, c2: 1 } });
    expect(parseSheetRange("A1:B2")).toEqual({ range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
  });
});

describe("color", () => {
  it("swaps the first theme pairs", () => {
    expect([0, 1, 2, 3, 4].map(themeSlot)).toEqual([1, 0, 3, 2, 4]);
  });
  it("drops alpha", () => {
    expect(normalizeRgb("FF1F4E78")).toBe("#1F4E78");
  });
  it("applies tint", () => {
    expect(applyTint("#000000", 0.5)).toBe("#808080");
    expect(applyTint("#FFFFFF", -0.5)).toBe("#808080");
  });
  it("resolves theme and indexed colours", () => {
    const ctx = { theme: ["#000000", "#FFFFFF", "#111111", "#EEEEEE", "#4472C4"], indexed: [] };
    expect(resolveColor({ theme: 1 }, ctx)).toBe("#000000");
    expect(resolveColor({ theme: 4 }, ctx)).toBe("#4472C4");
    expect(resolveColor({ indexed: 2 }, ctx)).toBe("#FF0000");
    expect(resolveColor({ auto: true }, ctx, "#000000")).toBe("#000000");
  });
});

describe("units", () => {
  it("converts column widths like Excel", () => {
    expect(colWidthToPx(9.140625, 7)).toBe(64);
    expect(colWidthToPx(12, 7)).toBe(84);
    expect(ptToPx(15)).toBe(20);
  });
});

describe("number formats", () => {
  const f = new NumberFormatter("ko-KR", false);
  it("formats common codes", () => {
    expect(f.formatNumber("#,##0", 1234.5).text).toBe("1,235");
    expect(f.formatNumber("0.00%", 0.1234).text).toBe("12.34%");
    expect(f.formatNumber("yyyy-mm-dd", 46323).text).toBe("2026-10-28");
    expect(f.formatNumber("General", 123456789012).text).toBe("1.23457E+11");
    expect(f.formatNumber("yyyy-mm-dd", 60).text).toBe("1900-02-29");
  });
  it("returns section colours", () => {
    expect(f.formatNumber("#,##0;[Red]-#,##0", -5)).toEqual({ text: "-5", color: "#FF0000" });
  });
  it("uses the 1904 date system", () => {
    expect(new NumberFormatter("en-US", true).formatNumber("yyyy-mm-dd", 0).text).toBe("1904-01-01");
  });
});

describe("chart scale", () => {
  it("matches the Excel axes of the sales report", () => {
    expect(excelScale(0, 1750, { majorUnit: 450 })).toEqual({ min: 0, max: 2250, interval: 450 });
    expect(excelScale(0, 8840, { majorUnit: 2250 })).toEqual({ min: 0, max: 11250, interval: 2250 });
  });
  it("picks a nice unit when none is set", () => {
    expect(excelScale(0, 87, {}).interval).toBe(20);
  });
});
