import { applyDrawingTint, applyLum, applyShade, normalizeRgb } from "../format/color.js";
import { fontFamily } from "../format/fonts.js";
import { emuToPx } from "../format/units.js";
import type { ChartFont } from "../model/types.js";
import type { ThemeModel } from "./theme.js";
import { attrNum, child, NS, path, type XmlElement } from "./xml.js";

const SCHEME_SLOTS: Record<string, number> = {
  dk1: 0,
  lt1: 1,
  dk2: 2,
  lt2: 3,
  tx1: 0,
  bg1: 1,
  tx2: 2,
  bg2: 3,
  accent1: 4,
  accent2: 5,
  accent3: 6,
  accent4: 7,
  accent5: 8,
  accent6: 9,
  hlink: 10,
  folHlink: 11,
};

const PRESET: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  gray: "#808080",
  grey: "#808080",
};

/** Resolves a DrawingML colour choice element (srgbClr, schemeClr, ...) with its modifiers. */
export function drawingColor(el: XmlElement | undefined, theme: ThemeModel, phClr?: string): string | undefined {
  if (!el) return undefined;
  let base: string | undefined;
  switch (el.local) {
    case "srgbClr":
      base = normalizeRgb(el.attrs.val ?? "");
      break;
    case "schemeClr": {
      const v = el.attrs.val ?? "";
      if (v === "phClr") base = phClr;
      else {
        const slot = SCHEME_SLOTS[v];
        base = slot !== undefined ? theme.colors[slot] : undefined;
      }
      break;
    }
    case "sysClr":
      base = normalizeRgb(el.attrs.lastClr ?? "") ?? (el.attrs.val === "window" ? "#FFFFFF" : "#000000");
      break;
    case "prstClr":
      base = PRESET[el.attrs.val ?? ""];
      break;
    case "scrgbClr": {
      const c = (k: string) => Math.round(((attrNum(el, k) ?? 0) / 100000) * 255);
      base =
        "#" +
        [c("r"), c("g"), c("b")]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
      break;
    }
  }
  if (!base) return undefined;
  let lumMod: number | undefined;
  let lumOff: number | undefined;
  for (const m of el.children) {
    const v = attrNum(m, "val");
    if (v === undefined) continue;
    if (m.local === "lumMod") lumMod = v;
    else if (m.local === "lumOff") lumOff = v;
    else if (m.local === "shade") base = applyShade(base, v);
    else if (m.local === "tint") base = applyDrawingTint(base, v);
  }
  if (lumMod !== undefined || lumOff !== undefined) base = applyLum(base, lumMod, lumOff);
  return base;
}

export function solidFill(spPr: XmlElement | undefined, theme: ThemeModel): string | undefined | null {
  if (!spPr) return undefined;
  if (child(spPr, "noFill", NS.a)) return null;
  const fill = child(spPr, "solidFill", NS.a);
  if (fill) return drawingColor(fill.children[0], theme);
  const grad = child(spPr, "gradFill", NS.a);
  if (grad) return drawingColor(path(grad, "gsLst/gs", NS.a)?.children[0], theme);
  return undefined;
}

/** Line colour and width (px). null means explicitly no line. */
export function lineStyle(spPr: XmlElement | undefined, theme: ThemeModel): { color: string; width: number } | null | undefined {
  const ln = child(spPr, "ln", NS.a);
  if (!ln) return undefined;
  if (child(ln, "noFill", NS.a)) return null;
  const color = drawingColor(child(ln, "solidFill", NS.a)?.children[0], theme);
  const w = attrNum(ln, "w");
  if (!color) return undefined;
  return { color, width: w !== undefined ? Math.max(0.5, emuToPx(w)) : 1 };
}

/** Text properties from `txPr` (or `rich`) -> font. */
export function textFont(txPr: XmlElement | undefined, theme: ThemeModel): ChartFont | undefined {
  if (!txPr) return undefined;
  const p = child(txPr, "p", NS.a);
  const rPr = path(p, "pPr/defRPr", NS.a) ?? path(p, "r/rPr", NS.a);
  if (!rPr) return undefined;
  const font: ChartFont = {};
  const sz = attrNum(rPr, "sz");
  if (sz) font.size = (sz / 100) * (96 / 72);
  if (rPr.attrs.b !== undefined) font.bold = rPr.attrs.b === "1";
  const color = drawingColor(child(rPr, "solidFill", NS.a)?.children[0], theme);
  if (color) font.color = color;
  const latin = child(rPr, "latin", NS.a)?.attrs.typeface;
  if (latin && !latin.startsWith("+")) font.family = fontFamily(latin, theme.minorFontHangul);
  return Object.keys(font).length ? font : undefined;
}
