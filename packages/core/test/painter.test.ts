import { describe, expect, it } from "vitest";
import type { ResolvedFont, ResolvedStyle, SheetModel } from "../src/model/types";
import { Painter, type PaintTheme } from "../src/render/canvas/painter";
import { TextMeasurer } from "../src/render/canvas/text";
import { Layout } from "../src/render/layout";
import { computePanes } from "../src/render/panes";
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
const base: ResolvedStyle = {
  font,
  hAlign: "general",
  vAlign: "bottom",
  wrap: false,
  shrink: false,
  indent: 0,
  rotation: 0,
  numFmt: "General",
};
const theme: PaintTheme = {
  gridColor: "#GRID",
  headerBg: "#HBG",
  headerColor: "#HC",
  headerBorderColor: "#HB",
  frozenLineColor: "#FZ",
  noteIndicatorColor: "#NOTE",
};

function paint(partial: Partial<SheetModel>, styles: ResolvedStyle[] = [base]) {
  const sheet: SheetModel = {
    name: "S",
    state: "visible",
    defaultRowHeight: 20,
    baseColWidth: 8,
    rowCount: 3,
    colCount: 4,
    rows: {},
    cols: [],
    cells: {},
    merges: [],
    notes: [],
    images: [],
    shapes: [],
    charts: [],
    cf: {},
    view: { showGridLines: true, showHeaders: false, frozenRows: 0, frozenCols: 0, zoom: 100, topRow: 0, leftCol: 0 },
    ...partial,
  };
  const ctx = fakeContext();
  const layout = new Layout(sheet, 7, 0, 0);
  const painter = new Painter(ctx, new TextMeasurer(ctx), styles, font, sheet, layout, theme, 7);
  painter.paint({ viewW: 256, viewH: 60, dpr: 1, headerW: 0, headerH: 0, panes: computePanes(layout, 256, 60, 0, 0, 0, 0, 0, 0) });
  return ctx.calls;
}

describe("Painter", () => {
  it("paints fills after gridlines and text after fills", () => {
    const calls = paint({ cells: { 0: { 0: { text: "hi", type: "string", styleId: 1 } } } }, [base, { ...base, fill: "#FILL" }]);
    const grid = calls.indexOf("fillStyle=#GRID");
    const fill = calls.indexOf("fillStyle=#FILL");
    const text = calls.findIndex((c) => c.startsWith('fillText("hi"'));
    expect(grid).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(grid);
    expect(text).toBeGreaterThan(fill);
  });

  it("right-aligns numbers and left-aligns text", () => {
    const calls = paint({
      cells: { 0: { 0: { text: "12", type: "number", styleId: 0, value: 12 }, 1: { text: "ab", type: "string", styleId: 0 } } },
    });
    expect(calls).toContain('fillText("12",48,15)');
    expect(calls).toContain('fillText("ab",66,15)');
  });

  it("lets text overflow into empty cells and hides the gridline it crosses", () => {
    const long = "x".repeat(15); // 105px, cell is 64px
    const calls = paint({ cells: { 0: { 0: { text: long, type: "string", styleId: 0 } } } });
    expect(calls.some((c) => c.startsWith("rect(0,0,128,20)"))).toBe(true);
    // Vertical gridline between A1 and B1 (x = 63) is not drawn for row 0.
    expect(calls).not.toContain("fillRect(63,0,1,20)");
    expect(calls).toContain("fillRect(63,20,1,20)");
  });

  it("shows ### for numbers that don't fit", () => {
    const calls = paint({ cells: { 0: { 0: { text: "123456789.12", type: "number", styleId: 0, value: 123456789.12 } } } }, [
      { ...base, numFmt: "#,##0.00" },
    ]);
    expect(calls.some((c) => c.startsWith('fillText("########'))).toBe(true);
  });

  it("draws merged text once across the merge", () => {
    const calls = paint({ merges: [{ r1: 0, c1: 0, r2: 1, c2: 1 }], cells: { 0: { 0: { text: "m", type: "string", styleId: 0 } } } }, [
      { ...base, hAlign: "center" },
    ]);
    expect(calls.filter((c) => c.startsWith('fillText("m"'))).toEqual(['fillText("m",60.5,35)']);
    expect(calls).not.toContain("fillRect(63,0,1,20)");
  });

  it("draws note indicators", () => {
    const calls = paint({ notes: [{ row: 0, col: 1, rich: [{ text: "n" }], alwaysVisible: false }] });
    expect(calls).toContain("fillStyle=#NOTE");
    expect(calls).toContain("moveTo(121,0)");
  });

  it("skips gridlines when the sheet hides them", () => {
    const calls = paint({
      view: { showGridLines: false, showHeaders: false, frozenRows: 0, frozenCols: 0, zoom: 100, topRow: 0, leftCol: 0 },
    });
    expect(calls).not.toContain("fillStyle=#GRID");
  });
});

