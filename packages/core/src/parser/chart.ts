import type { Anchor, ChartAxis, ChartKind, ChartModel, ChartSeries } from "../model/types.js";
import { lineStyle, solidFill, textFont } from "./drawingml.js";
import type { ThemeModel } from "./theme.js";
import { attrNum, child, children, descendants, NS, path, type XmlElement } from "./xml.js";

export interface RefValue {
  text: string;
  value?: number;
}

/** Resolves a chart formula (`Sheet1!$A$1:$A$5` or a defined name) to cell values, row-major. */
export type RefResolver = (formula: string) => RefValue[] | undefined;

type SeriesType = ChartSeries["type"];

const GROUPS: Record<string, { type: SeriesType; kind: ChartKind }> = {
  barChart: { type: "bar", kind: "bar" },
  bar3DChart: { type: "bar", kind: "bar" },
  lineChart: { type: "line", kind: "line" },
  line3DChart: { type: "line", kind: "line" },
  areaChart: { type: "area", kind: "area" },
  area3DChart: { type: "area", kind: "area" },
  pieChart: { type: "pie", kind: "pie" },
  pie3DChart: { type: "pie", kind: "pie" },
  ofPieChart: { type: "pie", kind: "pie" },
  doughnutChart: { type: "pie", kind: "doughnut" },
  scatterChart: { type: "scatter", kind: "scatter" },
};

const UNSUPPORTED = new Set(["radarChart", "bubbleChart", "stockChart", "surfaceChart", "surface3DChart"]);

const val = (el: XmlElement | undefined, name = "val") => el?.attrs[name];

/** CT_Boolean: present without `val` means true. */
function ctBool(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const v = el.attrs.val;
  return v === undefined || v === "1" || v === "true";
}

export function unsupportedChart(anchor: Anchor, theme: ThemeModel): ChartModel {
  return {
    anchor,
    kind: "unsupported",
    legend: "none",
    series: [],
    axes: { category: emptyAxis(), value: emptyAxis() },
    area: { fill: "#FFFFFF", border: "#D9D9D9" },
    options: { palette: theme.colors.slice(4, 10) },
  };
}

function emptyAxis(): ChartAxis {
  return { hidden: true, labels: false, gridlines: false };
}

