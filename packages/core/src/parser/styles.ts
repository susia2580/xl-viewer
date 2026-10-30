import { mix, normalizeRgb, resolveColor, DEFAULT_INDEXED, type ColorContext, type ColorSpec } from "../format/color.js";
import { fontFamily } from "../format/fonts.js";
import { builtinFormat } from "../format/number.js";
import { ptToPx } from "../format/units.js";
import type { BorderSide, BorderStyle, Borders, DiffStyle, HAlign, ResolvedFont, ResolvedStyle, VAlign } from "../model/types.js";
import type { ThemeModel } from "./theme.js";
import { attrBool, attrNum, child, children, NS, type XmlElement } from "./xml.js";

export interface StyleTable {
  styles: ResolvedStyle[];
  dxfs: DiffStyle[];
  defaultFont: ResolvedFont;
  colors: ColorContext;
}

interface RawXf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  alignment?: XmlElement;
  xfId?: number;
  apply: Record<string, boolean | undefined>;
}

const BORDER_STYLES = new Set<BorderStyle>([
  "thin",
  "medium",
  "thick",
  "dashed",
  "dotted",
  "double",
  "hair",
  "mediumDashed",
  "dashDot",
  "mediumDashDot",
  "dashDotDot",
  "mediumDashDotDot",
  "slantDashDot",
]);

const PATTERN_DENSITY: Record<string, number> = {
  darkGray: 0.75,
  mediumGray: 0.5,
  lightGray: 0.25,
  gray125: 0.125,
  gray0625: 0.0625,
};

export function colorSpec(el: XmlElement | undefined): ColorSpec | undefined {
  if (!el) return undefined;
  const spec: ColorSpec = {};
  if (el.attrs.rgb) spec.rgb = el.attrs.rgb;
  const theme = attrNum(el, "theme");
  if (theme !== undefined) spec.theme = theme;
  const indexed = attrNum(el, "indexed");
  if (indexed !== undefined) spec.indexed = indexed;
  const tint = attrNum(el, "tint");
  if (tint) spec.tint = tint;
  if (el.attrs.auto === "1" || el.attrs.auto === "true") spec.auto = true;
  return spec;
}

