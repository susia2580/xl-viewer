import { baseColWidthToPx, colWidthToPx } from "../format/units.js";
import type { Anchor, CellRange, ColRange, SheetModel } from "../model/types.js";

const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;

/** View-only size changes in px at 100% zoom, keyed by row / column index. */
export interface SizeOverrides {
  rows?: ReadonlyMap<number, number>;
  cols?: ReadonlyMap<number, number>;
}

/** Row/column positions in px at the sheet's zoom. Index i is the start of row/col i. */
export class Layout {
  readonly rowTop: Float64Array;
  readonly colLeft: Float64Array;
  readonly rows: number;
  readonly cols: number;
  readonly scale: number;
  /** Merges sorted by r1, for range queries. */
  private readonly merges: CellRange[];
  private readonly mergeIndex = new Map<number, CellRange>();
  /** maxR2[i] = largest r2 among merges[0..i]; non-decreasing, so it can be binary searched. */
  private readonly maxR2: number[] = [];

  constructor(
    readonly sheet: SheetModel,
    mdw: number,
    minRows: number,
    minCols: number,
    overrides: SizeOverrides = {},
    minScale = 0,
  ) {
    this.scale = Math.max(sheet.view.zoom / 100, minScale);
    this.rows = Math.min(MAX_ROWS, Math.max(sheet.rowCount, minRows));
    this.cols = Math.min(MAX_COLS, Math.max(sheet.colCount, minCols));

    const defaultCol =
      sheet.defaultColWidth !== undefined ? colWidthToPx(sheet.defaultColWidth, mdw) : baseColWidthToPx(sheet.baseColWidth, mdw);
    this.colLeft = new Float64Array(this.cols + 1);
    let x = 0;
    let rangeIdx = 0;
    const ranges = sheet.cols;
    for (let c = 0; c < this.cols; c++) {
      this.colLeft[c] = x;
      while (rangeIdx < ranges.length && ranges[rangeIdx]!.max < c) rangeIdx++;
      const range: ColRange | undefined = ranges[rangeIdx] && ranges[rangeIdx]!.min <= c ? ranges[rangeIdx] : undefined;
      let w = defaultCol;
      const forced = overrides.cols?.get(c);
      if (forced !== undefined) w = forced;
      else if (range) {
        if (range.hidden) w = 0;
        else if (range.width !== undefined) w = range.width > 0 ? colWidthToPx(range.width, mdw) : 0;
      }
      x += Math.round(w * this.scale);
    }
    this.colLeft[this.cols] = x;

    this.rowTop = new Float64Array(this.rows + 1);
    let y = 0;
    const defaultRow = Math.round(sheet.defaultRowHeight);
    for (let r = 0; r < this.rows; r++) {
      this.rowTop[r] = y;
      const info = sheet.rows[r];
      const forced = overrides.rows?.get(r);
      const h = forced !== undefined ? forced : info?.hidden ? 0 : info?.height !== undefined ? Math.round(info.height) : defaultRow;
      y += Math.round(h * this.scale);
    }
    this.rowTop[this.rows] = y;

    this.merges = [...sheet.merges].sort((a, b) => a.r1 - b.r1);
    let max = -1;
    for (const m of this.merges) {
      this.mergeIndex.set(m.r1 * MAX_COLS + m.c1, m);
      max = Math.max(max, m.r2);
      this.maxR2.push(max);
    }
  }

  get width(): number {
    return this.colLeft[this.cols]!;
  }

  get height(): number {
    return this.rowTop[this.rows]!;
  }

  colWidth(c: number): number {
    return this.colLeft[c + 1]! - this.colLeft[c]!;
  }

  rowHeight(r: number): number {
    return this.rowTop[r + 1]! - this.rowTop[r]!;
  }

  /** Index of the row containing y (clamped). */
  rowAt(y: number): number {
    return search(this.rowTop, this.rows, y);
  }

  colAt(x: number): number {
    return search(this.colLeft, this.cols, x);
  }

  /** Merge whose top-left is (r, c). */
  mergeAt(r: number, c: number): CellRange | undefined {
    return this.mergeIndex.get(r * MAX_COLS + c);
  }

  /** Merges intersecting the given cell range. */
  mergesIn(r1: number, c1: number, r2: number, c2: number): CellRange[] {
    const out: CellRange[] = [];
    for (let i = this.firstReaching(r1); i < this.merges.length; i++) {
      const m = this.merges[i]!;
      if (m.r1 > r2) break;
      if (m.r2 >= r1 && m.c2 >= c1 && m.c1 <= c2) out.push(m);
    }
    return out;
  }

  /** Merge covering (r, c), if any. */
  mergeCovering(r: number, c: number): CellRange | undefined {
    for (let i = this.firstReaching(r); i < this.merges.length; i++) {
      const m = this.merges[i]!;
      if (m.r1 > r) break;
      if (m.r2 >= r && m.c1 <= c && m.c2 >= c) return m;
    }
    return undefined;
  }

  /** First merge index that could reach row `r` (earlier merges all end above it). */
  private firstReaching(r: number): number {
    let lo = 0;
    let hi = this.maxR2.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.maxR2[mid]! >= r) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Sheet-space rectangle of a drawing anchor. */
  anchorRect(a: Anchor): { x: number; y: number; w: number; h: number } {
    const s = this.scale;
    if (a.x !== undefined && a.y !== undefined) return { x: a.x * s, y: a.y * s, w: a.width * s, h: a.height * s };
    const fromCol = Math.min(a.from.col, this.cols);
    const fromRow = Math.min(a.from.row, this.rows);
    const x = this.colLeft[fromCol]! + Math.min(a.from.dx * s, this.colWidth(fromCol) || Infinity);
    const y = this.rowTop[fromRow]! + Math.min(a.from.dy * s, this.rowHeight(fromRow) || Infinity);
    if (a.to) {
      const toCol = Math.min(a.to.col, this.cols);
      const toRow = Math.min(a.to.row, this.rows);
      const x2 = this.colLeft[toCol]! + Math.min(a.to.dx * s, this.colWidth(toCol) || Infinity);
      const y2 = this.rowTop[toRow]! + Math.min(a.to.dy * s, this.rowHeight(toRow) || Infinity);
      return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
    }
    return { x, y, w: a.width * s, h: a.height * s };
  }
}

function search(arr: Float64Array, n: number, v: number): number {
  if (v <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