export function parseChart(root: XmlElement, anchor: Anchor, theme: ThemeModel, resolve: RefResolver): ChartModel {
  const chart = child(root, "chart", NS.c);
  const plotArea = child(chart, "plotArea", NS.c);
  if (!chart || !plotArea) return unsupportedChart(anchor, theme);

  const axesById = new Map<string, XmlElement>();
  for (const el of plotArea.children) {
    if (el.uri === NS.c && (el.local === "catAx" || el.local === "valAx" || el.local === "dateAx" || el.local === "serAx")) {
      const id = val(child(el, "axId", NS.c));
      if (id) axesById.set(id, el);
    }
  }

  const palette = theme.colors.slice(4, 10);
  const model: ChartModel = {
    anchor,
    kind: "unsupported",
    legend: "none",
    series: [],
    axes: { category: emptyAxis(), value: emptyAxis() },
    area: {},
    options: { palette },
  };

  const groups = plotArea.children.filter((el) => el.uri === NS.c && (GROUPS[el.local] || UNSUPPORTED.has(el.local)));
  if (groups.length === 0 || groups.some((g) => UNSUPPORTED.has(g.local))) return unsupportedChart(anchor, theme);

  let primaryValAxId: string | undefined;
  let primaryCatAxId: string | undefined;
  let seriesIndex = 0;
  const kinds = new Set<ChartKind>();

  for (const group of groups) {
    const def = GROUPS[group.local]!;
    kinds.add(def.kind);
    const axIds = children(group, "axId", NS.c).map((a) => val(a) ?? "");
    let catAxId = axIds[0];
    let valAxId = axIds[1];
    if (def.type === "scatter") {
      // Both axes are valAx; the horizontal one is the X axis.
      const a = axesById.get(axIds[0] ?? "");
      const pos = val(child(a, "axPos", NS.c));
      if (pos === "l" || pos === "r") [catAxId, valAxId] = [axIds[1], axIds[0]];
    }
    if (primaryValAxId === undefined) {
      primaryValAxId = valAxId;
      primaryCatAxId = catAxId;
    }
    const secondary = valAxId !== undefined && valAxId !== primaryValAxId;

    if (def.type === "bar") {
      model.options.horizontal = val(child(group, "barDir", NS.c)) === "bar";
      const gw = attrNum(child(group, "gapWidth", NS.c), "val");
      if (gw !== undefined) model.options.gapWidth = gw;
      const ov = attrNum(child(group, "overlap", NS.c), "val");
      if (ov !== undefined) model.options.overlap = ov;
    }
    const grouping = val(child(group, "grouping", NS.c));
    if (grouping === "stacked" || grouping === "percentStacked" || grouping === "clustered" || grouping === "standard") {
      if (!model.options.grouping || model.options.grouping === "clustered" || model.options.grouping === "standard") {
        model.options.grouping = grouping;
      }
    }
    if (def.kind === "doughnut") model.options.holeSize = attrNum(child(group, "holeSize", NS.c), "val") ?? 50;
    if (def.type === "pie") {
      const fsa = attrNum(child(group, "firstSliceAng", NS.c), "val");
      if (fsa !== undefined) model.options.firstSliceAngle = fsa;
      model.options.varyColors = val(child(group, "varyColors", NS.c)) !== "0";
    }
    const groupLabels = showValue(child(group, "dLbls", NS.c));
    const scatterStyle = val(child(group, "scatterStyle", NS.c));
    const groupMarker = val(child(group, "marker", NS.c));

    for (const ser of children(group, "ser", NS.c)) {
      const s = parseSeries(ser, def.type, theme, resolve, seriesIndex, palette);
      seriesIndex++;
      if (secondary) s.secondary = true;
      const lbl = showValue(child(ser, "dLbls", NS.c)) ?? groupLabels;
      if (lbl) s.labels = true;
      if (def.type === "scatter") {
        s.lines = s.lineWidth !== 0 && scatterStyle !== "marker" && scatterStyle !== "none";
        if (scatterStyle === "smoothMarker" || scatterStyle === "smooth") s.smooth = true;
      }
      if (def.type === "line" && groupMarker === "0" && s.marker === undefined) s.marker = false;
      model.series.push(s);
    }
  }

  model.kind = kinds.size > 1 ? "combo" : [...kinds][0]!;

  const catAx = axesById.get(primaryCatAxId ?? "");
  const valAx = axesById.get(primaryValAxId ?? "");
  model.axes.category = parseAxis(catAx, theme, true);
  model.axes.value = parseAxis(valAx, theme, false);
  const secondaryVal = model.series.find((s) => s.secondary);
  if (secondaryVal) {
    for (const group of groups) {
      const ids = children(group, "axId", NS.c).map((a) => val(a) ?? "");
      if (ids[1] && ids[1] !== primaryValAxId) {
        model.axes.secondary = parseAxis(axesById.get(ids[1]), theme, false);
        break;
      }
    }
  }

  // Title
  const title = child(chart, "title", NS.c);
  const autoDeleted = val(child(chart, "autoTitleDeleted", NS.c)) === "1";
  if (title) {
    const text = richText(child(title, "tx", NS.c), resolve);
    if (text) model.title = text;
    else if (model.series.length === 1) model.title = model.series[0]!.name;
    const font = textFont(path(title, "tx/rich", NS.c) ?? child(title, "txPr", NS.c), theme);
    if (font) model.titleFont = font;
  } else if (!autoDeleted && model.series.length === 1 && model.series[0]!.name) {
    model.title = model.series[0]!.name;
  }

  const legend = child(chart, "legend", NS.c);
  if (legend) {
    const pos = val(child(legend, "legendPos", NS.c)) ?? "r";
    model.legend = pos === "b" ? "bottom" : pos === "t" ? "top" : pos === "l" ? "left" : "right";
    const font = textFont(child(legend, "txPr", NS.c), theme);
    if (font) model.legendFont = font;
  }

  // Chart and plot area
  const spPr = child(root, "spPr", NS.c);
  const fill = solidFill(spPr, theme);
  model.area.fill = fill === null ? "transparent" : (fill ?? "#FFFFFF");
  const border = lineStyle(spPr, theme);
  if (border) {
    model.area.border = border.color;
    model.area.borderWidth = border.width;
  } else if (border === undefined) model.area.border = "#D9D9D9";

  const layout = path(plotArea, "layout/manualLayout", NS.c);
  if (layout) {
    const x = attrNum(child(layout, "x", NS.c), "val");
    const y = attrNum(child(layout, "y", NS.c), "val");
    const w = attrNum(child(layout, "w", NS.c), "val");
    const h = attrNum(child(layout, "h", NS.c), "val");
    if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) model.plot = { x, y, w, h };
  }
  const plotFill = solidFill(child(plotArea, "spPr", NS.c), theme);
  if (plotFill) (model.plot ??= { x: NaN, y: NaN, w: NaN, h: NaN }).fill = plotFill;

  return model;
}