export function parseStyles(root: XmlElement | undefined, theme: ThemeModel, numFmtOverrides: Record<number, string>): StyleTable {
  const indexed = children(child(child(root, "colors", NS.main), "indexedColors", NS.main), "rgbColor", NS.main)
    .map((c) => normalizeRgb(c.attrs.rgb ?? ""))
    .filter((c): c is string => !!c);
  const colors: ColorContext = {
    theme: theme.colors,
    indexed: indexed.length ? [...indexed, ...DEFAULT_INDEXED.slice(indexed.length)] : DEFAULT_INDEXED,
  };

  const numFmts = new Map<number, string>();
  for (const f of children(child(root, "numFmts", NS.main), "numFmt", NS.main)) {
    const id = attrNum(f, "numFmtId");
    if (id !== undefined && f.attrs.formatCode !== undefined) numFmts.set(id, f.attrs.formatCode);
  }
  const fmt = (id: number) => numFmts.get(id) ?? builtinFormat(id, numFmtOverrides) ?? "General";

  const fonts = children(child(root, "fonts", NS.main), "font", NS.main).map((f) => parseFont(f, colors, theme));
  const defaultFont = fonts[0] ?? fallbackFont(theme);
  const fills = children(child(root, "fills", NS.main), "fill", NS.main).map((f) => parseFill(f, colors, false));
  const borders = children(child(root, "borders", NS.main), "border", NS.main).map((b) => parseBorder(b, colors));

  const styleXfs = children(child(root, "cellStyleXfs", NS.main), "xf", NS.main).map(rawXf);
  const cellXfs = children(child(root, "cellXfs", NS.main), "xf", NS.main).map(rawXf);
  if (cellXfs.length === 0) cellXfs.push({ numFmtId: 0, fontId: 0, fillId: 0, borderId: 0, apply: {} });

  const styles = cellXfs.map((xf): ResolvedStyle => {
    const parent = xf.xfId !== undefined ? styleXfs[xf.xfId] : undefined;
    // apply*="0" on a cell xf means the cell style (parent) wins for that group.
    const pick = <K extends "numFmtId" | "fontId" | "fillId" | "borderId">(key: K, flag: string): number =>
      xf.apply[flag] === false && parent ? parent[key] : xf[key];
    const alignment = xf.apply.alignment === false && parent ? parent.alignment : (xf.alignment ?? parent?.alignment);
    const font = fonts[pick("fontId", "font")] ?? defaultFont;
    const style: ResolvedStyle = {
      font,
      hAlign: (alignment?.attrs.horizontal as HAlign | undefined) ?? "general",
      vAlign: normalizeVAlign(alignment?.attrs.vertical),
      wrap: attrBool(alignment, "wrapText", false),
      shrink: attrBool(alignment, "shrinkToFit", false),
      indent: attrNum(alignment, "indent") ?? 0,
      rotation: attrNum(alignment, "textRotation") ?? 0,
      numFmt: fmt(pick("numFmtId", "numberFormat")),
    };
    const fill = fills[pick("fillId", "fill")];
    if (fill) style.fill = fill;
    const border = borders[pick("borderId", "border")];
    if (border) style.border = border;
    return style;
  });

  const dxfs = children(child(root, "dxfs", NS.main), "dxf", NS.main).map((d): DiffStyle => {
    const out: DiffStyle = {};
    const f = child(d, "font", NS.main);
    if (f) {
      const font: NonNullable<DiffStyle["font"]> = {};
      const b = child(f, "b", NS.main);
      if (b) font.bold = attrBool(b, "val", true);
      const i = child(f, "i", NS.main);
      if (i) font.italic = attrBool(i, "val", true);
      const s = child(f, "strike", NS.main);
      if (s) font.strike = attrBool(s, "val", true);
      const u = child(f, "u", NS.main);
      if (u) font.underline = underline(u);
      const c = resolveColor(colorSpec(child(f, "color", NS.main)), colors);
      if (c) font.color = c;
      out.font = font;
    }
    const fill = child(d, "fill", NS.main);
    if (fill) {
      const v = parseFill(fill, colors, true);
      if (v) out.fill = v;
    }
    const border = child(d, "border", NS.main);
    if (border) {
      const v = parseBorder(border, colors);
      if (v) out.border = v;
    }
    const nf = child(d, "numFmt", NS.main);
    if (nf?.attrs.formatCode) out.numFmt = nf.attrs.formatCode;
    return out;
  });

  return { styles, dxfs, defaultFont, colors };
}

function rawXf(el: XmlElement): RawXf {
  const xf: RawXf = {
    numFmtId: attrNum(el, "numFmtId") ?? 0,
    fontId: attrNum(el, "fontId") ?? 0,
    fillId: attrNum(el, "fillId") ?? 0,
    borderId: attrNum(el, "borderId") ?? 0,
    apply: {},
  };
  const alignment = child(el, "alignment", NS.main);
  if (alignment) xf.alignment = alignment;
  const xfId = attrNum(el, "xfId");
  if (xfId !== undefined) xf.xfId = xfId;
  for (const k of ["numberFormat", "font", "fill", "border", "alignment"]) {
    const v = el.attrs["apply" + k[0]!.toUpperCase() + k.slice(1)];
    if (v !== undefined) xf.apply[k] = v === "1" || v === "true";
  }
  return xf;
}

function normalizeVAlign(v: string | undefined): VAlign {
  if (v === "top" || v === "justify" || v === "distributed") return v;
  if (v === "center") return "middle";
  return "bottom";
}

function underline(el: XmlElement): ResolvedFont["underline"] {
  const v = el.attrs.val ?? "single";
  if (v === "none") return "none";
  return v.startsWith("double") ? "double" : "single";
}

function fallbackFont(theme: ThemeModel): ResolvedFont {
  return {
    name: theme.minorFont,
    family: fontFamily(theme.minorFont),
    sizePx: ptToPx(11),
    bold: false,
    italic: false,
    underline: "none",
    strike: false,
    color: "#000000",
  };
}

