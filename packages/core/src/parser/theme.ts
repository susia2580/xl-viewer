import { DEFAULT_THEME_COLORS, normalizeRgb } from "../format/color.js";
import { quoteFontName } from "../format/fonts.js";
import { child, NS, type XmlElement } from "./xml.js";

export interface ThemeModel {
  /** dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink */
  colors: string[];
  majorFont: string;
  minorFont: string;
  /** Hangul fallback from the font scheme, if any. */
  minorFontHangul?: string;
}

const SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

export const DEFAULT_THEME: ThemeModel = {
  colors: [...DEFAULT_THEME_COLORS],
  majorFont: "Calibri Light",
  minorFont: "Calibri",
};

export function parseTheme(root: XmlElement | undefined): ThemeModel {
  if (!root) return DEFAULT_THEME;
  const elements = child(root, "themeElements", NS.a);
  const scheme = child(elements, "clrScheme", NS.a);
  const colors = SLOTS.map((slot, i) => {
    const el = child(scheme, slot, NS.a);
    const c = el?.children[0];
    let v: string | undefined;
    if (c?.local === "srgbClr") v = normalizeRgb(c.attrs.val ?? "");
    else if (c?.local === "sysClr") v = normalizeRgb(c.attrs.lastClr ?? "") ?? (c.attrs.val === "window" ? "#FFFFFF" : "#000000");
    return v ?? DEFAULT_THEME_COLORS[i]!;
  });
  const fonts = child(elements, "fontScheme", NS.a);
  const major = child(fonts, "majorFont", NS.a);
  const minor = child(fonts, "minorFont", NS.a);
  const hang = minor?.children.find((c) => c.local === "font" && c.attrs.script === "Hang");
  const theme: ThemeModel = {
    colors,
    majorFont: child(major, "latin", NS.a)?.attrs.typeface || DEFAULT_THEME.majorFont,
    minorFont: child(minor, "latin", NS.a)?.attrs.typeface || DEFAULT_THEME.minorFont,
  };
  if (hang?.attrs.typeface) theme.minorFontHangul = quoteFontName(hang.attrs.typeface);
  return theme;
}
