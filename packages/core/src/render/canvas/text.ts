import type { ResolvedFont, RichRun } from "../../model/types.js";

export interface FontInfo {
  css: string;
  color: string;
  underline: ResolvedFont["underline"];
  strike: boolean;
  sizePx: number;
  vertAlign?: "superscript" | "subscript";
}

export function cssFont(f: Pick<ResolvedFont, "italic" | "bold" | "sizePx" | "family" | "vertAlign">, scale: number): string {
  const size = f.vertAlign ? f.sizePx * 0.75 : f.sizePx;
  return `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${round2(size * scale)}px ${f.family}`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** LRU-ish map: drops the oldest half when full. */
class BoundedCache<V> {
  private map = new Map<string, V>();
  hits = 0;
  misses = 0;
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) this.misses++;
    else this.hits++;
    return v;
  }

  set(key: string, v: V): void {
    if (this.map.size >= this.max) {
      let drop = this.max >> 1;
      for (const k of this.map.keys()) {
        this.map.delete(k);
        if (--drop <= 0) break;
      }
    }
    this.map.set(key, v);
  }

  clear(): void {
    this.map.clear();
  }
}

export interface Metrics {
  ascent: number;
  descent: number;
}

export interface Segment {
  text: string;
  font: FontInfo;
  width: number;
}

export interface Line {
  segments: Segment[];
  width: number;
}

export class TextMeasurer {
  private readonly widths = new BoundedCache<number>(50_000);
  private readonly metrics = new Map<string, Metrics>();
  private readonly wraps = new BoundedCache<Line[]>(5_000);

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  get hitRate(): number {
    const total = this.widths.hits + this.widths.misses;
    return total ? this.widths.hits / total : 1;
  }

  clear(): void {
    this.widths.clear();
    this.metrics.clear();
    this.wraps.clear();
  }

  width(font: string, text: string): number {
    const key = font + "\u0000" + text;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.widths.set(key, w);
    }
    return w;
  }

  fontMetrics(font: string, sizePx: number): Metrics {
    let m = this.metrics.get(font);
    if (!m) {
      this.ctx.font = font;
      const tm = this.ctx.measureText("Mg가");
      const ascent = tm.fontBoundingBoxAscent;
      const descent = tm.fontBoundingBoxDescent;
      m = Number.isFinite(ascent) && ascent > 0 ? { ascent, descent } : { ascent: sizePx * 0.9, descent: sizePx * 0.3 };
      this.metrics.set(font, m);
    }
    return m;
  }

  /**
   * Splits runs into lines. With `maxWidth` lines wrap at spaces, and
   * between CJK characters; overlong words break per character.
   */
  layout(runs: { text: string; font: FontInfo }[], maxWidth: number | undefined, cacheKey?: string): Line[] {
    if (cacheKey !== undefined) {
      const hit = this.wraps.get(cacheKey);
      if (hit) return hit;
    }
    const lines: Line[] = [];
    let line: Line = { segments: [], width: 0 };
    const pushLine = () => {
      trimTrailingSpace(line, this);
      lines.push(line);
      line = { segments: [], width: 0 };
    };
    const append = (text: string, font: FontInfo, w: number) => {
      const last = line.segments[line.segments.length - 1];
      if (last && last.font === font) {
        last.text += text;
        last.width = this.width(font.css, last.text);
      } else line.segments.push({ text, font, width: w });
      line.width = line.segments.reduce((s, x) => s + x.width, 0);
    };

    for (const run of runs) {
      const parts = run.text.split(/\r\n|\r|\n/);
      parts.forEach((part, pi) => {
        if (pi > 0) pushLine();
        if (maxWidth === undefined) {
          if (part) append(part, run.font, this.width(run.font.css, part));
          return;
        }
        for (const token of tokenize(part)) {
          const w = this.width(run.font.css, token);
          if (line.width + w <= maxWidth || (line.segments.length === 0 && token.trim() === "")) {
            append(token, run.font, w);
            continue;
          }
          if (token.trim() === "") {
            pushLine();
            continue;
          }
          if (line.segments.length > 0) pushLine();
          if (w <= maxWidth) {
            append(token, run.font, w);
            continue;
          }
          // Word longer than the cell: break per character.
          for (const ch of Array.from(token)) {
            const cw = this.width(run.font.css, ch);
            if (line.width + cw > maxWidth && line.segments.length > 0) pushLine();
            append(ch, run.font, cw);
          }
        }
      });
    }
    pushLine();
    if (cacheKey !== undefined) this.wraps.set(cacheKey, lines);
    return lines;
  }
}

function trimTrailingSpace(line: Line, m: TextMeasurer): void {
  const last = line.segments[line.segments.length - 1];
  if (!last) return;
  const trimmed = last.text.replace(/\s+$/, "");
  if (trimmed === last.text) return;
  if (trimmed === "") line.segments.pop();
  else {
    last.text = trimmed;
    last.width = m.width(last.font.css, trimmed);
  }
  line.width = line.segments.reduce((s, x) => s + x.width, 0);
}

const CJK = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-힯豈-﫿＀-￯]/;

/** Break opportunities: words with trailing spaces, and each CJK character on its own. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of Array.from(text)) {
    if (CJK.test(ch)) {
      if (cur) out.push(cur);
      out.push(ch);
      cur = "";
    } else if (ch === " " || ch === "\t") {
      cur += ch;
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function runsFor(
  text: string,
  rich: RichRun[] | undefined,
  base: ResolvedFont,
  color: string,
  scale: number,
  fontCache: Map<string, FontInfo>,
): { text: string; font: FontInfo }[] {
  if (!rich) return [{ text, font: fontInfo(base, color, scale, fontCache) }];
  return rich.map((r) => {
    const f: ResolvedFont = r.font ? { ...base, ...r.font } : base;
    return { text: r.text, font: fontInfo(f, r.font?.color ?? color, scale, fontCache) };
  });
}

export function fontInfo(f: ResolvedFont, color: string, scale: number, cache: Map<string, FontInfo>): FontInfo {
  const css = cssFont(f, scale);
  const key = css + "|" + color + "|" + f.underline + "|" + (f.strike ? 1 : 0) + "|" + (f.vertAlign ?? "");
  let info = cache.get(key);
  if (!info) {
    info = { css, color, underline: f.underline, strike: f.strike, sizePx: f.sizePx * scale };
    if (f.vertAlign) info.vertAlign = f.vertAlign;
    cache.set(key, info);
  }
  return info;
}
