import type { BorderSide, BorderStyle } from "../../model/types.js";

const WEIGHT: Record<BorderStyle, number> = {
  hair: 1,
  dotted: 2,
  dashDotDot: 3,
  dashDot: 4,
  dashed: 5,
  thin: 6,
  mediumDashDotDot: 7,
  slantDashDot: 8,
  mediumDashDot: 9,
  mediumDashed: 10,
  medium: 11,
  thick: 12,
  double: 13,
};

const WIDTH: Record<BorderStyle, number> = {
  hair: 1,
  dotted: 1,
  dashDotDot: 1,
  dashDot: 1,
  dashed: 1,
  thin: 1,
  mediumDashDotDot: 2,
  slantDashDot: 2,
  mediumDashDot: 2,
  mediumDashed: 2,
  medium: 2,
  thick: 3,
  double: 3,
};

const DASH: Partial<Record<BorderStyle, number[]>> = {
  hair: [1, 1],
  dotted: [1, 1],
  dashed: [3, 1],
  dashDot: [3, 1, 1, 1],
  dashDotDot: [3, 1, 1, 1, 1, 1],
  mediumDashed: [6, 2],
  mediumDashDot: [6, 2, 2, 2],
  mediumDashDotDot: [6, 2, 2, 2, 2, 2],
  slantDashDot: [6, 2, 2, 2],
};

export function heavier(a: BorderSide | undefined, b: BorderSide | undefined): BorderSide | undefined {
  if (!a) return b;
  if (!b) return a;
  return WEIGHT[b.style] > WEIGHT[a.style] ? b : a;
}

/** Horizontal edge at y from x1 to x2, or vertical edge at x from y1 to y2. */
export interface Edge {
  side: BorderSide;
  horizontal: boolean;
  /** Boundary coordinate in px (y for horizontal, x for vertical). */
  at: number;
  from: number;
  to: number;
}

/**
 * Draws edges centred on the gridline pixel, which is the last pixel of the
 * cell before the boundary. `snap` maps css px to the device pixel grid.
 */
export function drawEdges(ctx: CanvasRenderingContext2D, edges: Edge[], snap: (v: number) => number, scale: number): void {
  for (const e of edges) {
    const style = e.side.style;
    const w = Math.max(1, Math.round(WIDTH[style] * Math.max(1, scale)));
    ctx.fillStyle = e.side.color;
    ctx.strokeStyle = e.side.color;
    const dash = DASH[style];
    // Extend one pixel back so adjacent edges meet at the corner.
    const start = snap(e.from) - 1;
    const end = snap(e.to);
    if (style === "double") {
      // Two 1px lines with a 1px gap, centred on the boundary.
      const base = snap(e.at) - 2;
      if (e.horizontal) {
        ctx.fillRect(start, base, end - start, 1);
        ctx.fillRect(start, base + 2, end - start, 1);
      } else {
        ctx.fillRect(base, start, 1, end - start);
        ctx.fillRect(base + 2, start, 1, end - start);
      }
      continue;
    }
    const offset = snap(e.at) - Math.ceil(w / 2);
    if (!dash) {
      if (e.horizontal) ctx.fillRect(start, offset, end - start, w);
      else ctx.fillRect(offset, start, w, end - start);
      continue;
    }
    ctx.save();
    ctx.lineWidth = w;
    ctx.setLineDash(dash.map((d) => d * w));
    ctx.beginPath();
    const mid = offset + w / 2;
    if (e.horizontal) {
      ctx.moveTo(start, mid);
      ctx.lineTo(end, mid);
    } else {
      ctx.moveTo(mid, start);
      ctx.lineTo(mid, end);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function drawDiagonal(
  ctx: CanvasRenderingContext2D,
  side: BorderSide,
  x: number,
  y: number,
  w: number,
  h: number,
  up: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = side.color;
  ctx.lineWidth = WIDTH[side.style];
  const dash = DASH[side.style];
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
  }
  ctx.stroke();
  ctx.restore();
}
