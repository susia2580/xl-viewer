import { describe, expect, it } from "vitest";
import type { SheetModel } from "../src/model/types";
import { Layout } from "../src/render/layout";
import { computePanes } from "../src/render/panes";

function sheet(partial: Partial<SheetModel>): SheetModel {
  return {
    name: "S",
    state: "visible",
    defaultRowHeight: 20,
    baseColWidth: 8,
    rowCount: 10,
    colCount: 5,
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

describe("Layout", () => {
  it("applies column ranges, hidden rows and defaults", () => {
    const l = new Layout(
      sheet({
        cols: [
          { min: 1, max: 2, width: 12 },
          { min: 3, max: 3, hidden: true },
        ],
        rows: { 2: { hidden: true }, 3: { height: 30.4 } },
      }),
      7,
      0,
      0,
    );
    expect([0, 1, 2, 3, 4].map((c) => l.colWidth(c))).toEqual([64, 84, 84, 0, 64]);
    expect([0, 1, 2, 3].map((r) => l.rowHeight(r))).toEqual([20, 20, 0, 30]);
    expect(l.rowAt(45)).toBe(3);
    expect(l.colAt(64)).toBe(1);
  });

  it("scales with zoom", () => {
    const l = new Layout(
      sheet({ view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 150, topRow: 0, leftCol: 0 } }),
      7,
      0,
      0,
    );
    expect(l.colWidth(0)).toBe(96);
    expect(l.rowHeight(0)).toBe(30);
  });

  it("raises a small saved zoom to the minimum scale but keeps a larger one", () => {
    const small = sheet({
      view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 40, topRow: 0, leftCol: 0 },
    });
    expect(new Layout(small, 7, 0, 0, {}, 0.8).scale).toBe(0.8);
    expect(new Layout(small, 7, 0, 0).scale).toBe(0.4);
    const big = sheet({ view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 150, topRow: 0, leftCol: 0 } });
    expect(new Layout(big, 7, 0, 0, {}, 0.8).scale).toBe(1.5);
  });

  it("fills the viewport with empty rows and columns", () => {
    const l = new Layout(sheet({}), 7, 100, 40);
    expect(l.rows).toBe(100);
    expect(l.cols).toBe(40);
  });

  it("resolves two-cell anchors", () => {
    const l = new Layout(sheet({}), 7, 0, 0);
    expect(l.anchorRect({ from: { row: 1, col: 1, dx: 10, dy: 5 }, to: { row: 3, col: 2, dx: 0, dy: 0 }, width: 0, height: 0 })).toEqual({
      x: 74,
      y: 25,
      w: 54,
      h: 35,
    });
  });

  it("splits frozen panes", () => {
    const l = new Layout(sheet({ rowCount: 100, colCount: 30 }), 7, 0, 0);
    const panes = computePanes(l, 500, 300, 30, 20, 100, 200, 1, 1);
    expect(panes.map((p) => p.kind)).toEqual(["corner", "top", "left", "main"]);
    const main = panes[3]!;
    expect(main).toMatchObject({ x: 94, y: 40, sx: 164, sy: 220 });
  });
});
