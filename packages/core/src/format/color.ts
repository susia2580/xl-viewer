/** ECMA-376 Part 1, 18.8.27 default indexed palette. 64/65 are system fg/bg. */
export const DEFAULT_INDEXED: readonly string[] = [
  "#000000",
  "#FFFFFF",
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF00FF",
  "#00FFFF",
  "#000000",
  "#FFFFFF",
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF00FF",
  "#00FFFF",
  "#800000",
  "#008000",
  "#000080",
  "#808000",
  "#800080",
  "#008080",
  "#C0C0C0",
  "#808080",
  "#9999FF",
  "#993366",
  "#FFFFCC",
  "#CCFFFF",
  "#660066",
  "#FF8080",
  "#0066CC",
  "#CCCCFF",
  "#000080",
  "#FF00FF",
  "#FFFF00",
  "#00FFFF",
  "#800080",
  "#800000",
  "#008080",
  "#0000FF",
  "#00CCFF",
  "#CCFFFF",
  "#CCFFCC",
  "#FFFF99",
  "#99CCFF",
  "#FF99CC",
  "#CC99FF",
  "#FFCC99",
  "#3366FF",
  "#33CCCC",
  "#99CC00",
  "#FFCC00",
  "#FF9900",
  "#FF6600",
  "#666699",
  "#969696",
  "#003366",
  "#339966",
  "#003300",
  "#333300",
  "#993300",
  "#993366",
  "#333399",
  "#333333",
  "#000000",
  "#FFFFFF",
];

/** Office 2013+ default theme, used when a file has no theme part. */
export const DEFAULT_THEME_COLORS: readonly string[] = [
  "#000000", // dk1
  "#FFFFFF", // lt1
  "#44546A", // dk2
  "#E7E6E6", // lt2
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
  "#0563C1", // hlink
  "#954F72", // folHlink
];

export interface ColorContext {
  /** Scheme order: dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink. */
  theme: readonly string[];
  indexed: readonly string[];
}

export interface ColorSpec {
  rgb?: string;
  theme?: number;
  indexed?: number;
  tint?: number;
  auto?: boolean;
}

/** Spreadsheet `theme` attribute -> scheme slot. 0/1 and 2/3 are swapped. */
export function themeSlot(index: number): number {
  if (index === 0) return 1;
  if (index === 1) return 0;
  if (index === 2) return 3;
  if (index === 3) return 2;
  return index;
}

export function resolveColor(spec: ColorSpec | undefined, ctx: ColorContext, fallback?: string): string | undefined {
  if (!spec) return fallback;
  let base: string | undefined;
  if (spec.rgb) base = normalizeRgb(spec.rgb);
  else if (spec.theme !== undefined) base = ctx.theme[themeSlot(spec.theme)];
  else if (spec.indexed !== undefined) base = ctx.indexed[spec.indexed] ?? DEFAULT_INDEXED[spec.indexed];
  else if (spec.auto) base = fallback;
  if (!base) return fallback;
  return spec.tint ? applyTint(base, spec.tint) : base;
}

/** "FF112233" / "112233" / "#112233" -> "#112233". Alpha is ignored. */
export function normalizeRgb(value: string): string | undefined {
  const v = value.replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(v)) return "#" + v.slice(2).toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(v)) return "#" + v.toUpperCase();
  return undefined;
}

export function applyTint(hex: string, tint: number): string {
  const [h, s, l] = rgbToHsl(hex);
  const nl = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hslToRgb(h, s, Math.min(1, Math.max(0, nl)));
}

/** DrawingML lumMod/lumOff (values in 1/100000). */
export function applyLum(hex: string, lumMod?: number, lumOff?: number): string {
  const [h, s, l] = rgbToHsl(hex);
  let nl = l;
  if (lumMod !== undefined) nl *= lumMod / 100000;
  if (lumOff !== undefined) nl += lumOff / 100000;
  return hslToRgb(h, s, Math.min(1, Math.max(0, nl)));
}

/** DrawingML shade/tint (values in 1/100000). */
export function applyShade(hex: string, shade: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = shade / 100000;
  return rgbToHex(r * f, g * f, b * f);
}

export function applyDrawingTint(hex: string, tint: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = tint / 100000;
  return rgbToHex(255 - (255 - r) * f, 255 - (255 - g) * f, 255 - (255 - b) * f);
}

export function mix(a: string, b: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * ratio, g1 + (g2 - g1) * ratio, b1 + (b2 - b1) * ratio);
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.round(Math.min(255, Math.max(0, x)))
      .toString(16)
      .padStart(2, "0");
  return ("#" + c(r) + c(g) + c(b)).toUpperCase();
}

function rgbToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): string {
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255);
}