describe("Painter regressions", () => {
  const view = (frozenRows: number, frozenCols: number) => ({
    showGridLines: true,
    showHeaders: true,
    frozenRows,
    frozenCols,
    zoom: 100,
    topRow: 0,
    leftCol: 0,
  });

  function paintFrame(
    partial: Partial<SheetModel>,
    opts: { headerW?: number; headerH?: number; sx?: number; sy?: number; styles?: ResolvedStyle[] } = {},
  ) {
    const sheet: SheetModel = {
      name: "S",
      state: "visible",
      defaultRowHeight: 20,
      baseColWidth: 8,
      rowCount: 20,
      colCount: 6,
      rows: {},
      cols: [],
      cells: {},
      merges: [],
      notes: [],
      images: [],
      shapes: [],
      charts: [],
      cf: {},
      view: view(0, 0),
      ...partial,
    };
    const ctx = fakeContext();
    const layout = new Layout(sheet, 7, 0, 0);
    const { headerW = 0, headerH = 0, sx = 0, sy = 0 } = opts;
    const painter = new Painter(ctx, new TextMeasurer(ctx), opts.styles ?? [base], font, sheet, layout, theme, 7);
    painter.paint({
      viewW: 300,
      viewH: 200,
      dpr: 1,
      headerW,
      headerH,
      panes: computePanes(layout, 300, 200, headerW, headerH, sx, sy, sheet.view.frozenRows, sheet.view.frozenCols),
    });
    return ctx.calls;
  }

  it("labels every row and column once when only rows are frozen", () => {
    const calls = paintFrame({ view: view(2, 0) }, { headerW: 30, headerH: 20 });
    expect(calls.filter((c) => c.startsWith('fillText("A"'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('fillText("1"'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('fillText("3"'))).toHaveLength(1);
  });

  it("keeps merged text inside the merge after its top row scrolls away", () => {
    const calls = paintFrame(
      { merges: [{ r1: 0, c1: 0, r2: 9, c2: 0 }], cells: { 0: { 0: { text: "x".repeat(40), type: "string", styleId: 0 } } } },
      { sy: 100 },
    );
    expect(calls.some((c) => c.startsWith("rect(0,0,64,200)"))).toBe(true);
    expect(calls.some((c) => c.startsWith("rect(0,0,256"))).toBe(false);
  });

  it("does not share wrapped lines between cells with different colours", () => {
    const red = { ...base, wrap: true, font: { ...font, color: "#FF0000" } };
    const black = { ...base, wrap: true };
    const calls = paintFrame(
      { cells: { 0: { 0: { text: "Hello", type: "string", styleId: 1 }, 1: { text: "Hello", type: "string", styleId: 2 } } } },
      { styles: [base, red, black] },
    );
    const fills = calls.filter((c) => c.startsWith("fillStyle=#FF0000") || c.startsWith("fillStyle=#000000"));
    expect(fills).toContain("fillStyle=#000000");
  });
});
