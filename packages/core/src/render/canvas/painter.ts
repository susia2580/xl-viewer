import { colName } from "../../format/address.js";
import type { BorderSide, Borders, CellModel, CellRange, CfResult, ResolvedFont, ResolvedStyle, SheetModel } from "../../model/types.js";
import type { Layout } from "../layout.js";
import type { ViewerTheme } from "../theme.js";
import type { Pane } from "../panes.js";
import { drawDiagonal, drawEdges, heavier, type Edge } from "./border.js";
import { drawIcon } from "./icons.js";
import { cssFont, fontInfo, runsFor, type FontInfo, type Line, type TextMeasurer } from "./text.js";

export type PaintTheme = ViewerTheme;

export interface FrameInfo {
  viewW: number;
  viewH: number;
  dpr: number;
  headerW: number;
  headerH: number;
  panes: Pane[];
}

/** Columns scanned outside the visible range for text overflowing into view. */
const OVERFLOW_SCAN = 20;
const PAD_X = 2;
const MAX_FIT_WIDTH = 800;

interface TextJob {
  row: number;
  col: number;
  cell: CellModel;
  style: ResolvedStyle;
  /** Cell (or merge) rect in sheet px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Clip / overflow rect. */
  clipX: number;
  clipW: number;
  text: string;
  hAlign: "left" | "center" | "right";
  cf?: CfResult;
}

