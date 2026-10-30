import type { ChartAxis, ChartFont, ChartModel, ChartSeries } from "../model/types.js";
import { excelScale } from "./scale.js";

export interface ChartSize {
  width: number;
  height: number;
  scale: number;
}

type Obj = Record<string, unknown>;

const DEFAULT_FAMILY = 'Calibri, Carlito, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const TEXT = "#595959";
const PT = 96 / 72;

function fontOf(f: ChartFont | undefined, defaultPt: number, scale: number): Obj {
  return {
    fontSize: (f?.size ?? defaultPt * PT) * scale,
    color: f?.color ?? TEXT,
    fontWeight: f?.bold ? "bold" : "normal",
    fontFamily: f?.family ?? DEFAULT_FAMILY,
  };
}

/** Minimal Excel number format support for axis labels. */
export function formatAxisValue(v: number, fmt: string | undefined): string {
  if (!fmt) return trimFloat(v);
  const percent = fmt.includes("%");
  const n = percent ? v * 100 : v;
  const decimals = /\.(0+)/.exec(fmt)?.[1]?.length ?? 0;
  const grouped = fmt.includes(",");
  const s = n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
  return percent ? s + "%" : s;
}

function trimFloat(v: number): string {
  return String(Math.round(v * 1e9) / 1e9);
}

function stackKey(model: ChartModel, s: ChartSeries): string | undefined {
  const g = model.options.grouping;
  if (g !== "stacked" && g !== "percentStacked") return undefined;
  return (s.secondary ? "secondary-" : "") + s.type;
}

function seriesValues(model: ChartModel): (number | null)[][] {
  const percent = model.options.grouping === "percentStacked";
  if (!percent) return model.series.map((s) => s.values);
  const len = Math.max(0, ...model.series.map((s) => s.values.length));
  const totals = Array.from({ length: len }, (_, i) => model.series.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0));
  return model.series.map((s) => s.values.map((v, i) => (v === null ? null : totals[i] ? (v / totals[i]!) * 100 : 0)));
}

