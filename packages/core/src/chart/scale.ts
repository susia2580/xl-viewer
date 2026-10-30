export interface AxisScale {
  min: number;
  max: number;
  interval: number;
}

/** Major unit Excel picks for a value range: 1, 2 or 5 times a power of ten, aiming for 5-10 steps. */
export function niceUnit(range: number): number {
  if (!(range > 0)) return 1;
  const raw = range / 8;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/**
 * Approximates Excel's automatic value axis: zero-based when the data allows,
 * and the maximum is the first major unit above max + 5% of the range.
 */
export function excelScale(dataMin: number, dataMax: number, fixed: { min?: number; max?: number; majorUnit?: number }): AxisScale {
  let lo = Math.min(dataMin, dataMax);
  let hi = Math.max(dataMin, dataMax);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  let min: number;
  if (fixed.min !== undefined) min = fixed.min;
  else if (lo >= 0) min = lo > (5 / 6) * hi ? lo : 0;
  else min = lo;
  if (hi <= 0 && fixed.max === undefined && lo < 0) hi = 0;
  const unit = fixed.majorUnit ?? niceUnit((fixed.max ?? hi) - min || Math.abs(hi) || 1);
  if (fixed.min === undefined && min !== 0) min = Math.floor((min - 0.05 * (hi - min)) / unit) * unit;
  let max = fixed.max ?? Math.ceil((hi + 0.05 * (hi - min)) / unit) * unit;
  if (max <= min) max = min + unit;
  return { min: round(min), max: round(max), interval: unit };
}

function round(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}
