import { parseCellRef } from "../format/address.js";
import { hexToRgb, rgbToHex } from "../format/color.js";
import type { CellModel, CellRange, CfResult, DiffStyle } from "../model/types.js";
import type { CfBlock, CfRuleRaw, CfvoRaw } from "./sheet.js";

type Cells = Record<number, Record<number, CellModel>>;

interface Ctx {
  cells: Cells;
  dxfs: DiffStyle[];
  now: Date;
  unsupported: Set<string>;
}

const DEFAULT_BAR = "#638EC6";

/** Evaluates conditional formatting into per-cell results, merged by priority. */
export function evaluateCf(
  blocks: CfBlock[],
  cells: Cells,
  dxfs: DiffStyle[],
  now = new Date(),
): {
  cf: Record<number, Record<number, CfResult>>;
  unsupported: string[];
} {
  const ctx: Ctx = { cells, dxfs, now, unsupported: new Set() };
  const rules: { rule: CfRuleRaw; ranges: CellRange[] }[] = [];
  for (const b of blocks) for (const rule of b.rules) rules.push({ rule, ranges: b.ranges });
  rules.sort((a, b) => a.rule.priority - b.rule.priority);

  let sortedRows: number[] | undefined;
  const rowKeys = () =>
    (sortedRows ??= Object.keys(cells)
      .map(Number)
      .sort((a, b) => a - b));
  const out: Record<number, Record<number, CfResult>> = {};
  const stopped = new Set<string>();
  const budget: Budget = { left: CF_CELL_BUDGET, exceeded: false };

  for (const { rule, ranges } of rules) {
    const targets = collect(ranges, cells, rowKeys, budget);
    const apply = makeRule(rule, targets, ctx);
    if (!apply) continue;
    for (const t of targets) {
      const key = t.row + ":" + t.col;
      if (stopped.has(key)) continue;
      const res = apply(t);
      if (!res) continue;
      const cur = ((out[t.row] ??= {})[t.col] ??= {});
      merge(cur, res);
      if (rule.stopIfTrue) stopped.add(key);
    }
  }
  if (budget.exceeded) ctx.unsupported.add("too many cells (limit reached)");
  return { cf: out, unsupported: [...ctx.unsupported] };
}

interface Target {
  row: number;
  col: number;
  cell: CellModel | undefined;
  /** Top-left of the range the cell belongs to; relative refs are offset from it. */
  origin: { row: number; col: number };
}

/** Cells evaluated across all rules; keeps crafted sqref lists from multiplying work. */
const CF_CELL_BUDGET = 2_000_000;

interface Budget {
  left: number;
  exceeded: boolean;
}

