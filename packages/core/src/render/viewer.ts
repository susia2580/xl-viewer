import { XlViewerError, ParseError } from "../errors.js";
import { cellName } from "../format/address.js";
import { en } from "../locales/en.js";
import type { XlViewerLocale } from "../locales/types.js";
import type { ResolvedFont, SheetModel, XlViewerWarning, WorkbookModel } from "../model/types.js";
import { copyBytes, ParserClient } from "../worker/client.js";
import { Painter } from "./canvas/painter.js";
import { cssFont, TextMeasurer } from "./canvas/text.js";
import { Layout, type SizeOverrides } from "./layout.js";
import { maxDigitWidth } from "./mdw.js";
import { DrawingsOverlay } from "./overlay/drawings.js";
import { NotesOverlay } from "./overlay/notes.js";
import { OverlayPanes } from "./overlay/panes.js";
import { computePanes, type Pane } from "./panes.js";
import { SheetTabs } from "./tabs.js";
import { DEFAULT_THEME, type ViewerTheme } from "./theme.js";

export interface ViewerOptions {
  showHeaders?: boolean;
  showTabs?: boolean;
  useWorker?: boolean;
  workerUrl?: string | URL;
  locale?: XlViewerLocale;
  maxFileSize?: number;
  maxUncompressedSize?: number;
  maxCells?: number;
  /** Smallest rendered size in px of the workbook's default font; a lower saved zoom is raised to it. 0 keeps the file's zoom. Default 12. */
  minFontSize?: number;
  /** Drag header borders to resize rows and columns, double-click to fit. Default true; needs headers. */
  resizable?: boolean;
  /** Grow rows so wrapped text is not clipped when a sheet opens. Never shrinks. Default false. */
  autoFitRows?: boolean;
  theme?: Partial<ViewerTheme>;
  onWarning?: (warning: XlViewerWarning) => void;
}

export interface LoadInfo {
  sheetNames: string[];
  activeSheet: number;
  warnings: XlViewerWarning[];
}

export interface ViewerEventMap {
  load: LoadInfo;
  error: XlViewerError;
  sheetchange: number;
}

export interface ViewerStats {
  /** Duration of the last canvas paint in ms. */
  frameMs: number;
  /** Text measurement cache hit rate, 0-1. */
  measureHitRate: number;
}

export type OpenSource = File | Blob | ArrayBuffer | Uint8Array;

export interface Viewer {
  open(src: OpenSource): Promise<void>;
  setActiveSheet(index: number): void;
  getActiveSheet(): number;
  getSheetNames(): string[];
  getModel(): WorkbookModel | undefined;
  setTheme(theme: Partial<ViewerTheme>): void;
  on<K extends keyof ViewerEventMap>(event: K, cb: (payload: ViewerEventMap[K]) => void): () => void;
  off<K extends keyof ViewerEventMap>(event: K, cb: (payload: ViewerEventMap[K]) => void): void;
  getStats(): ViewerStats;
  destroy(): void;
}

export { DEFAULT_THEME, type ViewerTheme };

interface SheetState {
  index: number;
  sheet: SheetModel;
  layout: Layout;
  painter: Painter;
  notes: NotesOverlay;
  drawings: DrawingsOverlay;
  headerW: number;
  headerH: number;
}

interface ResizeDrag {
  axis: "col" | "row";
  index: number;
  /** Border position in scroller coordinates when the drag began. */
  edge: number;
  startPointer: number;
  startSize: number;
  size: number;
}

/** Hit distance to a header border, and the smallest size a drag can leave. */
const EDGE_SLOP = 4;
const MIN_SIZE = 4;
const MAX_ROW_HEIGHT = 409;

interface UserSizes {
  rows: Map<number, number>;
  cols: Map<number, number>;
}

export function createViewer(container: HTMLElement, options: ViewerOptions = {}): Viewer {
  return new ViewerImpl(container, options);
}

