import { parseCellRef, parseRange, parseSqref } from "../format/address.js";
import type { NumberFormatter } from "../format/number.js";
import { ptToPx } from "../format/units.js";
import type { CellModel, CellRange, ColRange, ResolvedStyle, RowInfo, SheetView, XlViewerWarning } from "../model/types.js";
import type { SharedString, RichTextCollector } from "./shared-strings.js";
import { boolValue, NS, streamXml } from "./xml.js";

export interface CfvoRaw {
  type: string;
  val?: string;
  gte?: boolean;
}

export interface CfRuleRaw {
  type: string;
  priority: number;
  dxfId?: number;
  operator?: string;
  stopIfTrue?: boolean;
  text?: string;
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  aboveAverage?: boolean;
  equalAverage?: boolean;
  stdDev?: number;
  timePeriod?: string;
  formulas: string[];
  colorScale?: { cfvos: CfvoRaw[]; colors: (string | undefined)[] };
  dataBar?: { cfvos: CfvoRaw[]; color?: string; showValue: boolean; minLength?: number; maxLength?: number };
  iconSet?: { set: string; cfvos: CfvoRaw[]; showValue: boolean; reverse: boolean };
}

export interface CfBlock {
  ranges: CellRange[];
  rules: CfRuleRaw[];
}

export interface SheetData {
  defaultRowHeight: number;
  defaultColWidth?: number;
  baseColWidth: number;
  rows: Record<number, RowInfo>;
  cols: ColRange[];
  cells: Record<number, Record<number, CellModel>>;
  maxRow: number;
  maxCol: number;
  merges: CellRange[];
  view: SheetView;
  drawingRelId?: string;
  legacyDrawingRelId?: string;
  cf: CfBlock[];
  formulasWithoutValue: number;
}

export interface SheetContext {
  styles: ResolvedStyle[];
  sst: SharedString[];
  formatter: NumberFormatter;
  rich: RichTextCollector;
  /** Resolves `<color>` elements inside cfRule. */
  color: (attrs: Record<string, string>) => string | undefined;
  warn: (w: XlViewerWarning) => void;
  sheetName: string;
  maxCells: number;
  date1904: boolean;
}

const ERRORS_ALLOWED = new Set([
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#GETTING_DATA",
  "#SPILL!",
  "#CALC!",
  "#FIELD!",
  "#BLOCKED!",
  "#CONNECT!",
  "#BUSY!",
  "#UNKNOWN!",
]);