function collect(ranges: CellRange[], cells: Cells, rowKeys: () => number[], budget: Budget): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const r of ranges) {
    const id = `${r.r1}:${r.c1}:${r.r2}:${r.c2}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const origin = { row: r.r1, col: r.c1 };
    const bounded = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1) <= 20000;
    if (bounded) {
      const size = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
      if (size > budget.left) {
        budget.exceeded = true;
        continue;
      }
      budget.left -= size;
      for (let row = r.r1; row <= r.r2; row++) {
        for (let col = r.c1; col <= r.c2; col++) out.push({ row, col, cell: cells[row]?.[col], origin });
      }
    } else {
      // Whole-column style ranges: only cells that exist can match.
      for (const row of rowKeys()) {
        if (row < r.r1) continue;
        if (row > r.r2) break;
        const cols = cells[row]!;
        for (const k in cols) {
          const col = Number(k);
          if (col < r.c1 || col > r.c2) continue;
          if (--budget.left < 0) {
            budget.exceeded = true;
            return out;
          }
          out.push({ row, col, cell: cols[col], origin });
        }
      }
    }
  }
  return out;
}

function num(cell: CellModel | undefined): number | undefined {
  return cell?.type === "number" && typeof cell.value === "number" ? cell.value : undefined;
}

function merge(cur: CfResult, add: CfResult): void {
  if (add.fill && !cur.fill) cur.fill = add.fill;
  if (add.font) {
    cur.font ??= {};
    for (const [k, v] of Object.entries(add.font)) if (v !== undefined && !(k in cur.font)) (cur.font as Record<string, unknown>)[k] = v;
  }
  if (add.border) {
    cur.border ??= {};
    for (const [k, v] of Object.entries(add.border)) if (v && !(k in cur.border)) (cur.border as Record<string, unknown>)[k] = v;
  }
  if (add.dataBar && !cur.dataBar) cur.dataBar = add.dataBar;
  if (add.icon && !cur.icon) cur.icon = add.icon;
}

function dxfResult(rule: CfRuleRaw, ctx: Ctx): CfResult | undefined {
  const d = rule.dxfId !== undefined ? ctx.dxfs[rule.dxfId] : undefined;
  if (!d) return undefined;
  const r: CfResult = {};
  if (d.fill) r.fill = d.fill;
  if (d.font) r.font = d.font;
  if (d.border) r.border = d.border;
  return r;
}

type Apply = (t: Target) => CfResult | undefined;

function makeRule(rule: CfRuleRaw, targets: Target[], ctx: Ctx): Apply | undefined {
  const style = () => dxfResult(rule, ctx);
  const when = (pred: (t: Target) => boolean): Apply | undefined => {
    const res = style();
    return res ? (t) => (pred(t) ? res : undefined) : undefined;
  };
  switch (rule.type) {
    case "cellIs": {
      const ops = rule.formulas.map(operand);
      if (ops.some((o) => o === undefined)) {
        ctx.unsupported.add("cellIs formula");
        return undefined;
      }
      return when((t) => compare(rule.operator ?? "equal", t, ops as Operand[], ctx.cells));
    }
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      const needle = (rule.text ?? "").toLowerCase();
      return when((t) => {
        const s = (t.cell?.text ?? "").toLowerCase();
        if (rule.type === "containsText") return s.includes(needle);
        if (rule.type === "notContainsText") return !s.includes(needle);
        if (rule.type === "beginsWith") return s.startsWith(needle);
        return s.endsWith(needle);
      });
    }
    case "containsBlanks":
      return when((t) => !t.cell || t.cell.text.trim() === "");
    case "notContainsBlanks":
      return when((t) => !!t.cell && t.cell.text.trim() !== "");
    case "containsErrors":
      return when((t) => t.cell?.type === "error");
    case "notContainsErrors":
      return when((t) => t.cell?.type !== "error");
    case "top10": {
      const values = targets
        .map((t) => num(t.cell))
        .filter((v): v is number => v !== undefined)
        .sort((a, b) => b - a);
      if (!values.length) return undefined;
      let n = rule.rank ?? 10;
      if (rule.percent) n = Math.max(1, Math.floor((values.length * n) / 100));
      n = Math.min(n, values.length);
      const threshold = rule.bottom ? values[values.length - n]! : values[n - 1]!;
      return when((t) => {
        const v = num(t.cell);
        if (v === undefined) return false;
        return rule.bottom ? v <= threshold : v >= threshold;
      });
    }
    case "aboveAverage": {
      const values = targets.map((t) => num(t.cell)).filter((v): v is number => v !== undefined);
      if (!values.length) return undefined;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
      const offset = (rule.stdDev ?? 0) * sd;
      const above = rule.aboveAverage !== false;
      return when((t) => {
        const v = num(t.cell);
        if (v === undefined) return false;
        if (above) return rule.equalAverage ? v >= mean + offset : v > mean + offset;
        return rule.equalAverage ? v <= mean - offset : v < mean - offset;
      });
    }
    case "duplicateValues":
    case "uniqueValues": {
      const counts = new Map<string, number>();
      for (const t of targets) {
        if (!t.cell || t.cell.text === "") continue;
        const k = t.cell.text.toLowerCase();
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const dup = rule.type === "duplicateValues";
      return when((t) => {
        if (!t.cell || t.cell.text === "") return false;
        const c = counts.get(t.cell.text.toLowerCase()) ?? 0;
        return dup ? c > 1 : c === 1;
      });
    }
    case "timePeriod":
      return when((t) => inPeriod(num(t.cell), rule.timePeriod ?? "", ctx.now));
    case "colorScale":
      return colorScale(rule, targets, ctx);
    case "dataBar":
      return dataBar(rule, targets, ctx);
    case "iconSet":
      return iconSet(rule, targets, ctx);
    default:
      ctx.unsupported.add(rule.type || "unknown");
      return undefined;
  }
}

type Operand =
  { kind: "num"; v: number } | { kind: "str"; v: string } | { kind: "ref"; row: number; col: number; absRow: boolean; absCol: boolean };

function operand(formula: string): Operand | undefined {
  const f = formula.trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?$/i.test(f)) return { kind: "num", v: Number(f) };
  const str = /^"((?:[^"]|"")*)"$/.exec(f);
  if (str) return { kind: "str", v: str[1]!.replace(/""/g, '"') };
  const ref = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(f);
  if (ref) {
    const p = parseCellRef(ref[2]! + ref[4]!);
    if (p) return { kind: "ref", row: p.row, col: p.col, absCol: ref[1] === "$", absRow: ref[3] === "$" };
  }
  return undefined;
}

function operandValue(op: Operand, t: Target, cells: Cells): number | string | undefined {
  if (op.kind === "num" || op.kind === "str") return op.v;
  // Relative refs are written for the top-left cell of the range.
  const row = op.absRow ? op.row : op.row + (t.row - t.origin.row);
  const col = op.absCol ? op.col : op.col + (t.col - t.origin.col);
  const c = cells[row]?.[col];
  if (!c) return 0;
  return c.type === "number" && typeof c.value === "number" ? c.value : c.text;
}

function compare(operator: string, t: Target, ops: Operand[], cells: Cells): boolean {
  // Excel compares blank cells as 0.
  const v: number | string =
    !t.cell || t.cell.text === "" ? 0 : t.cell.type === "number" && typeof t.cell.value === "number" ? t.cell.value : t.cell.text;
  const vals = ops.map((o) => operandValue(o, t, cells));
  const cmp = (a: number | string, b: number | string | undefined): number => {
    if (b === undefined) return NaN;
    if (typeof a === "number" && typeof b === "number") return a - b;
    // Excel: text sorts after numbers.
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  };
  const a = vals[0];
  const b = vals[1];
  switch (operator) {
    case "between": {
      const lo = cmp(v, a);
      const hi = cmp(v, b);
      return (lo >= 0 && hi <= 0) || (lo <= 0 && hi >= 0);
    }
    case "notBetween": {
      const lo = cmp(v, a);
      const hi = cmp(v, b);
      return !((lo >= 0 && hi <= 0) || (lo <= 0 && hi >= 0));
    }
    case "equal":
      return cmp(v, a) === 0;
    case "notEqual":
      return cmp(v, a) !== 0;
    case "greaterThan":
      return cmp(v, a) > 0;
    case "lessThan":
      return cmp(v, a) < 0;
    case "greaterThanOrEqual":
      return cmp(v, a) >= 0;
    case "lessThanOrEqual":
      return cmp(v, a) <= 0;
    default:
      return false;
  }
}

function inPeriod(serial: number | undefined, period: string, now: Date): boolean {
  if (serial === undefined) return false;
  const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000 + 25569);
  const day = Math.floor(serial);
  const dow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).getUTCDay();
  const weekStart = today - dow;
  const ym = (s: number) => {
    const d = new Date((s - 25569) * 86400000);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  switch (period) {
    case "today":
      return day === today;
    case "yesterday":
      return day === today - 1;
    case "tomorrow":
      return day === today + 1;
    case "last7Days":
      return day > today - 7 && day <= today;
    case "thisWeek":
      return day >= weekStart && day < weekStart + 7;
    case "lastWeek":
      return day >= weekStart - 7 && day < weekStart;
    case "nextWeek":
      return day >= weekStart + 7 && day < weekStart + 14;
    case "thisMonth":
      return ym(day) === ym(today);
    case "lastMonth":
      return ym(day) === ym(today) - 1;
    case "nextMonth":
      return ym(day) === ym(today) + 1;
    default:
      return false;
  }
}

function numericTargets(targets: Target[]): number[] {
  return targets.map((t) => num(t.cell)).filter((v): v is number => v !== undefined);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function cfvoValue(c: CfvoRaw | undefined, sorted: number[], fallback: "min" | "max", ctx: Ctx): number | undefined {
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const type = c?.type ?? fallback;
  const v = c?.val !== undefined ? Number(c.val) : NaN;
  switch (type) {
    case "min":
    case "autoMin":
      return type === "autoMin" ? Math.min(0, min) : min;
    case "max":
    case "autoMax":
      return type === "autoMax" ? Math.max(0, max) : max;
    case "num":
      return Number.isFinite(v) ? v : undefined;
    case "percent":
      return Number.isFinite(v) ? min + ((max - min) * v) / 100 : undefined;
    case "percentile":
      return Number.isFinite(v) ? percentile(sorted, v / 100) : undefined;
    case "formula":
      if (Number.isFinite(v)) return v;
      ctx.unsupported.add("cfvo formula");
      return undefined;
  }
  return undefined;
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function colorScale(rule: CfRuleRaw, targets: Target[], ctx: Ctx): Apply | undefined {
  const cs = rule.colorScale;
  if (!cs || cs.cfvos.length < 2) return undefined;
  const sorted = numericTargets(targets).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const stops = cs.cfvos.map((c, i) => ({
    v: cfvoValue(c, sorted, i === 0 ? "min" : "max", ctx),
    color: cs.colors[i],
  }));
  if (stops.some((s) => s.v === undefined || !s.color)) return undefined;
  const pts = stops as { v: number; color: string }[];
  return (t) => {
    const v = num(t.cell);
    if (v === undefined) return undefined;
    if (v <= pts[0]!.v) return { fill: pts[0]!.color };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (v <= b.v) return { fill: b.v === a.v ? b.color : lerpColor(a.color, b.color, (v - a.v) / (b.v - a.v)) };
    }
    return { fill: pts[pts.length - 1]!.color };
  };
}

function dataBar(rule: CfRuleRaw, targets: Target[], ctx: Ctx): Apply | undefined {
  const db = rule.dataBar;
  if (!db) return undefined;
  const sorted = numericTargets(targets).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const lo = cfvoValue(db.cfvos[0], sorted, "min", ctx);
  const hi = cfvoValue(db.cfvos[1], sorted, "max", ctx);
  if (lo === undefined || hi === undefined) return undefined;
  const minLen = (db.minLength ?? 10) / 100;
  const maxLen = (db.maxLength ?? 90) / 100;
  const color = db.color ?? DEFAULT_BAR;
  return (t) => {
    const v = num(t.cell);
    if (v === undefined) return undefined;
    const ratio = hi === lo ? 1 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const len = minLen + (maxLen - minLen) * ratio;
    return { dataBar: { from: 0, to: len, color, gradient: true, showValue: db.showValue, negative: v < 0 } };
  };
}

const ICON_COUNTS: Record<string, number> = { "3": 3, "4": 4, "5": 5 };

function iconSet(rule: CfRuleRaw, targets: Target[], ctx: Ctx): Apply | undefined {
  const is = rule.iconSet;
  if (!is) return undefined;
  const count = ICON_COUNTS[is.set[0] ?? "3"] ?? 3;
  const sorted = numericTargets(targets).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const thresholds: { v: number; gte: boolean }[] = [];
  for (let i = 1; i < count; i++) {
    const c = is.cfvos[i] ?? { type: "percent", val: String(Math.round((i * 100) / count)) };
    const v = cfvoValue(c, sorted, "min", ctx);
    if (v === undefined) return undefined;
    thresholds.push({ v, gte: c.gte !== false });
  }
  return (t) => {
    const v = num(t.cell);
    if (v === undefined) return undefined;
    let index = 0;
    for (let i = 0; i < thresholds.length; i++) {
      const th = thresholds[i]!;
      if (th.gte ? v >= th.v : v > th.v) index = i + 1;
    }
    if (is.reverse) index = count - 1 - index;
    return { icon: { set: is.set, index, showValue: is.showValue } };
  };
}
