const RED = "#E8433A";
const YELLOW = "#F5C342";
const GREEN = "#3AA757";
const GRAY = "#808080";
const BLACK = "#404040";

/** Colours for an n-icon set, lowest value first. */
function ramp(n: number): string[] {
  if (n === 3) return [RED, YELLOW, GREEN];
  if (n === 4) return [RED, "#F28B30", YELLOW, GREEN];
  return [RED, "#F28B30", YELLOW, "#9ACD32", GREEN];
}

type Dir = "down" | "downRight" | "right" | "upRight" | "up";

function arrowDirs(n: number): Dir[] {
  if (n === 3) return ["down", "right", "up"];
  if (n === 4) return ["down", "downRight", "upRight", "up"];
  return ["down", "downRight", "right", "upRight", "up"];
}

const ANGLE: Record<Dir, number> = { up: -90, upRight: -45, right: 0, downRight: 45, down: 90 };

/** Draws icon `index` (0 = lowest) of an Excel icon set into a size x size box. */
export function drawIcon(ctx: CanvasRenderingContext2D, set: string, index: number, x: number, y: number, size: number): void {
  const n = Number(set[0]) || 3;
  const name = set.slice(1);
  const colors = ramp(n);
  const color = colors[Math.min(index, colors.length - 1)]!;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.42;
  ctx.save();
  if (name.startsWith("Arrows")) {
    const gray = name.includes("Gray");
    const dir = arrowDirs(n)[index] ?? "right";
    ctx.translate(cx, cy);
    ctx.rotate((ANGLE[dir] * Math.PI) / 180);
    ctx.fillStyle = gray ? GRAY : color;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(0, -r);
    ctx.lineTo(0, -r * 0.45);
    ctx.lineTo(-r, -r * 0.45);
    ctx.lineTo(-r, r * 0.45);
    ctx.lineTo(0, r * 0.45);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();
  } else if (name.startsWith("Flags")) {
    ctx.fillStyle = color;
    ctx.fillRect(x + size * 0.2, y + size * 0.1, size * 0.08, size * 0.8);
    ctx.beginPath();
    ctx.moveTo(x + size * 0.28, y + size * 0.1);
    ctx.lineTo(x + size * 0.85, y + size * 0.3);
    ctx.lineTo(x + size * 0.28, y + size * 0.5);
    ctx.closePath();
    ctx.fill();
  } else if (name.startsWith("Symbols")) {
    if (name === "Symbols") {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = name === "Symbols" ? "#FFFFFF" : color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(1.5, size / 8);
    ctx.beginPath();
    const k = r * 0.5;
    if (index === 0) {
      ctx.moveTo(cx - k, cy - k);
      ctx.lineTo(cx + k, cy + k);
      ctx.moveTo(cx + k, cy - k);
      ctx.lineTo(cx - k, cy + k);
      ctx.stroke();
    } else if (index === 1) {
      ctx.moveTo(cx, cy - k);
      ctx.lineTo(cx, cy + k * 0.3);
      ctx.stroke();
      ctx.fillRect(cx - ctx.lineWidth / 2, cy + k * 0.6, ctx.lineWidth, ctx.lineWidth);
    } else {
      ctx.moveTo(cx - k, cy);
      ctx.lineTo(cx - k * 0.2, cy + k * 0.7);
      ctx.lineTo(cx + k, cy - k * 0.6);
      ctx.stroke();
    }
  } else if (name.startsWith("Rating") || name.startsWith("Quarters")) {
    const level = index / (n - 1);
    ctx.strokeStyle = GRAY;
    ctx.fillStyle = name.startsWith("Quarters") ? BLACK : "#4472C4";
    ctx.lineWidth = 1;
    if (name.startsWith("Quarters")) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (level > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * level);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      const bars = 4;
      const bw = size / (bars * 1.6);
      for (let i = 0; i < bars; i++) {
        const bh = (size * 0.8 * (i + 1)) / bars;
        const bx = x + size * 0.1 + i * bw * 1.6;
        const by = y + size * 0.9 - bh;
        if (i / (bars - 1) <= level && level > 0) ctx.fillRect(bx, by, bw, bh);
        else ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      }
    }
  } else {
    // Traffic lights, signs and circles.
    let fill = color;
    if (name.startsWith("RedToBlack")) fill = ["#404040", "#808080", "#E89B9B", RED][index] ?? RED;
    if (n === 4 && name.startsWith("TrafficLights")) fill = [BLACK, RED, YELLOW, GREEN][index] ?? GREEN;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (name.startsWith("Signs") && index === 0) {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
    } else if (name.startsWith("Signs") && index === 1) {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.8);
      ctx.lineTo(cx - r, cy + r * 0.8);
    } else ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
