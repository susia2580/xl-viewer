import type { Layout } from "./layout.js";

export type PaneKind = "corner" | "top" | "left" | "main";

/**
 * A viewport rectangle showing part of the sheet.
 * Sheet x maps to viewport x as: vx = x + (sheetX - sx).
 */
export interface Pane {
  kind: PaneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export function computePanes(
  layout: Layout,
  viewW: number,
  viewH: number,
  headerW: number,
  headerH: number,
  scrollX: number,
  scrollY: number,
  frozenRows: number,
  frozenCols: number,
): Pane[] {
  const fw = frozenCols > 0 ? layout.colLeft[Math.min(frozenCols, layout.cols)]! : 0;
  const fh = frozenRows > 0 ? layout.rowTop[Math.min(frozenRows, layout.rows)]! : 0;
  const bodyW = Math.max(0, viewW - headerW - fw);
  const bodyH = Math.max(0, viewH - headerH - fh);
  const out: Pane[] = [];
  const add = (kind: PaneKind, x: number, y: number, w: number, h: number, sx: number, sy: number) => {
    if (w <= 0 || h <= 0) return;
    out.push({
      kind,
      x,
      y,
      w,
      h,
      sx,
      sy,
      r0: layout.rowAt(sy),
      r1: Math.min(layout.rows - 1, layout.rowAt(sy + h)),
      c0: layout.colAt(sx),
      c1: Math.min(layout.cols - 1, layout.colAt(sx + w)),
    });
  };
  if (fw > 0 && fh > 0) add("corner", headerW, headerH, Math.min(fw, viewW - headerW), Math.min(fh, viewH - headerH), 0, 0);
  if (fh > 0) add("top", headerW + fw, headerH, bodyW, Math.min(fh, viewH - headerH), fw + scrollX, 0);
  if (fw > 0) add("left", headerW, headerH + fh, Math.min(fw, viewW - headerW), bodyH, 0, fh + scrollY);
  add("main", headerW + fw, headerH + fh, bodyW, bodyH, fw + scrollX, fh + scrollY);
  return out;
}
