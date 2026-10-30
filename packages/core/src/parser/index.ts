import { InvalidFileError, UnsupportedFormatError, ParseError } from "../errors.js";
import { parseSheetRange } from "../format/address.js";
import { resolveColor } from "../format/color.js";
import { NumberFormatter } from "../format/number.js";
import { en } from "../locales/en.js";
import type { XlViewerLocale } from "../locales/types.js";
import type { ChartModel, ImageModel, NoteModel, ShapeModel, SheetModel, XlViewerWarning, WorkbookModel } from "../model/types.js";
import { evaluateCf } from "./cf.js";
import { parseChart, unsupportedChart, type RefResolver, type RefValue } from "./chart.js";
import { applyVml, parseComments, parsePersons, parseThreadedComments, parseVmlNotes } from "./comments.js";
import { parseDrawing } from "./drawing.js";
import { OpcPackage, REL, relIs, validatePackage, type Relationship } from "./package.js";
import { parseSharedStrings, RichTextCollector } from "./shared-strings.js";
import { CellLimitError, parseSheet, type SheetData } from "./sheet.js";
import { colorSpec, parseStyles } from "./styles.js";
import { parseTheme } from "./theme.js";
import { parseWorkbook, type DefinedName } from "./workbook.js";
import { StrictOoxmlError } from "./xml.js";
import { DEFAULT_LIMITS, unzip, type ZipLimits } from "./zip.js";

export interface ParseOptions {
  locale?: XlViewerLocale;
  maxFileSize?: number;
  maxUncompressedSize?: number;
  maxCells?: number;
}

export interface ParseResult {
  model: WorkbookModel;
  /** Buffers that can be transferred instead of copied. */
  transfer: ArrayBuffer[];
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
};

const MAX_CHART_REF_CELLS = 100_000;

export function parseXlsxBuffer(input: ArrayBuffer | Uint8Array, options: ParseOptions = {}): ParseResult {
  try {
    return parse(input instanceof Uint8Array ? input : new Uint8Array(input), options);
  } catch (err) {
    if (err instanceof StrictOoxmlError) throw new UnsupportedFormatError("Strict OOXML files are not supported");
    if (err instanceof CellLimitError) throw new ParseError(err.message);
    throw err;
  }
}