export function parseSheet(xml: string, ctx: SheetContext): SheetData {
  const data: SheetData = {
    defaultRowHeight: 20,
    baseColWidth: 8,
    rows: {},
    cols: [],
    cells: {},
    maxRow: -1,
    maxCol: -1,
    merges: [],
    view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 100, topRow: 0, leftCol: 0 },
    cf: [],
    formulasWithoutValue: 0,
  };

  let sheetViewSeen = false;
  let inSheetView = false;
  let inSheetData = false;

  let rowIndex = -1;
  let rowStyle: number | undefined;
  let colCursor = -1;

  // Current cell
  let inCell = false;
  let cRow = 0;
  let cCol = 0;
  let cStyle = 0;
  let cType = "n";
  let cValue = "";
  let inV = false;
  let hasFormula = false;
  let hasValue = false;
  let inInline = false;
  let cellCount = 0;

  // Conditional formatting
  let cfBlock: CfBlock | undefined;
  let cfRule: CfRuleRaw | undefined;
  let inFormula = false;
  let formulaText = "";
  let cfPart: "colorScale" | "dataBar" | "iconSet" | undefined;
  let extDepth = 0;

  const finishCell = () => {
    const style = ctx.styles[cStyle] ?? ctx.styles[0]!;
    let cell: CellModel | undefined;
    switch (cType) {
      case "s": {
        const s = cValue.trim() === "" ? undefined : ctx.sst[Number(cValue)];
        if (s) {
          cell = { text: s.text, type: "string", styleId: cStyle };
          if (s.rich) cell.rich = s.rich;
          applyTextFormat(cell, style, ctx.formatter);
        }
        break;
      }
      case "inlineStr": {
        const s = ctx.rich.result();
        cell = { text: s.text, type: "string", styleId: cStyle };
        if (s.rich) cell.rich = s.rich;
        applyTextFormat(cell, style, ctx.formatter);
        break;
      }
      case "str":
        cell = { text: cValue, type: "string", styleId: cStyle };
        applyTextFormat(cell, style, ctx.formatter);
        break;
      case "b":
        cell = { text: cValue === "1" ? "TRUE" : "FALSE", type: "boolean", styleId: cStyle, value: cValue === "1" };
        break;
      case "e":
        cell = { text: ERRORS_ALLOWED.has(cValue) ? cValue : cValue || "#N/A", type: "error", styleId: cStyle };
        break;
      case "d": {
        let serial = isoToSerial(cValue);
        // The formatter shifts serials of 1904 workbooks, so store them in that system.
        if (serial !== undefined && ctx.date1904) serial -= 1462;
        if (serial !== undefined) cell = numberCell(serial, cStyle, style, ctx.formatter);
        else cell = { text: cValue, type: "string", styleId: cStyle };
        break;
      }
      default: {
        if (hasValue && cValue !== "") {
          const n = Number(cValue);
          cell = Number.isFinite(n) ? numberCell(n, cStyle, style, ctx.formatter) : { text: cValue, type: "string", styleId: cStyle };
        }
      }
    }
    // Some writers store an empty <v/> for formulas that were never calculated.
    if (hasFormula && (!hasValue || (cValue === "" && cType !== "str" && cType !== "inlineStr"))) data.formulasWithoutValue++;
    if (!cell) {
      if (cStyle === 0) return;
      cell = { text: "", type: "string", styleId: cStyle };
    }
    if (++cellCount > ctx.maxCells) {
      throw new CellLimitError(ctx.maxCells);
    }
    (data.cells[cRow] ??= {})[cCol] = cell;
    // Styled empty cells count too: their fill and borders are painted.
    if (cRow > data.maxRow) data.maxRow = cRow;
    if (cCol > data.maxCol) data.maxCol = cCol;
  };

  streamXml(xml, {
    open(uri, local, a) {
      if (extDepth > 0) {
        extDepth++;
        return;
      }
      if (inCell && inInline) {
        ctx.rich.open(uri, local, a);
        return;
      }
      if (uri !== NS.main) return;
      if (local === "extLst") {
        extDepth = 1;
        return;
      }
      if (inSheetData) {
        if (local === "row") {
          const r = a.r ? Number(a.r) - 1 : rowIndex + 1;
          rowIndex = r;
          colCursor = -1;
          const info: RowInfo = {};
          // Excel stores auto-fit heights too, so `ht` wins even without customHeight.
          if (a.ht) info.height = ptToPx(Number(a.ht));
          if (boolValue(a.hidden, false)) info.hidden = true;
          rowStyle = undefined;
          if (a.s !== undefined && boolValue(a.customFormat, false)) {
            rowStyle = Number(a.s);
            info.styleId = rowStyle;
          }
          if (info.height !== undefined || info.hidden || info.styleId !== undefined) data.rows[r] = info;
        } else if (local === "c") {
          inCell = true;
          const ref = a.r ? parseCellRef(a.r) : null;
          if (ref) {
            cRow = ref.row;
            cCol = ref.col;
          } else {
            cRow = rowIndex < 0 ? 0 : rowIndex;
            cCol = colCursor + 1;
          }
          if (rowIndex < 0) rowIndex = cRow;
          colCursor = cCol;
          cStyle = a.s !== undefined ? Number(a.s) : (rowStyle ?? 0);
          cType = a.t ?? "n";
          cValue = "";
          hasFormula = false;
          hasValue = false;
          if (cType === "inlineStr") ctx.rich.reset();
        } else if (inCell) {
          if (local === "v") {
            inV = true;
            hasValue = true;
          } else if (local === "f") hasFormula = true;
          else if (local === "is") {
            inInline = true;
            hasValue = true;
          }
        }
        return;
      }
      if (cfRule) {
        switch (local) {
          case "formula":
            inFormula = true;
            formulaText = "";
            return;
          case "colorScale":
            cfPart = "colorScale";
            cfRule.colorScale = { cfvos: [], colors: [] };
            return;
          case "dataBar":
            cfPart = "dataBar";
            cfRule.dataBar = {
              cfvos: [],
              showValue: boolValue(a.showValue, true),
              ...(a.minLength ? { minLength: Number(a.minLength) } : {}),
              ...(a.maxLength ? { maxLength: Number(a.maxLength) } : {}),
            };
            return;
          case "iconSet":
            cfPart = "iconSet";
            cfRule.iconSet = {
              set: a.iconSet ?? "3TrafficLights1",
              cfvos: [],
              showValue: boolValue(a.showValue, true),
              reverse: boolValue(a.reverse, false),
            };
            return;
          case "cfvo": {
            const v: CfvoRaw = { type: a.type ?? "num" };
            if (a.val !== undefined) v.val = a.val;
            if (a.gte !== undefined) v.gte = boolValue(a.gte, true);
            if (cfPart === "colorScale") cfRule.colorScale!.cfvos.push(v);
            else if (cfPart === "dataBar") cfRule.dataBar!.cfvos.push(v);
            else if (cfPart === "iconSet") cfRule.iconSet!.cfvos.push(v);
            return;
          }
          case "color": {
            const c = ctx.color(a);
            if (cfPart === "colorScale") cfRule.colorScale!.colors.push(c);
            else if (cfPart === "dataBar" && c) cfRule.dataBar!.color = c;
            return;
          }
        }
        return;
      }
      switch (local) {
        case "sheetView":
          if (!sheetViewSeen) {
            sheetViewSeen = true;
            inSheetView = true;
            data.view.showGridLines = boolValue(a.showGridLines, true);
            data.view.showHeaders = boolValue(a.showRowColHeaders, true);
            const zoom = Number(a.zoomScale);
            if (zoom >= 10 && zoom <= 400) data.view.zoom = zoom;
            if (boolValue(a.rightToLeft, false)) {
              ctx.warn({ code: "RTL_UNSUPPORTED", message: "Right-to-left sheets are shown left-to-right", sheet: ctx.sheetName });
            }
            const tl = a.topLeftCell ? parseCellRef(a.topLeftCell) : null;
            if (tl) {
              data.view.topRow = tl.row;
              data.view.leftCol = tl.col;
            }
          }
          break;
        case "pane":
          if (inSheetView && (a.state === "frozen" || a.state === "frozenSplit")) {
            data.view.frozenCols = Math.max(0, Math.round(Number(a.xSplit ?? 0)));
            data.view.frozenRows = Math.max(0, Math.round(Number(a.ySplit ?? 0)));
            const tl = a.topLeftCell ? parseCellRef(a.topLeftCell) : null;
            if (tl) {
              data.view.topRow = tl.row;
              data.view.leftCol = tl.col;
            }
          }
          break;
        case "sheetFormatPr":
          if (a.defaultRowHeight) data.defaultRowHeight = ptToPx(Number(a.defaultRowHeight));
          if (a.defaultColWidth) data.defaultColWidth = Number(a.defaultColWidth);
          if (a.baseColWidth) data.baseColWidth = Number(a.baseColWidth);
          break;
        case "col": {
          const min = Number(a.min) - 1;
          const max = Math.min(Number(a.max) - 1, 16383);
          if (!(min >= 0 && max >= min)) break;
          const col: ColRange = { min, max };
          if (a.width !== undefined) col.width = Number(a.width);
          if (boolValue(a.hidden, false)) col.hidden = true;
          if (a.style !== undefined) col.styleId = Number(a.style);
          data.cols.push(col);
          break;
        }
        case "sheetData":
          inSheetData = true;
          break;
        case "mergeCell": {
          const r = a.ref ? parseRange(a.ref) : null;
          if (r && (r.r1 !== r.r2 || r.c1 !== r.c2)) data.merges.push(r);
          break;
        }
        case "drawing":
          if (a["r:id"]) data.drawingRelId = a["r:id"];
          break;
        case "legacyDrawing":
          if (a["r:id"]) data.legacyDrawingRelId = a["r:id"];
          break;
        case "conditionalFormatting":
          cfBlock = { ranges: parseSqref(a.sqref ?? ""), rules: [] };
          break;
        case "cfRule":
          if (cfBlock) {
            cfRule = { type: a.type ?? "", priority: Number(a.priority ?? 0), formulas: [] };
            if (a.dxfId !== undefined) cfRule.dxfId = Number(a.dxfId);
            if (a.operator) cfRule.operator = a.operator;
            if (a.text !== undefined) cfRule.text = a.text;
            if (a.rank !== undefined) cfRule.rank = Number(a.rank);
            if (a.stdDev !== undefined) cfRule.stdDev = Number(a.stdDev);
            if (a.timePeriod) cfRule.timePeriod = a.timePeriod;
            if (boolValue(a.stopIfTrue, false)) cfRule.stopIfTrue = true;
            if (boolValue(a.percent, false)) cfRule.percent = true;
            if (boolValue(a.bottom, false)) cfRule.bottom = true;
            cfRule.aboveAverage = boolValue(a.aboveAverage, true);
            cfRule.equalAverage = boolValue(a.equalAverage, false);
          }
          break;
      }
    },
    close(uri, local) {
      if (extDepth > 0) {
        extDepth--;
        return;
      }
      if (inCell && inInline) {
        if (uri === NS.main && local === "is") inInline = false;
        else ctx.rich.close(uri, local);
        return;
      }
      if (uri !== NS.main) return;
      if (inSheetData) {
        if (local === "v") inV = false;
        else if (local === "c") {
          inCell = false;
          finishCell();
        } else if (local === "sheetData") inSheetData = false;
        return;
      }
      if (cfRule) {
        if (local === "formula") {
          inFormula = false;
          cfRule.formulas.push(formulaText);
        } else if (local === "colorScale" || local === "dataBar" || local === "iconSet") cfPart = undefined;
        else if (local === "cfRule") {
          cfBlock?.rules.push(cfRule);
          cfRule = undefined;
        }
        return;
      }
      if (local === "sheetView") inSheetView = false;
      else if (local === "conditionalFormatting" && cfBlock) {
        if (cfBlock.ranges.length && cfBlock.rules.length) data.cf.push(cfBlock);
        cfBlock = undefined;
      }
    },
    text(t) {
      if (inV) cValue += t;
      else if (inInline) ctx.rich.onText(t);
      else if (inFormula) formulaText += t;
    },
  });

  data.cols.sort((x, y) => x.min - y.min);
  return data;
}

