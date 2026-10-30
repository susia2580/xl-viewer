import type { CellRange } from "../model/types.js";

export interface CellRef {
  row: number;
  col: number;
}

/** "AB12" or "$AB$12" -> 0-based. Returns null for anything else. */
export function parseCellRef(ref: string): CellRef | null {
  let i = 0;
  const n = ref.length;
  if (ref.charCodeAt(i) === 36) i++;
  let col = 0;
  const colStart = i;
  while (i < n) {
    const c = ref.charCodeAt(i);
    const upper = c >= 97 && c <= 122 ? c - 32 : c;
    if (upper < 65 || upper > 90) break;
    col = col * 26 + (upper - 64);
    i++;
  }
  if (i === colStart || i - colStart > 3) return null;
  if (ref.charCodeAt(i) === 36) i++;
  let row = 0;
  const rowStart = i;
  while (i < n) {
    const c = ref.charCodeAt(i);
    if (c < 48 || c > 57) return null;
    row = row * 10 + (c - 48);
    i++;
  }
  if (i === rowStart || row === 0) return null;
  return { row: row - 1, col: col - 1 };
}

/** Column letters -> 0-based index. */
export function colIndex(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  return col - 1;
}

export function colName(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cellName(row: number, col: number): string {
  return colName(col) + (row + 1);
}

/** "A1:C3", "A1", "$A:$A", "1:1" -> range. */
export function parseRange(ref: string): CellRange | null {
  const parts = ref.split(":");
  const a = parts[0] ?? "";
  const b = parts[1] ?? a;
  const start = parseCellRef(a);
  const end = parseCellRef(b);
  if (start && end) {
    return {
      r1: Math.min(start.row, end.row),
      c1: Math.min(start.col, end.col),
      r2: Math.max(start.row, end.row),
      c2: Math.max(start.col, end.col),
    };
  }
  // Whole columns or rows.
  const colOnly = /^\$?([A-Za-z]{1,3})$/;
  const rowOnly = /^\$?(\d+)$/;
  const ca = colOnly.exec(a);
  const cb = colOnly.exec(b);
  if (ca && cb) return { r1: 0, c1: colIndex(ca[1]!), r2: 1048575, c2: colIndex(cb[1]!) };
  const ra = rowOnly.exec(a);
  const rb = rowOnly.exec(b);
  if (ra && rb) return { r1: Number(ra[1]) - 1, c1: 0, r2: Number(rb[1]) - 1, c2: 16383 };
  return null;
}

/** Space separated list as used by `sqref`. */
export function parseSqref(sqref: string): CellRange[] {
  const out: CellRange[] = [];
  for (const part of sqref.trim().split(/\s+/)) {
    const r = parseRange(part);
    if (r) out.push(r);
  }
  return out;
}

export interface SheetRangeRef {
  sheet?: string;
  range: CellRange;
}

/**
 * Parses references used in charts and defined names:
 * `'Sheet ''1'''!$A$1:$B$2`, `Sheet1!A1`, `A1:B2`.
 */
export function parseSheetRange(ref: string): SheetRangeRef | null {
  const s = ref.trim().replace(/^=/, "");
  let sheet: string | undefined;
  let rest = s;
  if (s.startsWith("'")) {
    let i = 1;
    let name = "";
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "'") {
        if (s[i + 1] === "'") {
          name += "'";
          i += 2;
          continue;
        }
        break;
      }
      name += ch;
      i++;
    }
    if (s[i + 1] !== "!") return null;
    sheet = name;
    rest = s.slice(i + 2);
  } else {
    const bang = s.lastIndexOf("!");
    if (bang >= 0) {
      sheet = s.slice(0, bang);
      rest = s.slice(bang + 1);
    }
  }
  const range = parseRange(rest);
  if (!range) return null;
  return sheet === undefined ? { range } : { sheet, range };
}