function parse(data: Uint8Array, options: ParseOptions): ParseResult {
  const locale = options.locale ?? en;
  const limits: ZipLimits = {
    maxFileSize: options.maxFileSize ?? DEFAULT_LIMITS.maxFileSize,
    maxUncompressedSize: options.maxUncompressedSize ?? DEFAULT_LIMITS.maxUncompressedSize,
  };
  const maxCells = options.maxCells ?? 5_000_000;
  const pkg = new OpcPackage(unzip(data, limits));
  validatePackage(pkg);

  const warnings: XlViewerWarning[] = [];
  const warn = (w: XlViewerWarning) => warnings.push(w);

  const docRel = pkg.rels("").find((r) => relIs(r, REL.officeDocument));
  if (!docRel) throw new InvalidFileError("Package has no workbook part");
  const wbRoot = pkg.xml(docRel.target);
  if (!wbRoot) throw new InvalidFileError("Workbook part is missing");
  const wb = parseWorkbook(wbRoot);
  const wbRels = pkg.rels(docRel.target);
  const relTarget = (suffix: string) => wbRels.find((r) => relIs(r, suffix))?.target;

  const theme = parseTheme(pkg.xml(relTarget(REL.theme) ?? ""));
  const styleTable = parseStyles(pkg.xml(relTarget(REL.styles) ?? ""), theme, locale.builtinFormats);
  const sst = parseSharedStrings(pkg.text(relTarget(REL.sharedStrings) ?? ""), styleTable.colors, theme);
  const persons = parsePersons(pkg.text(relTarget(REL.person) ?? ""));
  const formatter = new NumberFormatter(locale.code, wb.date1904);
  const rich = new RichTextCollector(styleTable.colors, theme);

  interface Pending {
    entry: (typeof wb.sheets)[number];
    path?: string;
    rels: Relationship[];
    data?: SheetData;
  }
  const pending: Pending[] = wb.sheets.map((entry) => {
    const rel = wbRels.find((r) => r.id === entry.relId);
    if (!rel) return { entry, rels: [] };
    if (!relIs(rel, REL.worksheet)) {
      warn({ code: "SHEET_TYPE_UNSUPPORTED", message: `Sheet type is not supported: ${rel.type.split("/").pop()}`, sheet: entry.name });
      return { entry, rels: [] };
    }
    return { entry, path: rel.target, rels: pkg.rels(rel.target) };
  });

  let totalCells = 0;
  for (const p of pending) {
    if (!p.path) continue;
    const xml = pkg.text(p.path);
    if (xml === undefined) {
      warn({ code: "PART_MISSING", message: `Worksheet part not found: ${p.path}`, sheet: p.entry.name });
      continue;
    }
    p.data = parseSheet(xml, {
      styles: styleTable.styles,
      sst,
      formatter,
      rich,
      color: (attrs) => resolveColor(colorSpec({ uri: "", local: "color", attrs, children: [], text: "" }), styleTable.colors),
      warn,
      sheetName: p.entry.name,
      maxCells: maxCells - totalCells,
      date1904: wb.date1904,
    });
    for (const r in p.data.cells) totalCells += Object.keys(p.data.cells[r]!).length;
    if (p.data.formulasWithoutValue > 0) {
      warn({
        code: "FORMULA_WITHOUT_VALUE",
        message: `${p.data.formulasWithoutValue} formula cell(s) have no cached value and are shown empty`,
        sheet: p.entry.name,
      });
    }
  }

  const resolve = makeResolver(
    pending.map((p) => ({ name: p.entry.name, data: p.data })),
    wb.definedNames,
  );
  const transfer: ArrayBuffer[] = [];

  const sheets: SheetModel[] = pending.map((p, index) => {
    const d = p.data;
    const sheet: SheetModel = {
      name: p.entry.name,
      state: p.entry.state,
      defaultRowHeight: d?.defaultRowHeight ?? 20,
      baseColWidth: d?.baseColWidth ?? 8,
      rowCount: 0,
      colCount: 0,
      rows: d?.rows ?? {},
      cols: d?.cols ?? [],
      cells: d?.cells ?? {},
      merges: d?.merges ?? [],
      notes: [],
      images: [],
      shapes: [],
      charts: [],
      cf: {},
      view: d?.view ?? { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 100, topRow: 0, leftCol: 0 },
    };
    if (d?.defaultColWidth !== undefined) sheet.defaultColWidth = d.defaultColWidth;
    if (!d) return sheet;

    const sheetRes = (formula: string) => resolve(formula, index);
    readNotes(pkg, p.rels, d, sheet, persons, styleTable.colors, theme, warn);
    readDrawing(pkg, p.rels, d, sheet, theme, sheetRes, transfer, warn);

    if (d.cf.length) {
      const res = evaluateCf(d.cf, d.cells, styleTable.dxfs);
      sheet.cf = res.cf;
      if (res.unsupported.length) {
        warn({
          code: "CF_RULE_UNSUPPORTED",
          message: `Conditional formatting rules not applied: ${res.unsupported.join(", ")}`,
          sheet: p.entry.name,
        });
      }
    }

    let maxRow = d.maxRow;
    let maxCol = d.maxCol;
    for (const m of sheet.merges) {
      maxRow = Math.max(maxRow, m.r2);
      maxCol = Math.max(maxCol, m.c2);
    }
    for (const n of sheet.notes) {
      maxRow = Math.max(maxRow, n.row);
      maxCol = Math.max(maxCol, n.col);
    }
    for (const a of [...sheet.images.map((i) => i.anchor), ...sheet.charts.map((c) => c.anchor)]) {
      const end = a.to ?? a.from;
      maxRow = Math.max(maxRow, end.row);
      maxCol = Math.max(maxCol, end.col);
    }
    sheet.rowCount = maxRow + 1;
    sheet.colCount = maxCol + 1;
    return sheet;
  });

  const model: WorkbookModel = {
    sheets,
    styles: styleTable.styles,
    dxfs: styleTable.dxfs,
    date1904: wb.date1904,
    defaultFont: styleTable.defaultFont,
    warnings,
  };
  return { model, transfer };
}

function readNotes(
  pkg: OpcPackage,
  rels: Relationship[],
  d: SheetData,
  sheet: SheetModel,
  persons: Map<string, string>,
  colors: Parameters<typeof parseComments>[1],
  theme: Parameters<typeof parseComments>[2],
  warn: (w: XlViewerWarning) => void,
): void {
  const commentsRel = rels.find((r) => relIs(r, REL.comments));
  if (!commentsRel) return;
  const xml = pkg.text(commentsRel.target);
  if (!xml) return;
  let notes: NoteModel[];
  try {
    notes = parseComments(xml, colors, theme);
  } catch {
    warn({ code: "COMMENTS_PARSE_FAILED", message: "Comments could not be read", sheet: sheet.name, ref: commentsRel.target });
    return;
  }
  const vmlRel = rels.find((r) => r.id === d.legacyDrawingRelId) ?? rels.find((r) => relIs(r, REL.vmlDrawing));
  const vml = vmlRel ? pkg.text(vmlRel.target) : undefined;
  if (vml) {
    try {
      applyVml(notes, parseVmlNotes(vml));
    } catch {
      warn({ code: "VML_PARSE_FAILED", message: "Note box layout could not be read; default size used", sheet: sheet.name });
    }
  }
  const threadedRel = rels.find((r) => relIs(r, REL.threadedComment));
  const threadedXml = threadedRel ? pkg.text(threadedRel.target) : undefined;
  if (threadedXml) {
    try {
      const threads = parseThreadedComments(threadedXml, persons);
      for (const n of notes) {
        const t = threads.get(n.row + ":" + n.col);
        if (t?.length) n.threaded = t;
      }
    } catch {
      warn({
        code: "THREADED_COMMENTS_PARSE_FAILED",
        message: "Threaded comments could not be read; legacy notes shown",
        sheet: sheet.name,
      });
    }
  }
  sheet.notes = notes;
}