function valueRange(model: ChartModel, values: (number | null)[][], secondary: boolean): [number, number] {
  const idx = model.series.map((s, i) => (!!s.secondary === secondary ? i : -1)).filter((i) => i >= 0);
  let lo = Infinity;
  let hi = -Infinity;
  const stacked = model.options.grouping === "stacked" || model.options.grouping === "percentStacked";
  if (stacked) {
    const len = Math.max(0, ...idx.map((i) => values[i]!.length));
    for (let p = 0; p < len; p++) {
      let pos = 0;
      let neg = 0;
      for (const i of idx) {
        const v = values[i]![p] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    }
  } else {
    for (const i of idx)
      for (const v of values[i]!)
        if (v !== null) {
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
  }
  if (lo === Infinity) return [0, 1];
  return [lo, hi];
}

function valueAxis(axis: ChartAxis, range: [number, number], scale: number, percent: boolean): Obj {
  const s = percent ? { min: 0, max: 100, interval: axis.majorUnit ? axis.majorUnit * 100 : 10 } : excelScale(range[0], range[1], axis);
  return {
    type: "value",
    show: !axis.hidden,
    min: s.min,
    max: s.max,
    interval: s.interval,
    inverse: !!axis.reversed,
    axisLabel: {
      show: axis.labels,
      ...fontOf(axis.font, 9, scale),
      formatter: (v: number) => (percent ? `${Math.round(v)}%` : formatAxisValue(v, axis.numFmt)),
    },
    axisLine: { show: !!axis.line, lineStyle: { color: axis.line?.color ?? "#D9D9D9", width: (axis.line?.width ?? 1) * scale } },
    axisTick: { show: !!axis.line },
    splitLine: { show: axis.gridlines, lineStyle: { color: axis.grid?.color ?? "#D9D9D9", width: (axis.grid?.width ?? 1) * scale } },
    ...(axis.title ? { name: axis.title, nameLocation: "middle", nameGap: 32 * scale, nameTextStyle: fontOf(axis.font, 10, scale) } : {}),
  };
}

function categoryAxis(axis: ChartAxis, categories: (string | number)[], scale: number): Obj {
  return {
    type: "category",
    show: !axis.hidden,
    data: categories.map(String),
    inverse: !!axis.reversed,
    boundaryGap: true,
    axisLabel: { show: axis.labels, ...fontOf(axis.font, 9, scale) },
    axisLine: { show: !!axis.line, lineStyle: { color: axis.line?.color ?? "#D9D9D9", width: (axis.line?.width ?? 1) * scale } },
    axisTick: { show: !!axis.line, alignWithLabel: false },
    splitLine: { show: axis.gridlines, lineStyle: { color: axis.grid?.color ?? "#D9D9D9", width: (axis.grid?.width ?? 1) * scale } },
    ...(axis.title ? { name: axis.title, nameLocation: "middle", nameGap: 28 * scale, nameTextStyle: fontOf(axis.font, 10, scale) } : {}),
  };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

interface TooltipParam {
  marker?: unknown;
  seriesName?: unknown;
  name?: unknown;
  value?: unknown;
  axisValueLabel?: unknown;
}

/**
 * Series and category names come from the file and ECharts renders tooltips as HTML,
 * so everything except ECharts' own colour marker is escaped here.
 */
export function tooltipHtml(params: TooltipParam | TooltipParam[]): string {
  const list = Array.isArray(params) ? params : [params];
  const head = Array.isArray(params) && list[0] ? `<div>${escapeHtml(list[0].axisValueLabel ?? list[0].name ?? "")}</div>` : "";
  const rows = list.map((p) => {
    const value = Array.isArray(p.value) ? p.value.join(", ") : p.value;
    const label = Array.isArray(params) ? p.seriesName : (p.name ?? p.seriesName);
    return `<div>${typeof p.marker === "string" ? p.marker : ""}${escapeHtml(label ?? "")}: <b>${escapeHtml(value ?? "")}</b></div>`;
  });
  return head + rows.join("");
}

export function buildOption(model: ChartModel, size: ChartSize): Obj {
  const { scale, width, height } = size;
  const option: Obj = {
    animation: false,
    backgroundColor: model.area.fill === "transparent" ? "transparent" : (model.area.fill ?? "#FFFFFF"),
    textStyle: { fontFamily: DEFAULT_FAMILY, color: TEXT },
    tooltip: {
      trigger: model.kind === "pie" || model.kind === "doughnut" ? "item" : "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: tooltipHtml,
    },
  };
  if (model.title) {
    option.title = { text: model.title, left: "center", top: 6 * scale, textStyle: fontOf(model.titleFont, 14, scale) };
  }
  if (model.legend !== "none") {
    const vertical = model.legend === "left" || model.legend === "right";
    option.legend = {
      orient: vertical ? "vertical" : "horizontal",
      ...(model.legend === "bottom" ? { bottom: 6 * scale, left: "center" } : {}),
      ...(model.legend === "top" ? { top: (model.title ? 32 : 6) * scale, left: "center" } : {}),
      ...(model.legend === "right" ? { right: 6 * scale, top: "middle" } : {}),
      ...(model.legend === "left" ? { left: 6 * scale, top: "middle" } : {}),
      textStyle: fontOf(model.legendFont, 9, scale),
      itemWidth: 10 * scale,
      itemHeight: 10 * scale,
      icon: "rect",
    };
  }

  if (model.kind === "pie" || model.kind === "doughnut") {
    option.series = pieSeries(model, scale);
    return option;
  }

  const values = seriesValues(model);
  const percent = model.options.grouping === "percentStacked";
  const horizontal = !!model.options.horizontal;
  const isScatter = model.kind === "scatter";
  const categories = model.series[0]?.categories ?? [];

  if (model.plot && Number.isFinite(model.plot.x)) {
    option.grid = {
      left: model.plot.x * width,
      top: model.plot.y * height,
      width: model.plot.w * width,
      height: model.plot.h * height,
      containLabel: false,
      ...(model.plot.fill ? { show: true, backgroundColor: model.plot.fill, borderWidth: 0 } : {}),
    };
  } else {
    const legendRoom = (pos: string) => (model.legend === pos ? 28 * scale : 0);
    option.grid = {
      left: 12 * scale + legendRoom("left") * 3,
      right: 16 * scale + (model.legend === "right" ? 90 * scale : 0),
      top: (model.title ? 40 : 14) * scale + legendRoom("top"),
      bottom: 10 * scale + legendRoom("bottom"),
      containLabel: true,
    };
  }

  const primaryRange = valueRange(model, values, false);
  const valAx = valueAxis(model.axes.value, primaryRange, scale, percent);
  const yAxes: Obj[] = [valAx];
  if (model.axes.secondary)
    yAxes.push({
      ...valueAxis(model.axes.secondary, valueRange(model, values, true), scale, percent),
      position: horizontal ? "top" : "right",
    });

  let xAxis: Obj;
  if (isScatter) {
    const xs = model.series.flatMap((s) => s.categories.filter((c): c is number => typeof c === "number"));
    xAxis = valueAxis(model.axes.category, xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1], scale, false);
  } else {
    xAxis = categoryAxis(model.axes.category, categories, scale);
  }
  if (horizontal) {
    option.yAxis = { ...xAxis, inverse: !model.axes.category.reversed };
    option.xAxis = yAxes;
  } else {
    option.xAxis = xAxis;
    option.yAxis = yAxes;
  }

  const barCount = model.series.filter((s) => s.type === "bar").length;
  const stacked = model.options.grouping === "stacked" || model.options.grouping === "percentStacked";
  const overlap = (model.options.overlap ?? (stacked ? 100 : 0)) / 100;
  const n = stacked ? 1 : Math.max(1, barCount - (barCount - 1) * overlap);
  const g = (model.options.gapWidth ?? 150) / 100;

  option.series = model.series.map((s, i) => {
    const data = values[i]!;
    const axisIndex = s.secondary ? 1 : 0;
    const base: Obj = {
      name: s.name,
      [horizontal ? "xAxisIndex" : "yAxisIndex"]: axisIndex,
      stack: stackKey(model, s),
      label: {
        show: !!s.labels,
        ...fontOf(undefined, 9, scale),
        position: s.type === "bar" ? (stacked ? "inside" : horizontal ? "right" : "top") : "top",
      },
      emphasis: { disabled: true },
    };
    if (s.type === "bar") {
      return {
        ...base,
        type: "bar",
        data: data.map((v, p) => ({ value: v, itemStyle: s.pointColors?.[p] ? { color: s.pointColors[p] } : undefined })),
        itemStyle: { color: s.color, borderColor: s.border?.color, borderWidth: s.border ? s.border.width * scale : 0 },
        barGap: `${-overlap * 100}%`,
        barCategoryGap: `${(100 * g) / (n + g)}%`,
      };
    }
    if (s.type === "scatter") {
      const points = data.map((v, p) => [typeof s.categories[p] === "number" ? s.categories[p] : p + 1, v]);
      return {
        ...base,
        type: s.lines ? "line" : "scatter",
        data: points,
        smooth: !!s.smooth,
        symbol: s.marker === false ? "none" : "circle",
        symbolSize: 7 * scale,
        itemStyle: { color: s.color },
        lineStyle: { color: s.color, width: (s.lineWidth ?? 2.25 * PT) * scale },
      };
    }
    return {
      ...base,
      type: "line",
      data,
      smooth: !!s.smooth,
      connectNulls: false,
      symbol: s.type === "area" || s.marker === false ? "none" : "circle",
      symbolSize: 6 * scale,
      itemStyle: { color: s.color },
      lineStyle: { color: s.color, width: s.type === "area" ? 0 : (s.lineWidth ?? 2.25 * PT) * scale },
      ...(s.type === "area" ? { areaStyle: { color: s.color, opacity: 1 } } : {}),
    };
  });
  return option;
}

function pieSeries(model: ChartModel, scale: number): Obj[] {
  const s = model.series[0];
  if (!s) return [];
  const palette = model.options.palette;
  const vary = model.options.varyColors !== false;
  const doughnut = model.kind === "doughnut";
  const outer = 75;
  const inner = doughnut ? (outer * (model.options.holeSize ?? 50)) / 100 : 0;
  return [
    {
      type: "pie",
      name: s.name,
      radius: [`${inner}%`, `${outer}%`],
      center: ["50%", model.title ? "55%" : "50%"],
      startAngle: 90 - (model.options.firstSliceAngle ?? 0),
      clockwise: true,
      avoidLabelOverlap: true,
      label: { show: !!s.labels, ...fontOf(undefined, 9, scale), formatter: "{c}" },
      labelLine: { show: !!s.labels },
      emphasis: { disabled: true },
      itemStyle: { borderColor: "#FFFFFF", borderWidth: 1 * scale },
      data: s.values.map((v, i) => ({
        name: String(s.categories[i] ?? i + 1),
        value: v ?? 0,
        itemStyle: { color: s.pointColors?.[i] ?? (vary ? (palette[i % palette.length] ?? s.color) : s.color) },
      })),
    },
  ];
}