export function parseFont(f: XmlElement, colors: ColorContext, theme: ThemeModel): ResolvedFont {
  const name = child(f, "name", NS.main)?.attrs.val ?? child(f, "rFont", NS.main)?.attrs.val ?? theme.minorFont;
  const u = child(f, "u", NS.main);
  const font: ResolvedFont = {
    name,
    family: fontFamily(name, theme.minorFontHangul),
    sizePx: ptToPx(attrNum(child(f, "sz", NS.main), "val") ?? 11),
    bold: child(f, "b", NS.main) ? attrBool(child(f, "b", NS.main), "val", true) : false,
    italic: child(f, "i", NS.main) ? attrBool(child(f, "i", NS.main), "val", true) : false,
    underline: u ? underline(u) : "none",
    strike: child(f, "strike", NS.main) ? attrBool(child(f, "strike", NS.main), "val", true) : false,
    color: resolveColor(colorSpec(child(f, "color", NS.main)), colors, "#000000") ?? "#000000",
  };
  const va = child(f, "vertAlign", NS.main)?.attrs.val;
  if (va === "superscript" || va === "subscript") font.vertAlign = va;
  return font;
}

/** Partial font for rich text runs (`rPr`). */
export function parseRunFont(rPr: XmlElement, colors: ColorContext, theme: ThemeModel): Partial<ResolvedFont> {
  const out: Partial<ResolvedFont> = {};
  for (const c of rPr.children) {
    switch (c.local) {
      case "rFont":
      case "name":
        if (c.attrs.val) {
          out.name = c.attrs.val;
          out.family = fontFamily(c.attrs.val, theme.minorFontHangul);
        }
        break;
      case "sz": {
        const v = attrNum(c, "val");
        if (v) out.sizePx = ptToPx(v);
        break;
      }
      case "b":
        out.bold = attrBool(c, "val", true);
        break;
      case "i":
        out.italic = attrBool(c, "val", true);
        break;
      case "strike":
        out.strike = attrBool(c, "val", true);
        break;
      case "u":
        out.underline = underline(c);
        break;
      case "color": {
        const v = resolveColor(colorSpec(c), colors);
        if (v) out.color = v;
        break;
      }
      case "vertAlign":
        if (c.attrs.val === "superscript" || c.attrs.val === "subscript") out.vertAlign = c.attrs.val;
        break;
    }
  }
  return out;
}

function parseFill(el: XmlElement, colors: ColorContext, differential: boolean): string | undefined {
  const pattern = child(el, "patternFill", NS.main);
  if (pattern) {
    const type = pattern.attrs.patternType ?? (differential ? "solid" : "none");
    if (type === "none") return undefined;
    const fg = resolveColor(colorSpec(child(pattern, "fgColor", NS.main)), colors);
    const bg = resolveColor(colorSpec(child(pattern, "bgColor", NS.main)), colors);
    // In dxfs a solid fill stores its colour in bgColor.
    if (type === "solid") return differential ? (bg ?? fg) : (fg ?? bg ?? "#000000");
    const density = PATTERN_DENSITY[type] ?? 0.5;
    return mix(bg ?? "#FFFFFF", fg ?? "#000000", density);
  }
  const gradient = child(el, "gradientFill", NS.main);
  if (gradient) {
    const stops = children(gradient, "stop", NS.main);
    const first = resolveColor(colorSpec(child(stops[0], "color", NS.main)), colors);
    const last = resolveColor(colorSpec(child(stops[stops.length - 1], "color", NS.main)), colors);
    if (first && last) return mix(first, last, 0.5);
    return first ?? last;
  }
  return undefined;
}

function parseBorder(el: XmlElement, colors: ColorContext): Borders | undefined {
  const side = (names: string[]): BorderSide | undefined => {
    for (const n of names) {
      const s = child(el, n, NS.main);
      const style = s?.attrs.style as BorderStyle | undefined;
      if (s && style && BORDER_STYLES.has(style)) {
        return { style, color: resolveColor(colorSpec(child(s, "color", NS.main)), colors, "#000000") ?? "#000000" };
      }
    }
    return undefined;
  };
  const out: Borders = {};
  const left = side(["left", "start"]);
  const right = side(["right", "end"]);
  const top = side(["top"]);
  const bottom = side(["bottom"]);
  if (left) out.left = left;
  if (right) out.right = right;
  if (top) out.top = top;
  if (bottom) out.bottom = bottom;
  const diagonal = side(["diagonal"]);
  if (diagonal) {
    if (attrBool(el, "diagonalUp", false)) out.diagonalUp = diagonal;
    if (attrBool(el, "diagonalDown", false)) out.diagonalDown = diagonal;
  }
  return Object.keys(out).length ? out : undefined;
}
