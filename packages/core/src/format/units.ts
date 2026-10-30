export const EMU_PER_PX = 9525;

export function ptToPx(pt: number): number {
  return (pt * 96) / 72;
}

export function emuToPx(emu: number): number {
  return emu / EMU_PER_PX;
}

/** ECMA-376 Part 1, 18.3.1.13: column width (characters) -> px. */
export function colWidthToPx(width: number, mdw: number): number {
  return Math.trunc(((256 * width + Math.trunc(128 / mdw)) / 256) * mdw);
}

/** Default column width when the sheet only stores `baseColWidth`. */
export function baseColWidthToPx(baseColWidth: number, mdw: number): number {
  // Matches Excel: 8 base chars at MDW 7 -> 64px.
  return baseColWidth * mdw + 8;
}

/** VML lengths ("144pt", "1.5in", "100px", "2cm"). */
export function cssLengthToPx(value: string): number | undefined {
  const m = /^(-?[\d.]+)(pt|px|in|cm|mm|em)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case "pt":
      return ptToPx(n);
    case "in":
      return n * 96;
    case "cm":
      return (n * 96) / 2.54;
    case "mm":
      return (n * 96) / 25.4;
    case "em":
      return n * 16;
    default:
      return n;
  }
}