function showValue(dLbls: XmlElement | undefined): boolean | undefined {
  if (!dLbls) return undefined;
  if (ctBool(child(dLbls, "delete", NS.c))) return false;
  const v = val(child(dLbls, "showVal", NS.c));
  return v === undefined ? undefined : v === "1";
}

function parseSeries(
  ser: XmlElement,
  type: SeriesType,
  theme: ThemeModel,
  resolve: RefResolver,
  index: number,
  palette: string[],
): ChartSeries {
  const s: ChartSeries = {
    name: richText(child(ser, "tx", NS.c), resolve) ?? `Series${index + 1}`,
    type,
    categories: [],
    values: [],
  };
  const isXY = type === "scatter";
  const catEl = child(ser, isXY ? "xVal" : "cat", NS.c);
  const valEl = child(ser, isXY ? "yVal" : "val", NS.c);
  s.values = readData(valEl, resolve).map((v) =>
    v === null ? null : typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : 0,
  );
  const cats = readData(catEl, resolve);
  s.categories = cats.length ? cats.map((v) => (v === null ? "" : v)) : s.values.map((_, i) => i + 1);

  const spPr = child(ser, "spPr", NS.c);
  const fill = solidFill(spPr, theme);
  const line = lineStyle(spPr, theme);
  const fallback = seriesColor(index, palette);
  if (type === "line" || type === "scatter") {
    s.color = line?.color ?? (fill || undefined) ?? fallback;
    if (line === null) s.lineWidth = 0;
    else if (line) s.lineWidth = line.width;
  } else {
    s.color = fill ?? fallback;
    if (line) s.border = line;
  }
  const marker = child(ser, "marker", NS.c);
  if (marker) {
    const symbol = val(child(marker, "symbol", NS.c));
    if (symbol === "none") s.marker = false;
    else if (symbol) s.marker = true;
  }
  if (val(child(ser, "smooth", NS.c)) === "1") s.smooth = true;

  const points = children(ser, "dPt", NS.c);
  if (points.length) {
    s.pointColors = {};
    for (const p of points) {
      const idx = attrNum(child(p, "idx", NS.c), "val");
      const c = solidFill(child(p, "spPr", NS.c), theme);
      if (idx !== undefined && c) s.pointColors[idx] = c;
    }
  }
  return s;
}

/** Excel's default series colours: accents, then darker and lighter variants. */
export function seriesColor(index: number, palette: string[]): string {
  return palette[index % palette.length] ?? "#4472C4";
}

function readData(el: XmlElement | undefined, resolve: RefResolver): (string | number | null)[] {
  if (!el) return [];
  for (const kind of ["numRef", "strRef", "multiLvlStrRef"]) {
    const ref = child(el, kind, NS.c);
    if (!ref) continue;
    const formula = child(ref, "f", NS.c)?.text.trim();
    const live = formula ? resolve(formula) : undefined;
    if (live) {
      return live.map((v) => (v.value !== undefined && kind === "numRef" ? v.value : v.text === "" ? null : (v.value ?? v.text)));
    }
    const cache = child(ref, "numCache", NS.c) ?? child(ref, "strCache", NS.c) ?? child(ref, "multiLvlStrCache", NS.c);
    if (cache) return readCache(cache);
  }
  const lit = child(el, "numLit", NS.c) ?? child(el, "strLit", NS.c);
  if (lit) return readCache(lit);
  return [];
}