export class CellLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Sheet has more than ${limit} cells`);
  }
}

function numberCell(n: number, styleId: number, style: ResolvedStyle, formatter: NumberFormatter): CellModel {
  const fmt = style.numFmt;
  let text: string;
  let color: string | undefined;
  const plain = fmt === "General" ? generalFast(n) : undefined;
  if (plain !== undefined) {
    text = plain;
  } else {
    const f = formatter.formatNumber(fmt, n);
    text = f.text;
    color = f.color;
  }
  const cell: CellModel = { text, type: "number", styleId, value: n };
  if (color) cell.fmtColor = color;
  return cell;
}

/** General format without calling numfmt, when Excel would show the plain digits. */
function generalFast(n: number): string | undefined {
  if (Number.isInteger(n)) return Math.abs(n) < 1e11 ? String(n) : undefined;
  const a = Math.abs(n);
  if (a < 1e-4 || a >= 1e10) return undefined;
  const s = String(n);
  return s.length <= 11 ? s : undefined;
}

function applyTextFormat(cell: CellModel, style: ResolvedStyle, formatter: NumberFormatter): void {
  if (style.numFmt === "General" || style.numFmt === "@") return;
  const f = formatter.formatText(style.numFmt, cell.text);
  if (f.text !== cell.text) {
    cell.text = f.text;
    delete cell.rich;
  }
}

/** ISO 8601 date/time -> 1900-system serial number. */
export function isoToSerial(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?/.exec(iso);
  if (m) {
    const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    let serial = utc / 86400000 + 25569;
    if (serial < 61) serial -= 1;
    return serial;
  }
  const t = /^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(iso);
  if (t) return (Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3] ?? 0)) / 86400;
  return undefined;
}
