import type { ResolvedFont } from "../model/types.js";
import { cssFont } from "./canvas/text.js";

// Max digit widths Excel uses at 96 DPI. Fonts may be missing on the viewer's
// machine, so known values keep column widths identical to Excel.
const KNOWN: Record<string, number> = {
  "calibri|11": 7,
  "arial|10": 7,
  "aptos narrow|11": 7,
  "malgun gothic|11": 8,
  "맑은 고딕|11": 8,
};

export function maxDigitWidth(font: ResolvedFont, ctx: CanvasRenderingContext2D): number {
  const pt = Math.round(((font.sizePx * 72) / 96) * 2) / 2;
  const known = KNOWN[font.name.toLowerCase() + "|" + pt];
  if (known) return known;
  ctx.font = cssFont({ ...font, bold: false, italic: false, vertAlign: undefined }, 1);
  let max = 0;
  for (let d = 0; d <= 9; d++) max = Math.max(max, ctx.measureText(String(d)).width);
  return Math.max(1, Math.round(max));
}