export class Painter {
  private readonly fontCache = new Map<string, FontInfo>();
  /** Merge covering each cell near the painted pane, keyed row * 16384 + col. */
  private readonly cover = new Map<number, CellRange>();
  private colStyles: (number | undefined)[] = [];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly measurer: TextMeasurer,
    private readonly styles: ResolvedStyle[],
    private readonly defaultFont: ResolvedFont,
    private readonly sheet: SheetModel,
    private readonly layout: Layout,
    private theme: PaintTheme,
    private readonly mdw: number,
  ) {
    this.colStyles = buildColStyles(sheet, layout.cols);
  }

  setTheme(theme: PaintTheme): void {
    this.theme = theme;
  }

  resetFonts(): void {
    this.fontCache.clear();
  }

  paint(frame: FrameInfo): void {
    const { ctx } = this;
    const { dpr, viewW, viewH } = frame;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.textBaseline = "alphabetic";

    for (const pane of frame.panes) this.paintPane(pane, dpr);
    this.paintFrozenLines(frame);
    if (frame.headerW > 0 || frame.headerH > 0) this.paintHeaders(frame);
  }

  styleAt(row: number, col: number, cell?: CellModel): ResolvedStyle {
    const id = cell?.styleId ?? this.sheet.rows[row]?.styleId ?? this.colStyles[col] ?? 0;
    return this.styles[id] ?? this.styles[0]!;
  }

  private paintPane(pane: Pane, dpr: number): void {
    const { ctx, layout, sheet } = this;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.x, pane.y, pane.w, pane.h);
    ctx.clip();
    ctx.translate(pane.x - pane.sx, pane.y - pane.sy);

    const { r0, r1, c0, c1 } = pane;
    const scanFrom = Math.max(0, c0 - OVERFLOW_SCAN);
    const scanTo = Math.min(layout.cols - 1, c1 + OVERFLOW_SCAN);
    const merges = layout.mergesIn(Math.max(0, r0 - 1), scanFrom, r1 + 1, scanTo);
    this.cover.clear();
    for (const m of merges) {
      for (let r = Math.max(m.r1, r0 - 1); r <= Math.min(m.r2, r1 + 1); r++) {
        for (let c = Math.max(m.c1, scanFrom); c <= Math.min(m.c2, scanTo); c++) this.cover.set(r * 16384 + c, m);
      }
    }
    const jobs = this.layoutText(r0, r1, c0, c1, scanFrom, scanTo);
    const hiddenV = new Set<number>(); // key row * 16384 + boundary col
    const hiddenH = new Set<number>();
    for (const j of jobs) {
      if (j.clipW > j.w || j.clipX < j.x) {
        const ca = layout.colAt(j.clipX + 0.5);
        const cb = layout.colAt(j.clipX + j.clipW - 0.5);
        for (let b = ca + 1; b <= cb; b++) hiddenV.add(j.row * 16384 + b);
      }
    }
    for (const m of merges) {
      for (let r = m.r1; r <= m.r2; r++) for (let b = m.c1 + 1; b <= m.c2; b++) hiddenV.add(r * 16384 + b);
      for (let b = m.r1 + 1; b <= m.r2; b++) for (let c = m.c1; c <= m.c2; c++) hiddenH.add(b * 16384 + c);
    }

    // Gridlines
    if (sheet.view.showGridLines) {
      ctx.fillStyle = this.theme.gridColor;
      for (let r = r0; r <= r1; r++) {
        const y = layout.rowTop[r]!;
        const h = layout.rowHeight(r);
        if (h === 0) continue;
        for (let c = c0; c <= c1 + 1; c++) {
          if (hiddenV.has(r * 16384 + c)) continue;
          const x = snap(layout.colLeft[c]!);
          ctx.fillRect(x - 1, snap(y), 1, snap(y + h) - snap(y));
        }
      }
      for (let r = r0; r <= r1 + 1; r++) {
        const y = snap(layout.rowTop[r]!);
        for (let c = c0; c <= c1; c++) {
          if (hiddenH.has(r * 16384 + c)) continue;
          const x = layout.colLeft[c]!;
          ctx.fillRect(snap(x), y - 1, snap(x + layout.colWidth(c)) - snap(x), 1);
        }
      }
    }

    // Fills. A merge is painted once with its top-left cell's style.
    for (const m of merges) this.fillMerge(m.r1, m.c1, m.r2, m.c2, snap);
    for (let r = r0; r <= r1; r++) {
      const rowCells = sheet.cells[r];
      const rowCf = sheet.cf[r];
      for (let c = c0; c <= c1; c++) {
        if (this.cover.has(r * 16384 + c)) continue;
        const cell = rowCells?.[c];
        const fill = rowCf?.[c]?.fill ?? this.styleAt(r, c, cell).fill;
        if (!fill) continue;
        this.fillCell(fill, layout.colLeft[c]!, layout.rowTop[r]!, layout.colWidth(c), layout.rowHeight(r), snap);
      }
    }

    // Data bars and icons
    for (let r = r0; r <= r1; r++) {
      const rowCf = sheet.cf[r];
      if (!rowCf) continue;
      for (let c = c0; c <= c1; c++) {
        const cf = rowCf[c];
        if (!cf) continue;
        const x = layout.colLeft[c]!;
        const y = layout.rowTop[r]!;
        const w = layout.colWidth(c);
        const h = layout.rowHeight(r);
        if (cf.dataBar && w > 4 && h > 4) this.paintDataBar(cf.dataBar, x, y, w, h);
        if (cf.icon) {
          const size = Math.min(h - 4, 16 * layout.scale);
          if (size > 4) drawIcon(ctx, cf.icon.set, cf.icon.index, x + 2, y + (h - size) / 2, size);
        }
      }
    }

    for (const job of jobs) this.paintText(job);
    this.paintBorders(r0, r1, c0, c1, snap);
    this.paintNoteIndicators(r0, r1, c0, c1);
    ctx.restore();
  }

  private fillCell(fill: string, x: number, y: number, w: number, h: number, snap: (v: number) => number): void {
    if (w === 0 || h === 0) return;
    this.ctx.fillStyle = fill;
    // One pixel up and left to cover the neighbouring gridlines.
    const x0 = snap(x) - 1;
    const y0 = snap(y) - 1;
    this.ctx.fillRect(x0, y0, snap(x + w) - x0, snap(y + h) - y0);
  }

  private fillMerge(r1: number, c1: number, r2: number, c2: number, snap: (v: number) => number): void {
    const { layout } = this;
    const cell = this.sheet.cells[r1]?.[c1];
    const fill = this.sheet.cf[r1]?.[c1]?.fill ?? this.styleAt(r1, c1, cell).fill;
    const x = layout.colLeft[c1]!;
    const y = layout.rowTop[r1]!;
    const w = layout.colLeft[c2 + 1]! - x;
    const h = layout.rowTop[r2 + 1]! - y;
    if (fill) this.fillCell(fill, x, y, w, h, snap);
  }

  private paintDataBar(bar: NonNullable<CfResult["dataBar"]>, x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    const bx = x + 2;
    const bw = (w - 4) * bar.to;
    const by = y + 2;
    const bh = h - 5;
    if (bw <= 0 || bh <= 0) return;
    if (bar.gradient) {
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, bar.color);
      g.addColorStop(1, "#FFFFFF");
      ctx.fillStyle = g;
    } else ctx.fillStyle = bar.color;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = bar.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  }

  /** Works out what text to draw and where, including overflow into empty neighbours. */
  private layoutText(r0: number, r1: number, c0: number, c1: number, scanFrom: number, scanTo: number): TextJob[] {
    const { layout, sheet } = this;
    const jobs: TextJob[] = [];
    const seenMerges = new Set<string>();
    for (let r = r0; r <= r1; r++) {
      const rowCells = sheet.cells[r];
      const rh = layout.rowHeight(r);
      if (rh === 0) continue;

      // Merges whose top-left cell is outside the visible rows still need their text.
      for (const m of layout.mergesIn(r, c0, r, c1)) {
        const key = m.r1 + ":" + m.c1;
        if (seenMerges.has(key)) continue;
        seenMerges.add(key);
        const cell = sheet.cells[m.r1]?.[m.c1];
        if (!cell || cell.text === "") continue;
        const x = layout.colLeft[m.c1]!;
        const y = layout.rowTop[m.r1]!;
        const w = layout.colLeft[m.c2 + 1]! - x;
        const h = layout.rowTop[m.r2 + 1]! - y;
        const style = this.styleAt(m.r1, m.c1, cell);
        const job = this.makeJob(m.r1, m.c1, cell, style, x, y, w, h, true);
        if (job) jobs.push(job);
      }
      if (!rowCells) continue;

      for (const key in rowCells) {
        const c = Number(key);
        if (c < scanFrom || c > scanTo) continue;
        const cell = rowCells[c]!;
        if (cell.text === "") continue;
        if (this.cover.has(r * 16384 + c)) continue;
        const cw = layout.colWidth(c);
        if (cw === 0) continue;
        const style = this.styleAt(r, c, cell);
        const x = layout.colLeft[c]!;
        const job = this.makeJob(r, c, cell, style, x, layout.rowTop[r]!, cw, rh, false);
        if (!job) continue;
        const visibleFrom = job.clipX;
        const visibleTo = job.clipX + job.clipW;
        if (visibleTo < layout.colLeft[c0]! || visibleFrom > layout.colLeft[c1 + 1]!) continue;
        jobs.push(job);
      }
    }
    return jobs;
  }

  private makeJob(
    row: number,
    col: number,
    cell: CellModel,
    style: ResolvedStyle,
    x: number,
    y: number,
    w: number,
    h: number,
    isMerged: boolean,
  ): TextJob | undefined {
    const cf = this.sheet.cf[row]?.[col];
    if (cf?.dataBar && !cf.dataBar.showValue) return undefined;
    if (cf?.icon && !cf.icon.showValue) return undefined;
    let hAlign: TextJob["hAlign"];
    switch (style.hAlign) {
      case "center":
      case "centerContinuous":
      case "distributed":
        hAlign = "center";
        break;
      case "right":
        hAlign = "right";
        break;
      case "left":
      case "fill":
      case "justify":
        hAlign = "left";
        break;
      default:
        hAlign = cell.type === "number" ? "right" : cell.type === "string" ? "left" : "center";
    }
    const job: TextJob = { row, col, cell, style, x, y, w, h, clipX: x, clipW: w, text: cell.text, hAlign };
    if (cf) job.cf = cf;
    if (style.wrap || style.rotation !== 0 || style.shrink || style.hAlign === "fill") return job;

    const font = this.cellFont(style, cf);
    const scale = this.layout.scale;
    const iconPad = cf?.icon ? Math.min(h - 4, 16 * scale) + 2 : 0;
    const avail = w - PAD_X * 2 * scale - this.indentPx(style) - iconPad;
    const tw = cell.rich ? this.richWidth(cell, style) : this.measurer.width(cssFont(font, scale), cell.text);
    if (tw <= avail) return job;

    if (cell.type === "number") {
      job.text = this.fitNumber(cell, style, font, avail);
      return job;
    }
    if (cell.type !== "string" || isMerged) return job;

    // Overflow into empty neighbours on the same row.
    const need = tw - avail;
    const rowCells = this.sheet.cells[row];
    const empty = (c: number) => {
      if (c < 0 || c >= this.layout.cols) return false;
      const t = rowCells?.[c];
      return (!t || t.text === "") && !this.cover.has(row * 16384 + c) && !this.layout.mergeCovering(row, c);
    };
    let left = x;
    let right = x + w;
    if (hAlign === "left") {
      for (let c = col + 1; right - (x + w) < need && empty(c) && c <= col + 256; c++) right += this.layout.colWidth(c);
    } else if (hAlign === "right") {
      for (let c = col - 1; x - left < need && empty(c) && c >= col - 256; c--) left -= this.layout.colWidth(c);
    } else {
      let cl = col - 1;
      let cr = col + 1;
      const half = need / 2;
      while (x - left < half && empty(cl)) left -= this.layout.colWidth(cl--);
      while (right - (x + w) < half && empty(cr)) right += this.layout.colWidth(cr++);
    }
    job.clipX = left;
    job.clipW = right - left;
    return job;
  }

  private indentPx(style: ResolvedStyle): number {
    return style.indent > 0 ? style.indent * this.mdw * 3 * this.layout.scale : 0;
  }

  private cellFont(style: ResolvedStyle, cf?: CfResult): ResolvedFont {
    const f = cf?.font;
    if (!f) return style.font;
    return {
      ...style.font,
      ...(f.bold !== undefined ? { bold: f.bold } : {}),
      ...(f.italic !== undefined ? { italic: f.italic } : {}),
      ...(f.strike !== undefined ? { strike: f.strike } : {}),
      ...(f.underline !== undefined ? { underline: f.underline } : {}),
      ...(f.color ? { color: f.color } : {}),
    };
  }

  private richWidth(cell: CellModel, style: ResolvedStyle): number {
    const runs = runsFor(cell.text, cell.rich, style.font, style.font.color, this.layout.scale, this.fontCache);
    return runs.reduce((s, r) => s + this.measurer.width(r.font.css, r.text), 0);
  }

  /** Shortens General numbers like Excel, otherwise fills with '#'. */
  private fitNumber(cell: CellModel, style: ResolvedStyle, font: ResolvedFont, avail: number): string {
    const css = cssFont(font, this.layout.scale);
    if (style.numFmt === "General" && typeof cell.value === "number") {
      const v = cell.value;
      for (let p = 10; p >= 1; p--) {
        let s = Number(v.toPrecision(p)).toString();
        if (s.includes("e"))
          s = v
            .toExponential(Math.max(0, p - 1))
            .replace("e", "E")
            .replace(/E\+?(-?)(\d)$/, "E+$1" + "0$2")
            .replace("E+-", "E-");
        if (this.measurer.width(css, s) <= avail) return s;
      }
    }
    const hw = this.measurer.width(css, "#");
    const n = Math.max(0, Math.floor(avail / hw));
    return "#".repeat(n);
  }

  private paintText(job: TextJob): void {
    const { ctx, layout } = this;
    const scale = layout.scale;
    const style = job.style;
    const cf = job.cf;
    const font = this.cellFont(style, cf);
    const color = cf?.font?.color ?? job.cell.fmtColor ?? font.color;
    const runs =
      job.text === job.cell.text
        ? runsFor(job.text, job.cell.rich, font, color, scale, this.fontCache)
        : [{ text: job.text, font: fontInfo(font, color, scale, this.fontCache) }];
    const padX = PAD_X * scale;
    const indent = this.indentPx(style);
    const iconPad = cf?.icon ? Math.min(job.h - 4, 16 * scale) + 2 : 0;
    const innerX = job.x + padX + (job.hAlign === "left" ? indent + iconPad : 0);
    const innerW = job.w - padX * 2 - indent - iconPad;

    if (style.rotation !== 0) {
      this.paintRotated(job, runs);
      return;
    }

    let lines: Line[];
    let shrink = 1;
    if (style.wrap || style.hAlign === "justify" || style.hAlign === "distributed") {
      // Cached lines hold FontInfo, so the key must cover everything a FontInfo carries.
      const f = runs[0]!.font;
      const key = job.cell.rich
        ? undefined
        : `${f.css}|${f.color}|${f.underline}|${f.strike ? 1 : 0}|${f.vertAlign ?? ""}|${Math.round(innerW)}|${job.text}`;
      lines = this.measurer.layout(runs, Math.max(1, innerW), key);
    } else {
      lines = this.measurer.layout(runs, undefined);
      if (style.hAlign === "fill" && lines[0] && lines[0].width > 0) {
        const one = lines[0];
        const reps = Math.max(1, Math.floor(innerW / one.width));
        lines = [{ segments: Array.from({ length: reps }, () => one.segments).flat(), width: one.width * reps }];
      }
      if (style.shrink && lines[0] && lines[0].width > innerW && innerW > 0) shrink = innerW / lines[0].width;
    }

    const metrics = lines.map((l) => {
      let ascent = 0;
      let descent = 0;
      for (const s of l.segments) {
        const m = this.measurer.fontMetrics(s.font.css, s.font.sizePx);
        ascent = Math.max(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
      }
      if (ascent === 0) {
        const m = this.measurer.fontMetrics(runs[0]!.font.css, runs[0]!.font.sizePx);
        ascent = m.ascent;
        descent = m.descent;
      }
      return { ascent: ascent * shrink, descent: descent * shrink };
    });
    const totalH = metrics.reduce((s, m) => s + m.ascent + m.descent, 0);
    let top: number;
    switch (style.vAlign) {
      case "top":
        top = job.y + 1 * scale;
        break;
      case "middle":
      case "justify":
      case "distributed":
        top = job.y + (job.h - totalH) / 2;
        break;
      default:
        top = job.y + job.h - totalH - 2 * scale;
    }

    const maxLineW = Math.max(...lines.map((l) => l.width * shrink));
    const needsClip = maxLineW > innerW + 0.5 || totalH > job.h || job.clipW !== job.w;
    if (needsClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(job.clipX, job.y, job.clipW, job.h);
      ctx.clip();
    }
    let y = top;
    lines.forEach((line, i) => {
      const m = metrics[i]!;
      y += m.ascent;
      const lw = line.width * shrink;
      let x: number;
      if (job.hAlign === "left") x = innerX;
      else if (job.hAlign === "right") x = job.x + job.w - padX - lw;
      else x = job.x + (job.w - lw) / 2;
      for (const seg of line.segments) {
        this.drawSegment(seg.text, seg.font, x, y, shrink, seg.width * shrink);
        x += seg.width * shrink;
      }
      y += m.descent;
    });
    if (needsClip) ctx.restore();
  }

  /** Height (px at 100% zoom) that shows every cell of the row without clipping. */
  fitRowHeight(row: number): number {
    const { layout, sheet } = this;
    const scale = layout.scale;
    const base = this.measurer.fontMetrics(cssFont(this.defaultFont, scale), this.defaultFont.sizePx * scale);
    let need = base.ascent + base.descent + 3 * scale;
    for (const key of Object.keys(sheet.cells[row] ?? {})) {
      const c = Number(key);
      const cell = sheet.cells[row]![c]!;
      if (cell.text === "" || layout.colWidth(c) === 0 || layout.mergeCovering(row, c)) continue;
      const style = this.styleAt(row, c, cell);
      if (style.rotation !== 0) continue;
      const font = this.cellFont(style, sheet.cf[row]?.[c]);
      const runs = runsFor(cell.text, cell.rich, font, font.color, scale, this.fontCache);
      const innerW = layout.colWidth(c) - PAD_X * 2 * scale - this.indentPx(style);
      const lines = this.measurer.layout(runs, style.wrap ? Math.max(1, innerW) : undefined);
      const shown = style.wrap ? lines : lines.slice(0, 1);
      let h = 3 * scale;
      for (const line of shown) h += this.lineHeight(line, runs);
      need = Math.max(need, h);
    }
    return Math.ceil(need / scale);
  }

  /** Width (px at 100% zoom) that shows the widest cell of the column, or undefined if it has no text. */
  fitColWidth(col: number): number | undefined {
    const { layout, sheet } = this;
    const scale = layout.scale;
    let need = 0;
    for (const key of Object.keys(sheet.cells)) {
      const row = Number(key);
      const cell = sheet.cells[row]![col];
      if (!cell || cell.text === "" || layout.rowHeight(row) === 0 || layout.mergeCovering(row, col)) continue;
      const style = this.styleAt(row, col, cell);
      if (style.rotation !== 0) continue;
      const font = this.cellFont(style, sheet.cf[row]?.[col]);
      const runs = runsFor(cell.text, cell.rich, font, font.color, scale, this.fontCache);
      const widest = Math.max(...this.measurer.layout(runs, undefined).map((l) => l.width));
      need = Math.max(need, widest + PAD_X * 2 * scale + this.indentPx(style) + 4 * scale);
    }
    return need > 0 ? Math.min(MAX_FIT_WIDTH, Math.ceil(need / scale)) : undefined;
  }

  private lineHeight(line: Line, runs: { font: FontInfo }[]): number {
    let ascent = 0;
    let descent = 0;
    for (const seg of line.segments.length ? line.segments : [{ font: runs[0]!.font }]) {
      const m = this.measurer.fontMetrics(seg.font.css, seg.font.sizePx);
      ascent = Math.max(ascent, m.ascent);
      descent = Math.max(descent, m.descent);
    }
    return ascent + descent;
  }

  private drawSegment(text: string, font: FontInfo, x: number, y: number, shrink: number, width: number): void {
    const { ctx } = this;
    ctx.font = shrink === 1 ? font.css : font.css.replace(/([\d.]+)px/, (_, n: string) => `${Number(n) * shrink}px`);
    ctx.fillStyle = font.color;
    let by = y;
    if (font.vertAlign === "superscript") by -= font.sizePx * 0.35;
    else if (font.vertAlign === "subscript") by += font.sizePx * 0.15;
    ctx.fillText(text, x, by);
    const lw = Math.max(1, Math.round(font.sizePx / 14));
    if (font.underline !== "none") {
      ctx.fillRect(x, Math.round(by + lw + 1), width, lw);
      if (font.underline === "double") ctx.fillRect(x, Math.round(by + lw * 3 + 1), width, lw);
    }
    if (font.strike) ctx.fillRect(x, Math.round(by - font.sizePx * 0.3), width, lw);
  }

  private paintRotated(job: TextJob, runs: { text: string; font: FontInfo }[]): void {
    const { ctx } = this;
    const rot = job.style.rotation;
    const font = runs[0]!.font;
    const m = this.measurer.fontMetrics(font.css, font.sizePx);
    const lineH = m.ascent + m.descent;
    ctx.save();
    ctx.beginPath();
    ctx.rect(job.x, job.y, job.w, job.h);
    ctx.clip();
    ctx.fillStyle = font.color;
    ctx.font = font.css;
    if (rot === 255) {
      const chars = Array.from(job.text);
      const total = chars.length * lineH;
      let y =
        job.style.vAlign === "top" ? job.y + 2 : job.style.vAlign === "middle" ? job.y + (job.h - total) / 2 : job.y + job.h - total - 2;
      for (const ch of chars) {
        const w = this.measurer.width(font.css, ch);
        ctx.fillText(ch, job.x + (job.w - w) / 2, y + m.ascent);
        y += lineH;
      }
      ctx.restore();
      return;
    }
    const deg = rot <= 90 ? rot : -(rot - 90);
    const a = (deg * Math.PI) / 180;
    const tw = runs.reduce((s, r) => s + this.measurer.width(r.font.css, r.text), 0);
    const bw = Math.abs(tw * Math.cos(a)) + Math.abs(lineH * Math.sin(a));
    const bh = Math.abs(tw * Math.sin(a)) + Math.abs(lineH * Math.cos(a));
    const pad = 2 * this.layout.scale;
    const cx = job.hAlign === "left" ? job.x + pad + bw / 2 : job.hAlign === "right" ? job.x + job.w - pad - bw / 2 : job.x + job.w / 2;
    const cy =
      job.style.vAlign === "top" ? job.y + pad + bh / 2 : job.style.vAlign === "middle" ? job.y + job.h / 2 : job.y + job.h - pad - bh / 2;
    ctx.translate(cx, cy);
    ctx.rotate(-a);
    let x = -tw / 2;
    for (const r of runs) {
      ctx.font = r.font.css;
      ctx.fillStyle = r.font.color;
      ctx.fillText(r.text, x, (m.ascent - m.descent) / 2);
      x += this.measurer.width(r.font.css, r.text);
    }
    ctx.restore();
  }

  private paintBorders(r0: number, r1: number, c0: number, c1: number, snap: (v: number) => number): void {
    const { layout, sheet } = this;
    const hEdges = new Map<number, BorderSide>();
    const vEdges = new Map<number, BorderSide>();
    const diagonals: { side: BorderSide; r: number; c: number; up: boolean }[] = [];
    const bordersAt = (r: number, c: number): Borders | undefined => {
      if (r < 0 || c < 0 || r >= layout.rows || c >= layout.cols) return undefined;
      const cell = sheet.cells[r]?.[c];
      const base = this.styleAt(r, c, cell).border;
      const cf = sheet.cf[r]?.[c]?.border;
      return cf ? { ...base, ...cf } : base;
    };
    for (let r = r0; r <= r1; r++) {
      if (layout.rowHeight(r) === 0) continue;
      for (let c = c0; c <= c1; c++) {
        if (layout.colWidth(c) === 0) continue;
        const b = bordersAt(r, c);
        if (!b) continue;
        const merge = this.cover.get(r * 16384 + c);
        if (b.top && !(merge && r > merge.r1)) setEdge(hEdges, r * 16384 + c, b.top);
        if (b.bottom && !(merge && r < merge.r2)) setEdge(hEdges, (r + 1) * 16384 + c, b.bottom);
        if (b.left && !(merge && c > merge.c1)) setEdge(vEdges, r * 16384 + c, b.left);
        if (b.right && !(merge && c < merge.c2)) setEdge(vEdges, r * 16384 + c + 1, b.right);
        if (b.diagonalUp) diagonals.push({ side: b.diagonalUp, r, c, up: true });
        if (b.diagonalDown) diagonals.push({ side: b.diagonalDown, r, c, up: false });
      }
    }
    // Neighbours just outside the range can own the shared edge.
    for (let c = c0; c <= c1; c++) {
      const above = bordersAt(r0 - 1, c)?.bottom;
      if (above) setEdge(hEdges, r0 * 16384 + c, above);
      const below = bordersAt(r1 + 1, c)?.top;
      if (below) setEdge(hEdges, (r1 + 1) * 16384 + c, below);
    }
    for (let r = r0; r <= r1; r++) {
      const left = bordersAt(r, c0 - 1)?.right;
      if (left) setEdge(vEdges, r * 16384 + c0, left);
      const right = bordersAt(r, c1 + 1)?.left;
      if (right) setEdge(vEdges, r * 16384 + c1 + 1, right);
    }
    const edges: Edge[] = [];
    for (const [key, side] of hEdges) {
      const r = Math.floor(key / 16384);
      const c = key % 16384;
      const x = layout.colLeft[c]!;
      edges.push({ side, horizontal: true, at: layout.rowTop[r]!, from: x, to: x + layout.colWidth(c) });
    }
    for (const [key, side] of vEdges) {
      const r = Math.floor(key / 16384);
      const c = key % 16384;
      const y = layout.rowTop[r]!;
      edges.push({ side, horizontal: false, at: layout.colLeft[c]!, from: y, to: y + layout.rowHeight(r) });
    }
    drawEdges(this.ctx, edges, snap, layout.scale);
    for (const d of diagonals) {
      drawDiagonal(this.ctx, d.side, layout.colLeft[d.c]!, layout.rowTop[d.r]!, layout.colWidth(d.c), layout.rowHeight(d.r), d.up);
    }
  }

  private paintNoteIndicators(r0: number, r1: number, c0: number, c1: number): void {
    const { ctx, layout } = this;
    const size = Math.max(4, Math.round(6 * layout.scale));
    ctx.fillStyle = this.theme.noteIndicatorColor;
    for (const n of this.sheet.notes) {
      const merge = layout.mergeCovering(n.row, n.col);
      const r = merge ? merge.r1 : n.row;
      const cEnd = merge ? merge.c2 : n.col;
      if (r < r0 || r > r1 || cEnd < c0 || (merge ? merge.c1 : n.col) > c1) continue;
      if (layout.rowHeight(r) === 0) continue;
      const x = layout.colLeft[cEnd + 1]! - 1;
      const y = layout.rowTop[r]!;
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + size);
      ctx.closePath();
      ctx.fill();
    }
  }

  private paintFrozenLines(frame: FrameInfo): void {
    const { ctx, layout, sheet } = this;
    const { frozenRows, frozenCols } = sheet.view;
    if (!frozenRows && !frozenCols) return;
    ctx.fillStyle = this.theme.frozenLineColor;
    if (frozenRows) {
      const y = frame.headerH + layout.rowTop[Math.min(frozenRows, layout.rows)]!;
      ctx.fillRect(frame.headerW, y - 1, frame.viewW - frame.headerW, 1);
    }
    if (frozenCols) {
      const x = frame.headerW + layout.colLeft[Math.min(frozenCols, layout.cols)]!;
      ctx.fillRect(x - 1, frame.headerH, 1, frame.viewH - frame.headerH);
    }
  }

  private paintHeaders(frame: FrameInfo): void {
    const { ctx, layout } = this;
    const { headerW, headerH, viewW, viewH } = frame;
    const t = this.theme;
    const scale = layout.scale;
    const font = cssFont({ ...this.defaultFont, bold: false, italic: false, vertAlign: undefined }, scale);
    const m = this.measurer.fontMetrics(font, this.defaultFont.sizePx * scale);
    ctx.font = font;

    ctx.fillStyle = t.headerBg;
    ctx.fillRect(0, 0, viewW, headerH);
    ctx.fillRect(0, 0, headerW, viewH);

    // Each column band is labelled by its top pane, each row band by its left pane.
    for (const pane of frame.panes) {
      if (pane.y === headerH) this.paintColHeaders(pane, headerH, font, m);
      if (pane.x === headerW) this.paintRowHeaders(pane, headerW, font, m);
    }
    ctx.fillStyle = t.headerBorderColor;
    ctx.fillRect(0, headerH - 1, viewW, 1);
    ctx.fillRect(headerW - 1, 0, 1, viewH);
    ctx.fillStyle = t.headerBg;
    ctx.fillRect(0, 0, headerW - 1, headerH - 1);
  }

  private paintColHeaders(pane: Pane, headerH: number, font: string, m: { ascent: number; descent: number }): void {
    const { ctx, layout } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.x, 0, pane.w, headerH);
    ctx.clip();
    for (let c = pane.c0; c <= pane.c1; c++) {
      const w = layout.colWidth(c);
      if (w === 0) continue;
      const x = pane.x + layout.colLeft[c]! - pane.sx;
      if (x >= pane.x + pane.w) break;
      ctx.fillStyle = this.theme.headerBorderColor;
      ctx.fillRect(Math.round(x + w) - 1, 0, 1, headerH);
      const label = colName(c);
      const tw = this.measurer.width(font, label);
      ctx.fillStyle = this.theme.headerColor;
      ctx.font = font;
      ctx.fillText(label, x + (w - tw) / 2, (headerH - (m.ascent + m.descent)) / 2 + m.ascent);
    }
    ctx.restore();
  }

  private paintRowHeaders(pane: Pane, headerW: number, font: string, m: { ascent: number; descent: number }): void {
    const { ctx, layout } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, pane.y, headerW, pane.h);
    ctx.clip();
    for (let r = pane.r0; r <= pane.r1; r++) {
      const h = layout.rowHeight(r);
      if (h === 0) continue;
      const y = pane.y + layout.rowTop[r]! - pane.sy;
      if (y >= pane.y + pane.h) break;
      ctx.fillStyle = this.theme.headerBorderColor;
      ctx.fillRect(0, Math.round(y + h) - 1, headerW, 1);
      const label = String(r + 1);
      const tw = this.measurer.width(font, label);
      ctx.fillStyle = this.theme.headerColor;
      ctx.font = font;
      ctx.fillText(label, (headerW - tw) / 2, y + (h - (m.ascent + m.descent)) / 2 + m.ascent);
    }
    ctx.restore();
  }
}

function setEdge(map: Map<number, BorderSide>, key: number, side: BorderSide): void {
  const cur = map.get(key);
  const next = heavier(cur, side);
  if (next) map.set(key, next);
}

function buildColStyles(sheet: SheetModel, cols: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(cols);
  for (const range of sheet.cols) {
    if (range.styleId === undefined) continue;
    const end = Math.min(range.max, cols - 1);
    for (let c = range.min; c <= end; c++) out[c] = range.styleId;
  }
  return out;
}
