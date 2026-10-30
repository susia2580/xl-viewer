import type { LocaleMessages } from "../../locales/types.js";
import type { ChartModel, Frame, ImageModel, ShapeModel, SheetModel } from "../../model/types.js";
import type { ChartHandle } from "../../chart/render.js";
import type { Layout } from "../layout.js";
import type { Pane } from "../panes.js";
import { intersects, paneKindFor, type OverlayPanes, type Rect } from "./panes.js";

interface Item {
  rect: Rect;
  pane: ReturnType<typeof paneKindFor>;
  el?: HTMLElement;
  mounted: boolean;
  kind: "image" | "chart" | "shape";
  z: number;
  image?: ImageModel;
  shape?: ShapeModel;
  chart?: ChartModel;
  chartHandle?: ChartHandle;
  loading?: boolean;
}

type ChartModule = typeof import("../../chart/render.js");
let chartModule: Promise<ChartModule> | undefined;

export function loadChartModule(): Promise<ChartModule> {
  chartModule ??= import("../../chart/render.js");
  return chartModule;
}

export class DrawingsOverlay {
  private readonly items: Item[] = [];
  private readonly urls: string[] = [];
  private destroyed = false;

  constructor(
    sheet: SheetModel,
    layout: Layout,
    private readonly panes: OverlayPanes,
    private readonly messages: LocaleMessages,
    private readonly onChartReady: () => void,
  ) {
    const { frozenRows, frozenCols } = sheet.view;
    const add = (kind: Item["kind"], model: ImageModel | ShapeModel | ChartModel, frame?: Frame): void => {
      const base = layout.anchorRect(model.anchor);
      const rect = frame ? { x: base.x + frame.x * base.w, y: base.y + frame.y * base.h, w: frame.w * base.w, h: frame.h * base.h } : base;
      if (rect.w <= 0 || rect.h <= 0) return;
      const item: Item = {
        rect,
        pane: paneKindFor(model.anchor.from.row, model.anchor.from.col, frozenRows, frozenCols),
        mounted: false,
        kind,
        z: model.z ?? 0,
      };
      if (kind === "image") item.image = model as ImageModel;
      else if (kind === "shape") item.shape = model as ShapeModel;
      else item.chart = model as ChartModel;
      this.items.push(item);
    };
    for (const image of sheet.images) add("image", image, image.frame);
    for (const shape of sheet.shapes) add("shape", shape, shape.frame);
    for (const chart of sheet.charts) add("chart", chart);
  }

  get hasCharts(): boolean {
    return this.items.some((i) => i.kind === "chart");
  }

  /** Attaches items that intersect their pane and detaches the rest. */
  update(panes: Pane[], scale: number): void {
    for (const item of this.items) {
      const pane = panes.find((p) => p.kind === item.pane);
      const visible = !!pane && intersects(item.rect, pane);
      if (visible && !item.mounted) {
        item.el ??= this.create(item, scale);
        this.panes.layer(item.pane).appendChild(item.el);
        item.mounted = true;
      } else if (!visible && item.mounted) {
        item.el?.remove();
        item.mounted = false;
      }
    }
  }

  private create(item: Item, scale: number): HTMLElement {
    const el = document.createElement("div");
    el.className = `xv-${item.kind}`;
    el.style.zIndex = String(item.z);
    el.style.left = `${item.rect.x}px`;
    el.style.top = `${item.rect.y}px`;
    el.style.width = `${item.rect.w}px`;
    el.style.height = `${item.rect.h}px`;
    if (item.kind === "image") this.fillImage(el, item.image!);
    else if (item.kind === "shape") this.fillShape(el, item.shape!, scale);
    else this.fillChart(el, item, scale);
    return el;
  }

  private fillImage(el: HTMLElement, image: ImageModel): void {
    if (!image.mime || image.data.byteLength === 0) {
      this.placeholder(el, this.messages.imageError);
      return;
    }
    const url = URL.createObjectURL(new Blob([image.data], { type: image.mime }));
    this.urls.push(url);
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.src = url;
    img.onerror = () => {
      img.remove();
      this.placeholder(el, this.messages.imageError);
    };
    el.appendChild(img);
  }

  private fillShape(el: HTMLElement, shape: ShapeModel, scale: number): void {
    const px = (v: number) => `${v * scale}px`;
    if (shape.fill) el.style.background = shape.fill;
    if (shape.line) el.style.border = `${px(shape.line.width)} solid ${shape.line.color}`;
    if (shape.geometry === "ellipse") el.style.borderRadius = "50%";
    else if (shape.geometry === "roundRect") el.style.borderRadius = `${8 * scale}px`;
    const body = document.createElement("div");
    body.className = "xv-shape-text";
    body.style.justifyContent = shape.vAlign === "middle" ? "center" : shape.vAlign === "bottom" ? "flex-end" : "flex-start";
    body.style.padding = shape.insets.map(px).join(" ");
    if (!shape.wrap) body.style.whiteSpace = "pre";
    for (const para of shape.paragraphs) {
      const p = document.createElement("div");
      p.style.textAlign = para.align;
      p.style.fontSize = px(para.size);
      p.style.lineHeight = String(para.lineHeight ?? 1.2);
      p.style.minHeight = `${para.size * scale * (para.lineHeight ?? 1.2)}px`;
      for (const run of para.runs) {
        const span = document.createElement("span");
        span.textContent = run.text;
        span.style.fontSize = px(run.size);
        if (run.bold) span.style.fontWeight = "700";
        if (run.italic) span.style.fontStyle = "italic";
        if (run.underline) span.style.textDecoration = "underline";
        if (run.color) span.style.color = run.color;
        if (run.family) span.style.fontFamily = run.family;
        if (run.spacing) span.style.letterSpacing = px(run.spacing);
        if (run.shadow) span.style.textShadow = `0 ${px(1)} ${px(4)} rgba(0, 0, 0, 0.43)`;
        p.appendChild(span);
      }
      body.appendChild(p);
    }
    el.appendChild(body);
  }

  private fillChart(el: HTMLElement, item: Item, scale: number): void {
    const chart = item.chart!;
    if (chart.kind === "unsupported") {
      this.placeholder(el, chart.error ? this.messages.chartError : this.messages.unsupportedChart);
      el.classList.add("xv-chart-box");
      return;
    }
    item.loading = true;
    loadChartModule()
      .then((mod) => {
        if (this.destroyed) return;
        item.chartHandle = mod.renderChart(el, chart, { width: item.rect.w, height: item.rect.h, scale });
        item.loading = false;
        this.onChartReady();
      })
      .catch(() => {
        item.loading = false;
        this.placeholder(el, this.messages.chartError);
      });
  }

  private placeholder(el: HTMLElement, text: string): void {
    el.classList.add("xv-placeholder");
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
  }

  /** True while a chart is still loading. */
  get busy(): boolean {
    return this.items.some((i) => i.loading);
  }

  destroy(): void {
    this.destroyed = true;
    for (const item of this.items) {
      item.chartHandle?.dispose();
      item.el?.remove();
    }
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.length = 0;
  }
}
