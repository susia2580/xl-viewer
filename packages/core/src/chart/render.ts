import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import type { ChartModel } from "../model/types.js";
import { buildOption, type ChartSize } from "./options.js";

use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, SVGRenderer]);

export interface ChartHandle {
  dispose(): void;
}

export function renderChart(el: HTMLElement, model: ChartModel, size: ChartSize): ChartHandle {
  const border = model.area.border;
  const bw = border ? Math.max(1, Math.round((model.area.borderWidth ?? 1) * size.scale)) : 0;
  if (border) el.style.border = `${bw}px solid ${border}`;
  const inner = document.createElement("div");
  inner.className = "xv-chart-inner";
  el.appendChild(inner);
  const width = Math.max(1, size.width - bw * 2);
  const height = Math.max(1, size.height - bw * 2);
  const chart = init(inner, null, { renderer: "svg", width, height });
  try {
    chart.setOption(buildOption(model, { width, height, scale: size.scale }));
  } catch (err) {
    chart.dispose();
    inner.remove();
    throw err;
  }
  return {
    dispose: () => chart.dispose(),
  };
}