class ViewerImpl implements Viewer {
  private readonly root: HTMLDivElement;
  private readonly scroller: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlayRoot: HTMLDivElement;
  private readonly overlay: OverlayPanes;
  private readonly tabs: SheetTabs | undefined;
  private readonly measurer: TextMeasurer;
  private readonly parser: ParserClient;
  private readonly locale: XlViewerLocale;
  private readonly listeners = new Map<string, Set<(p: never) => void>>();
  private readonly resizeObserver: ResizeObserver;
  private theme: ViewerTheme;
  private model: WorkbookModel | undefined;
  private fileName = "";
  private state: SheetState | undefined;
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  private frame = 0;
  private openToken = 0;
  private lastFrameMs = 0;
  private mdw = 7;
  private panes: Pane[] = [];
  private dprQuery: MediaQueryList | undefined;
  private destroyed = false;
  private readonly originalFamilies = new Map<object, string>();
  private readonly guide: HTMLDivElement;
  private readonly userSizes = new Map<number, UserSizes>();
  private readonly autoRows = new Map<number, Map<number, number>>();
  private drag: ResizeDrag | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ViewerOptions,
  ) {
    this.locale = options.locale ?? en;
    this.theme = { ...DEFAULT_THEME, ...options.theme };

    this.root = div("xv-root");
    this.scroller = div("xv-scroll");
    this.scroller.tabIndex = 0;
    this.content = div("xv-content");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "xv-grid";
    this.canvas.setAttribute("role", "img");
    this.overlayRoot = div("xv-panes");
    this.content.append(this.canvas, this.overlayRoot);
    this.scroller.appendChild(this.content);
    this.root.appendChild(this.scroller);
    this.guide = div("xv-guide");
    this.guide.hidden = true;
    this.root.appendChild(this.guide);
    if (options.showTabs !== false) {
      this.tabs = new SheetTabs(this.locale.messages.sheetTabsLabel, (i) => this.showSheet(i, true));
      this.root.appendChild(this.tabs.el);
    }
    container.appendChild(this.root);

    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.measurer = new TextMeasurer(ctx);
    this.overlay = new OverlayPanes(this.overlayRoot);
    this.parser = new ParserClient({
      useWorker: options.useWorker !== false,
      ...(options.workerUrl ? { workerUrl: options.workerUrl } : {}),
      locale: this.locale,
      maxFileSize: options.maxFileSize ?? 20 * 1024 * 1024,
      maxUncompressedSize: options.maxUncompressedSize ?? 200 * 1024 * 1024,
      maxCells: options.maxCells ?? 5_000_000,
    });

    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.scroller.addEventListener("mousemove", this.onMouseMove);
    this.scroller.addEventListener("mouseleave", this.onMouseLeave);
    this.scroller.addEventListener("mousedown", this.onMouseDown);
    this.scroller.addEventListener("dblclick", this.onDoubleClick);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.scroller);
    this.watchDpr();
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    this.onResize();
  }

  async open(src: OpenSource): Promise<void> {
    const token = ++this.openToken;
    try {
      const buffer = await toArrayBuffer(src);
      if (token !== this.openToken || this.destroyed) return;
      const model = await this.parser.parse(buffer);
      if (token !== this.openToken || this.destroyed) return;
      this.fileName = typeof File !== "undefined" && src instanceof File ? src.name : "";
      this.originalFamilies.clear();
      this.userSizes.clear();
      this.autoRows.clear();
      this.applyFontFallback(model);
      this.model = model;
      for (const w of model.warnings) this.options.onWarning?.(w);
      const visible = this.visibleSheets();
      if (visible.length === 0) throw new ParseError("Workbook has no visible sheets");
      this.tabs?.render(
        visible.map((index) => ({ index, name: model.sheets[index]!.name })),
        visible[0]!,
      );
      this.mdw = maxDigitWidth(model.defaultFont, this.ctx);
      this.teardownSheet();
      this.showSheet(visible[0]!, false);
      this.emit("load", { sheetNames: this.getSheetNames(), activeSheet: 0, warnings: model.warnings });
    } catch (err) {
      if (token !== this.openToken || this.destroyed) return;
      const e = err instanceof XlViewerError ? err : new ParseError(err instanceof Error ? err.message : String(err));
      this.emit("error", e);
      throw e;
    }
  }

  setActiveSheet(index: number): void {
    const visible = this.visibleSheets();
    const target = visible[index];
    if (target === undefined) throw new RangeError(`No visible sheet at index ${index}`);
    this.showSheet(target, true);
  }

  getActiveSheet(): number {
    if (!this.state) return -1;
    return this.visibleSheets().indexOf(this.state.index);
  }

  getSheetNames(): string[] {
    const m = this.model;
    return m ? this.visibleSheets().map((i) => m.sheets[i]!.name) : [];
  }

  getModel(): WorkbookModel | undefined {
    return this.model;
  }

  setTheme(theme: Partial<ViewerTheme>): void {
    this.theme = { ...this.theme, ...theme };
    if (theme.fontFallback !== undefined && this.model) {
      this.applyFontFallback(this.model);
      this.measurer.clear();
      this.autoRows.clear();
      if (this.state) this.showSheet(this.state.index, false, true);
      return;
    }
    this.state?.painter.setTheme(this.theme);
    this.requestDraw();
  }

  on<K extends keyof ViewerEventMap>(event: K, cb: (payload: ViewerEventMap[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb as (p: never) => void);
    return () => this.off(event, cb);
  }

  off<K extends keyof ViewerEventMap>(event: K, cb: (payload: ViewerEventMap[K]) => void): void {
    this.listeners.get(event)?.delete(cb as (p: never) => void);
  }

  getStats(): ViewerStats {
    return { frameMs: this.lastFrameMs, measureHitRate: this.measurer.hitRate };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.scroller.removeEventListener("mousemove", this.onMouseMove);
    this.scroller.removeEventListener("mouseleave", this.onMouseLeave);
    this.scroller.removeEventListener("mousedown", this.onMouseDown);
    this.scroller.removeEventListener("dblclick", this.onDoubleClick);
    this.endDrag();
    this.resizeObserver.disconnect();
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.teardownSheet();
    this.parser.destroy();
    this.listeners.clear();
    this.root.remove();
    this.model = undefined;
  }

  private emit<K extends keyof ViewerEventMap>(event: K, payload: ViewerEventMap[K]): void {
    for (const cb of this.listeners.get(event) ?? []) (cb as (p: ViewerEventMap[K]) => void)(payload);
  }

  private visibleSheets(): number[] {
    if (!this.model) return [];
    return this.model.sheets.map((s, i) => (s.state === "visible" ? i : -1)).filter((i) => i >= 0);
  }

  private applyFontFallback(model: WorkbookModel): void {
    const extra = this.theme.fontFallback;
    const visit = (f: Partial<ResolvedFont> | undefined) => {
      if (!f?.family) return;
      const original = this.originalFamilies.get(f) ?? f.family;
      this.originalFamilies.set(f, original);
      f.family = extra ? original.replace(/(sans-serif|serif|monospace)$/, `${extra}, $1`) : original;
    };
    visit(model.defaultFont);
    for (const s of model.styles) visit(s.font);
    for (const sheet of model.sheets) {
      for (const row of Object.values(sheet.cells))
        for (const cell of Object.values(row)) for (const run of cell.rich ?? []) visit(run.font);
    }
  }

  private teardownSheet(): void {
    if (!this.state) return;
    this.state.notes.destroy();
    this.state.drawings.destroy();
    this.overlay.clear();
    this.state = undefined;
  }

  private showSheet(index: number, emit: boolean, keepScroll = false): void {
    const model = this.model;
    const sheet = model?.sheets[index];
    if (!model || !sheet) return;
    if (this.state?.index === index && !keepScroll) return;
    const prevScroll = keepScroll ? { left: this.scroller.scrollLeft, top: this.scroller.scrollTop } : undefined;
    this.teardownSheet();

    const build = () => {
      const layout = this.buildLayout(sheet, index);
      return {
        layout,
        painter: new Painter(this.ctx, this.measurer, model.styles, model.defaultFont, sheet, layout, this.theme, this.mdw),
      };
    };
    let { layout, painter } = build();
    if (this.options.autoFitRows && !this.autoRows.has(index)) {
      const grown = this.growWrappedRows(sheet, index, layout, painter);
      this.autoRows.set(index, grown);
      if (grown.size) ({ layout, painter } = build());
    }
    const notes = new NotesOverlay(sheet, layout, this.overlay);
    const drawings = new DrawingsOverlay(sheet, layout, this.overlay, this.locale.messages, () => this.requestDraw());
    const { headerW, headerH } = this.headerSize(sheet, layout, model.defaultFont);
    this.state = { index, sheet, layout, painter, notes, drawings, headerW, headerH };

    this.content.style.width = `${headerW + layout.width}px`;
    this.content.style.height = `${headerH + layout.height}px`;
    this.canvas.setAttribute(
      "aria-label",
      this.locale.messages.gridLabel
        .replace("{file}", this.fileName)
        .replace("{sheet}", sheet.name)
        .replace("{range}", sheet.rowCount && sheet.colCount ? `A1:${cellName(sheet.rowCount - 1, sheet.colCount - 1)}` : "A1"),
    );
    this.tabs?.setActive(index);

    if (prevScroll) {
      this.scroller.scrollLeft = prevScroll.left;
      this.scroller.scrollTop = prevScroll.top;
    } else {
      const { frozenRows, frozenCols, topRow, leftCol } = sheet.view;
      this.scroller.scrollLeft = Math.max(
        0,
        layout.colLeft[Math.min(leftCol, layout.cols)]! - layout.colLeft[Math.min(frozenCols, layout.cols)]!,
      );
      this.scroller.scrollTop = Math.max(
        0,
        layout.rowTop[Math.min(topRow, layout.rows)]! - layout.rowTop[Math.min(frozenRows, layout.rows)]!,
      );
    }
    this.draw();
    if (emit) this.emit("sheetchange", this.visibleSheets().indexOf(index));
  }

  /** Rows whose wrapped text needs more height than the file gives them. */
  private growWrappedRows(sheet: SheetModel, index: number, layout: Layout, painter: Painter): Map<number, number> {
    const grown = new Map<number, number>();
    const user = this.userSizes.get(index)?.rows;
    for (const key of Object.keys(sheet.cells)) {
      const r = Number(key);
      if (r >= layout.rows || user?.has(r) || layout.rowHeight(r) === 0) continue;
      const row = sheet.cells[r]!;
      if (!Object.keys(row).some((c) => row[Number(c)]!.text !== "" && painter.styleAt(r, Number(c), row[Number(c)]).wrap)) continue;
      const fit = Math.min(MAX_ROW_HEIGHT, painter.fitRowHeight(r));
      if (fit > layout.rowHeight(r) / layout.scale + 0.5) grown.set(r, fit);
    }
    return grown;
  }

  private sizesFor(index: number): UserSizes {
    let sizes = this.userSizes.get(index);
    if (!sizes) this.userSizes.set(index, (sizes = { rows: new Map(), cols: new Map() }));
    return sizes;
  }

  private minScale(): number {
    const min = this.options.minFontSize ?? 12;
    const base = this.model?.defaultFont.sizePx ?? 0;
    return min > 0 && base > 0 ? min / base : 0;
  }

  private buildLayout(sheet: SheetModel, index: number): Layout {
    const minScale = this.minScale();
    const scale = Math.max(sheet.view.zoom / 100, minScale);
    const rowPx = Math.max(1, Math.round(sheet.defaultRowHeight) * scale);
    const colPx = Math.max(1, (sheet.defaultColWidth ?? sheet.baseColWidth + 0.71) * this.mdw * scale);
    const minRows = Math.ceil(this.viewH / rowPx) + 1;
    const minCols = Math.ceil(this.viewW / colPx) + 1;
    const user = this.userSizes.get(index);
    const overrides: SizeOverrides = {
      rows: new Map([...(this.autoRows.get(index) ?? []), ...(user?.rows ?? [])]),
      ...(user ? { cols: user.cols } : {}),
    };
    return new Layout(sheet, this.mdw, minRows, minCols, overrides, minScale);
  }

  private headerSize(sheet: SheetModel, layout: Layout, font: ResolvedFont): { headerW: number; headerH: number } {
    if (this.options.showHeaders === false || !sheet.view.showHeaders) return { headerW: 0, headerH: 0 };
    const scale = layout.scale;
    const css = cssFont({ ...font, bold: false, italic: false, vertAlign: undefined }, scale);
    const digit = this.measurer.width(css, "0");
    const digits = Math.max(2, String(layout.rows).length);
    return {
      headerW: Math.round(digits * digit + 12 * scale),
      headerH: Math.max(Math.round(16 * scale), Math.round(sheet.defaultRowHeight * scale)),
    };
  }

  private requestDraw(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const st = this.state;
    if (!st || this.viewW === 0 || this.viewH === 0) return;
    const start = performance.now();
    const dpr = this.dpr;
    // Snap scroll to device pixels so lines stay crisp.
    const sx = Math.round(this.scroller.scrollLeft * dpr) / dpr;
    const sy = Math.round(this.scroller.scrollTop * dpr) / dpr;
    const { frozenRows, frozenCols } = st.sheet.view;
    this.panes = computePanes(st.layout, this.viewW, this.viewH, st.headerW, st.headerH, sx, sy, frozenRows, frozenCols);
    st.painter.paint({ viewW: this.viewW, viewH: this.viewH, dpr, headerW: st.headerW, headerH: st.headerH, panes: this.panes });
    st.drawings.update(this.panes, st.layout.scale);
    this.overlay.update(this.panes);
    this.lastFrameMs = performance.now() - start;
  }

  private readonly onScroll = (): void => {
    this.requestDraw();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const st = this.state;
    if (!st || this.drag) return;
    const edge = this.edgeAt(e);
    this.scroller.style.cursor = edge ? (edge.axis === "col" ? "col-resize" : "row-resize") : "";
    if (!st.sheet.notes.length) return;
    const rect = this.scroller.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    const pane = this.panes.find((p) => vx >= p.x && vx < p.x + p.w && vy >= p.y && vy < p.y + p.h);
    if (!pane) {
      st.notes.hover(undefined, undefined);
      return;
    }
    const row = st.layout.rowAt(vy - pane.y + pane.sy);
    const col = st.layout.colAt(vx - pane.x + pane.sx);
    st.notes.hover(row, col);
  };

  private readonly onMouseLeave = (): void => {
    this.state?.notes.hover(undefined, undefined);
    if (!this.drag) this.scroller.style.cursor = "";
  };

  /** Header border under the pointer, if any. `edge` is in scroller coordinates. */
  private edgeAt(e: MouseEvent): { axis: "col" | "row"; index: number; edge: number } | undefined {
    const st = this.state;
    if (!st || this.options.resizable === false || st.headerW === 0) return undefined;
    const rect = this.scroller.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) return undefined;
    const { layout, headerW, headerH } = st;
    if (vy < headerH && vx >= headerW) {
      const pane = this.panes.find((p) => p.y === headerH && vx >= p.x && vx < p.x + p.w);
      if (!pane) return undefined;
      const c = layout.colAt(vx - pane.x + pane.sx);
      for (const index of [c, c - 1]) {
        if (index < 0 || layout.colWidth(index) === 0) continue;
        const edge = pane.x + layout.colLeft[index + 1]! - pane.sx;
        if (Math.abs(edge - vx) <= EDGE_SLOP && edge >= pane.x && edge <= pane.x + pane.w) return { axis: "col", index, edge };
      }
    } else if (vx < headerW && vy >= headerH) {
      const pane = this.panes.find((p) => p.x === headerW && vy >= p.y && vy < p.y + p.h);
      if (!pane) return undefined;
      const r = layout.rowAt(vy - pane.y + pane.sy);
      for (const index of [r, r - 1]) {
        if (index < 0 || layout.rowHeight(index) === 0) continue;
        const edge = pane.y + layout.rowTop[index + 1]! - pane.sy;
        if (Math.abs(edge - vy) <= EDGE_SLOP && edge >= pane.y && edge <= pane.y + pane.h) return { axis: "row", index, edge };
      }
    }
    return undefined;
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    const st = this.state;
    if (!st || e.button !== 0) return;
    const hit = this.edgeAt(e);
    if (!hit) return;
    e.preventDefault();
    const { layout } = st;
    const startSize = (hit.axis === "col" ? layout.colWidth(hit.index) : layout.rowHeight(hit.index)) / layout.scale;
    this.drag = {
      ...hit,
      startPointer: hit.axis === "col" ? e.clientX : e.clientY,
      startSize,
      size: startSize,
    };
    window.addEventListener("mousemove", this.onDragMove);
    window.addEventListener("mouseup", this.onDragEnd);
    this.scroller.style.cursor = hit.axis === "col" ? "col-resize" : "row-resize";
    this.moveGuide();
  };

  private readonly onDragMove = (e: MouseEvent): void => {
    const d = this.drag;
    const st = this.state;
    if (!d || !st) return;
    const delta = (d.axis === "col" ? e.clientX : e.clientY) - d.startPointer;
    d.size = Math.max(MIN_SIZE, Math.round(d.startSize + delta / st.layout.scale));
    this.moveGuide();
  };

  private readonly onDragEnd = (): void => {
    const d = this.drag;
    this.endDrag();
    if (d && Math.round(d.size) !== Math.round(d.startSize)) this.applySize(d.axis, d.index, d.size);
  };

  private moveGuide(): void {
    const d = this.drag;
    const st = this.state;
    if (!d || !st) return;
    const pos = d.edge + (d.size - d.startSize) * st.layout.scale;
    this.guide.hidden = false;
    this.guide.className = `xv-guide xv-guide-${d.axis}`;
    if (d.axis === "col") this.guide.style.transform = `translateX(${pos}px)`;
    else this.guide.style.transform = `translateY(${pos}px)`;
  }

  private endDrag(): void {
    window.removeEventListener("mousemove", this.onDragMove);
    window.removeEventListener("mouseup", this.onDragEnd);
    this.drag = undefined;
    this.guide.hidden = true;
    this.scroller.style.cursor = "";
  }

  private readonly onDoubleClick = (e: MouseEvent): void => {
    const st = this.state;
    const hit = this.edgeAt(e);
    if (!st || !hit) return;
    if (hit.axis === "row") this.applySize("row", hit.index, st.painter.fitRowHeight(hit.index));
    else this.applySize("col", hit.index, st.painter.fitColWidth(hit.index));
  };

  /** Stores a view-only size (undefined restores the file's) and re-lays out the sheet. */
  private applySize(axis: "col" | "row", index: number, size: number | undefined): void {
    const st = this.state;
    if (!st) return;
    const sizes = this.sizesFor(st.index);
    const map = axis === "col" ? sizes.cols : sizes.rows;
    if (size === undefined) map.delete(index);
    else map.set(index, Math.max(MIN_SIZE, Math.min(axis === "row" ? MAX_ROW_HEIGHT : 2000, Math.round(size))));
    if (axis === "col") this.autoRows.delete(st.index);
    this.showSheet(st.index, false, true);
  }

  private onResize(): void {
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    if (w === this.viewW && h === this.viewH) return;
    this.viewW = w;
    this.viewH = h;
    this.resizeCanvas();
    const st = this.state;
    if (st) {
      const scale = st.layout.scale;
      const needRows = st.layout.height < h - st.headerH + st.sheet.defaultRowHeight * scale;
      const needCols = st.layout.width < w - st.headerW + 64 * scale;
      if (needRows || needCols) {
        this.showSheet(st.index, false, true);
        return;
      }
    }
    this.draw();
  }

  private resizeCanvas(): void {
    const dpr = this.dpr;
    this.canvas.width = Math.max(1, Math.round(this.viewW * dpr));
    this.canvas.height = Math.max(1, Math.round(this.viewH * dpr));
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    this.overlayRoot.style.width = `${this.viewW}px`;
    this.overlayRoot.style.height = `${this.viewH}px`;
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.dpr = window.devicePixelRatio || 1;
    if (typeof matchMedia === "function") {
      this.dprQuery = matchMedia(`(resolution: ${this.dpr}dppx)`);
      this.dprQuery.addEventListener("change", this.onDprChange);
    }
  }

  private readonly onDprChange = (): void => {
    this.watchDpr();
    this.measurer.clear();
    this.resizeCanvas();
    this.draw();
  };

  private readonly onFontsLoaded = (): void => {
    this.measurer.clear();
    this.autoRows.clear();
    this.state?.painter.resetFonts();
    // A web font can change the measured digit width, and with it every column width.
    if (this.model && this.state) {
      const mdw = maxDigitWidth(this.model.defaultFont, this.ctx);
      if (mdw !== this.mdw) {
        this.mdw = mdw;
        this.showSheet(this.state.index, false, true);
        return;
      }
    }
    this.requestDraw();
  };
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

async function toArrayBuffer(src: OpenSource): Promise<ArrayBuffer> {
  if (src instanceof ArrayBuffer) return src;
  if (src instanceof Uint8Array) return copyBytes(src);
  if (typeof Blob !== "undefined" && src instanceof Blob) return src.arrayBuffer();
  throw new TypeError("open() expects a File, Blob, ArrayBuffer or Uint8Array");
}
