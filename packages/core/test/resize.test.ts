import { describe, expect, it } from "vitest";
import type { ResolvedFont, ResolvedStyle, SheetModel } from "../src/model/types";
import { Painter, type PaintTheme } from "../src/render/canvas/painter";
import { TextMeasurer } from "../src/render/canvas/text";
import { Layout } from "../src/render/layout";
import { fakeContext } from "./fake-canvas";

const font: ResolvedFont = {
  name: "Calibri",
  family: "Calibri",
  sizePx: 14,
  bold: false,
  italic: false,
  underline: "none",
  strike: false,
  color: "#000000",
};
const plain: ResolvedStyle = {
  font,
  hAlign: "general",
  vAlign: "bottom",
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  numFmt: "General",
};
const wrapped: ResolvedStyle = { ...plain, wrap: true };
const theme: PaintTheme = {
  gridColor: "#g",
  headerBg: "#h",
  headerColor: "#h",
  headerBorderColor: "#h",
  frozenLineColor: "#f",
  noteIndicatorColor: "#n",
};

function sheet(partial: Partial<SheetModel>): SheetModel {
  return {
    name: "S",
    state: "visible",
    defaultRowHeight: 20,
    baseColWidth: 8,
    rowCount: 3,
    colCount: 3,
    rows: {},
    cols: [],
    cells: {},
    merges: [],
    notes: [],
    images: [],
    shapes: [],
    charts: [],
    cf: {},
    view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 100, topRow: 0, leftCol: 0 },
    ...partial,
  };
}

function painterFor(s: SheetModel) {
  const ctx = fakeContext();
  const layout = new Layout(s, 7, 0, 0);
  return new Painter(ctx, new TextMeasurer(ctx), [plain, wrapped], font, s, layout, theme, 7);
}

describe("Layout size overrides", () => {
  it("replace file sizes, including hidden ones", () => {
    const s = sheet({ rows: { 1: { height: 30 }, 2: { hidden: true } }, cols: [{ min: 1, max: 1, hidden: true }] });
    const l = new Layout(s, 7, 0, 0, {
      rows: new Map([
        [1, 50],
        [2, 25],
      ]),
      cols: new Map([[1, 90]]),
    });
    expect(l.rowHeight(1)).toBe(50);
    expect(l.rowHeight(2)).toBe(25);
    expect(l.colWidth(1)).toBe(90);
    expect(l.colWidth(0)).toBe(64);
  });

  it("are stored at 100% zoom and scaled with the sheet", () => {
    const s = sheet({ view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 200, topRow: 0, leftCol: 0 } });
    const l = new Layout(s, 7, 0, 0, { rows: new Map([[0, 30]]), cols: new Map([[0, 50]]) });
    expect(l.rowHeight(0)).toBe(60);
    expect(l.colWidth(0)).toBe(100);
  });
});

describe("Painter fit", () => {
  const text = (t: string, styleId: number) => ({ text: t, type: "string" as const, styleId });

  it("grows a row to the wrapped line count", () => {
    // Column is 64px wide, 60px inside the padding, 7px per glyph: "aaaaaaaa bbbbbbbb" needs two lines.
    const p = painterFor(sheet({ cells: { 0: { 0: text("aaaaaaaa bbbbbbbb", 1) } } }));
    const one = painterFor(sheet({ cells: { 0: { 0: text("aaaa", 1) } } })).fitRowHeight(0);
    const two = p.fitRowHeight(0);
    expect(two).toBeGreaterThan(one);
    expect(two - one).toBeGreaterThanOrEqual(10);
  });

  it("ignores line breaks in cells that do not wrap", () => {
    const flat = painterFor(sheet({ cells: { 0: { 0: text("a\nb\nc", 0) } } })).fitRowHeight(0);
    const lines = painterFor(sheet({ cells: { 0: { 0: text("a\nb\nc", 1) } } })).fitRowHeight(0);
    expect(lines).toBeGreaterThan(flat);
  });

  it("fits a column to its widest cell and reports empty columns", () => {
    const p = painterFor(sheet({ cells: { 0: { 0: text("x".repeat(20), 0) }, 1: { 0: text("xx", 0) } } }));
    // 20 glyphs * 7px + padding
    expect(p.fitColWidth(0)).toBeGreaterThanOrEqual(144);
    expect(p.fitColWidth(1)).toBeUndefined();
  });
});