function readDrawing(
  pkg: OpcPackage,
  rels: Relationship[],
  d: SheetData,
  sheet: SheetModel,
  theme: Parameters<typeof parseChart>[2],
  resolve: RefResolver,
  transfer: ArrayBuffer[],
  warn: (w: XlViewerWarning) => void,
): void {
  const rel = rels.find((r) => r.id === d.drawingRelId);
  if (!rel) return;
  const root = pkg.xml(rel.target);
  if (!root) return;
  const drawingRels = pkg.rels(rel.target);
  const images: ImageModel[] = [];
  const charts: ChartModel[] = [];
  const shapes: ShapeModel[] = [];
  for (const item of parseDrawing(root, theme)) {
    if (item.kind === "shape") {
      shapes.push(item.shape);
      continue;
    }
    if (item.kind === "unsupportedChart") {
      charts.push({ ...unsupportedChart(item.anchor, theme), z: item.z });
      continue;
    }
    const target = drawingRels.find((r) => r.id === item.relId);
    if (!target || target.external) continue;
    if (item.kind === "image") {
      const ext = target.target.split(".").pop() ?? "";
      const mime = IMAGE_TYPES[ext] ?? "";
      const bytes = mime ? pkg.bytes(target.target) : undefined;
      const buffer = bytes ? bytes.slice().buffer : new ArrayBuffer(0);
      images.push({ anchor: item.anchor, ...(item.frame ? { frame: item.frame } : {}), z: item.z, mime: bytes ? mime : "", data: buffer });
      if (bytes) transfer.push(buffer);
      continue;
    }
    try {
      const chartRoot = pkg.xml(target.target);
      const chart = chartRoot ? parseChart(chartRoot, item.anchor, theme, resolve) : unsupportedChart(item.anchor, theme);
      chart.z = item.z;
      charts.push(chart);
    } catch (err) {
      const failed = unsupportedChart(item.anchor, theme);
      failed.z = item.z;
      failed.error = true;
      charts.push(failed);
      warn({
        code: "CHART_PARSE_FAILED",
        message: "Chart could not be parsed: " + (err instanceof Error ? err.message : String(err)),
        sheet: sheet.name,
        ref: target.target,
      });
    }
  }
  sheet.images = images;
  sheet.shapes = shapes;
  sheet.charts = charts;
}

function makeResolver(sheets: { name: string; data: SheetData | undefined }[], names: DefinedName[]) {
  const byName = new Map(sheets.map((s) => [s.name.toLowerCase(), s.data]));
  const read = (formula: string, current: number, depth: number): RefValue[] | undefined => {
    const f = formula
      .trim()
      .replace(/^=/, "")
      .replace(/^\((.*)\)$/, "$1");
    const ref = parseSheetRange(f);
    if (ref) {
      const data = ref.sheet === undefined ? sheets[current]?.data : byName.get(ref.sheet.toLowerCase());
      if (!data) return undefined;
      const { r1, c1, r2, c2 } = ref.range;
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_CHART_REF_CELLS) return undefined;
      const out: RefValue[] = [];
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const cell = data.cells[r]?.[c];
          if (!cell) out.push({ text: "" });
          else if (cell.type === "number" && typeof cell.value === "number") out.push({ text: cell.text, value: cell.value });
          else out.push({ text: cell.text });
        }
      }
      return out;
    }
    if (depth > 2 || !/^[A-Za-z_\\][\w.\\]*$/.test(f)) return undefined;
    const lower = f.toLowerCase();
    const def =
      names.find((n) => n.name.toLowerCase() === lower && n.sheet === current) ??
      names.find((n) => n.name.toLowerCase() === lower && n.sheet === undefined);
    return def ? read(def.formula, current, depth + 1) : undefined;
  };
  return (formula: string, current: number) => read(formula, current, 0);
}