function readCache(cache: XmlElement): (string | number | null)[] {
  const isNum = cache.local === "numCache" || cache.local === "numLit";
  const count = attrNum(child(cache, "ptCount", NS.c), "val") ?? 0;
  const out: (string | number | null)[] = new Array(count).fill(null);
  // multiLvlStrCache nests points under lvl; the first level is the innermost label.
  const pts = cache.local === "multiLvlStrCache" ? children(child(cache, "lvl", NS.c), "pt", NS.c) : children(cache, "pt", NS.c);
  for (const pt of pts) {
    const idx = attrNum(pt, "idx");
    if (idx === undefined) continue;
    const text = child(pt, "v", NS.c)?.text ?? "";
    out[idx] = isNum ? (Number.isFinite(Number(text)) ? Number(text) : null) : text;
  }
  return out;
}

function richText(tx: XmlElement | undefined, resolve: RefResolver): string | undefined {
  if (!tx) return undefined;
  const strRef = child(tx, "strRef", NS.c);
  if (strRef) {
    const f = child(strRef, "f", NS.c)?.text.trim();
    const live = f ? resolve(f) : undefined;
    if (live && live.length) return live.map((v) => v.text).join(" ");
    const cached = child(strRef, "strCache", NS.c);
    if (cached)
      return readCache(cached)
        .filter((v) => v !== null)
        .join(" ");
  }
  const v = child(tx, "v", NS.c);
  if (v) return v.text;
  const rich = child(tx, "rich", NS.c);
  if (rich) {
    const paras = children(rich, "p", NS.a).map((p) =>
      descendants(p, "t", NS.a)
        .map((t) => t.text)
        .join(""),
    );
    const text = paras.join("\n").trim();
    return text || undefined;
  }
  return undefined;
}

function parseAxis(el: XmlElement | undefined, theme: ThemeModel, isCategory: boolean): ChartAxis {
  if (!el) return emptyAxis();
  const hidden = ctBool(child(el, "delete", NS.c));
  const tickLbl = val(child(el, "tickLblPos", NS.c));
  const axis: ChartAxis = {
    hidden,
    labels: !hidden && tickLbl !== "none",
    gridlines: !!child(el, "majorGridlines", NS.c),
  };
  const pos = val(child(el, "axPos", NS.c));
  if (pos === "b" || pos === "t" || pos === "l" || pos === "r") axis.position = pos;
  const scaling = child(el, "scaling", NS.c);
  if (val(child(scaling, "orientation", NS.c)) === "maxMin") axis.reversed = true;
  const min = attrNum(child(scaling, "min", NS.c), "val");
  if (min !== undefined) axis.min = min;
  const max = attrNum(child(scaling, "max", NS.c), "val");
  if (max !== undefined) axis.max = max;
  const major = attrNum(child(el, "majorUnit", NS.c), "val");
  if (major !== undefined && major > 0) axis.majorUnit = major;
  const nf = child(el, "numFmt", NS.c)?.attrs.formatCode;
  if (nf && nf !== "General" && nf !== "@") axis.numFmt = nf;
  const title = child(el, "title", NS.c);
  if (title) {
    const t = richText(child(title, "tx", NS.c), () => undefined);
    if (t) axis.title = t;
  }
  const line = lineStyle(child(el, "spPr", NS.c), theme);
  if (line) axis.line = line;
  else if (line === undefined && isCategory) axis.line = { color: "#D9D9D9", width: 1 };
  if (axis.gridlines) {
    const g = lineStyle(child(child(el, "majorGridlines", NS.c), "spPr", NS.c), theme);
    axis.grid = g ?? { color: "#D9D9D9", width: 1 };
  }
  const font = textFont(child(el, "txPr", NS.c), theme);
  if (font) axis.font = font;
  return axis;
}
