import { describe, expect, it } from "vitest";
import { buildOption, formatAxisValue } from "../src/chart/options";
import { ko } from "../src/locales/ko";
import type { ChartModel } from "../src/model/types";
import { parseXlsxBuffer } from "../src/parser";
import { fixture, hasFixture } from "./helpers";

type Opt = Record<string, any>;
// The sales report is not committed; its tests run only where the file exists.
const hasSales = hasFixture("excel/sales-report.xlsx");
const charts = hasSales ? parseXlsxBuffer(fixture("excel/sales-report.xlsx"), { locale: ko }).model.sheets[0]!.charts : [];
const generated = parseXlsxBuffer(fixture("generated/charts.xlsx")).model.sheets[0]!.charts;
const build = (m: ChartModel) => buildOption(m, { width: 500, height: 300, scale: 1 }) as Opt;

describe("chart options", () => {
  it.skipIf(!hasSales)("reproduces the sales report axes", () => {
    const o = build(charts[0]!);
    expect(o.yAxis[0]).toMatchObject({ min: 0, max: 2250, interval: 450 });
    expect(o.xAxis.axisLabel.show).toBe(false);
    expect(o.legend).toBeUndefined();
    expect(o.title).toBeUndefined();
    expect(o.series).toHaveLength(4);
    expect(o.series[1].itemStyle.color).toBe("#C0504D");
    expect(build(charts[1]!).yAxis[0]).toMatchObject({ max: 11250, interval: 2250 });
  });

  it.skipIf(!hasSales)("uses the plot area from manualLayout", () => {
    const o = build(charts[0]!);
    expect(o.grid.left).toBeCloseTo(0.147458 * 500, 2);
    expect(o.grid.containLabel).toBe(false);
  });

  it("converts Excel gap width to ECharts category gap", () => {
    const o = build(generated[0]!);
    // 3 bars, gap 150% -> 1.5 / 4.5
    expect(o.series[0].barCategoryGap).toBe("33.333333333333336%");
  });

  it("stacks and normalises percent stacks", () => {
    const stacked = build(generated[1]!);
    expect(stacked.series.every((s: Opt) => s.stack === "bar")).toBe(true);
    const percent = build(generated[2]!);
    const firstPoint = percent.series.map((s: Opt) => s.data[0].value);
    expect(firstPoint.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100);
    expect(percent.xAxis[0]).toMatchObject({ min: 0, max: 100 });
  });

  it("builds pie, doughnut and scatter series", () => {
    const pie = build(generated[4]!);
    expect(pie.series[0].type).toBe("pie");
    expect(pie.series[0].data).toHaveLength(6);
    const dough = build(generated[5]!);
    expect(dough.series[0].radius[0]).not.toBe("0%");
    const scatter = build(generated[7]!);
    expect(scatter.series[0].type).toBe("scatter");
    expect(scatter.xAxis.type).toBe("value");
  });

  it("puts secondary series on a second axis", () => {
    const o = build(generated[8]!);
    expect(o.yAxis).toHaveLength(2);
    expect(o.series.find((s: Opt) => s.type === "line").yAxisIndex).toBe(1);
  });

  it("formats axis values", () => {
    expect(formatAxisValue(0.25, "0%")).toBe("25%");
    expect(formatAxisValue(1234.5, "#,##0.0")).toBe("1,234.5");
    expect(formatAxisValue(3, undefined)).toBe("3");
  });
});
