import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { escapeHtml, tooltipHtml } from "../src/chart/options";
import { fontFamily } from "../src/format/fonts";
import type { SheetModel } from "../src/model/types";
import { parseXlsxBuffer } from "../src/parser";
import { unzip } from "../src/parser/zip";
import { Layout } from "../src/render/layout";
import { miniXlsx } from "./helpers";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function emptySheet(merges: SheetModel["merges"]): SheetModel {
  return {
    name: "S",
    state: "visible",
    defaultRowHeight: 20,
    baseColWidth: 8,
    rowCount: 10,
    colCount: 5,
    rows: {},
    cols: [],
    cells: {},
    merges,
    notes: [],
    images: [],
    shapes: [],
    charts: [],
    cf: {},
    view: { showGridLines: true, showHeaders: true, frozenRows: 0, frozenCols: 0, zoom: 100, topRow: 0, leftCol: 0 },
  };
}

describe("hostile input", () => {
  it("ignores a zip entry named __proto__ instead of enumerating its bytes", () => {
    const zip = Buffer.from(zipSync({ "a.txt": strToU8("x"), AAAAAAAAA: new Uint8Array(300_000) }));
    for (let i = zip.indexOf("AAAAAAAAA"); i >= 0; i = zip.indexOf("AAAAAAAAA", i + 9)) zip.write("__proto__", i);
    const entries = unzip(new Uint8Array(zip), { maxFileSize: 1e7, maxUncompressedSize: 1e9 });
    expect([...entries.keys()]).toEqual(["a.txt"]);
  });

  it("keeps file-supplied font names from forming CSS syntax", () => {
    const css = fontFamily('X\n;cursor:url(https://evil.example/c.png),auto;x:"');
    expect(css).not.toMatch(/[;\n()]/);
    const name = /^"([^"]*)"/.exec(css)![1]!;
    expect(name).toBe("Xcursorurlhttpsevil.examplec.pngautox");
    expect(name).not.toMatch(/[:/,]/);
    expect(fontFamily("맑은 고딕 2")).toContain("맑은 고딕 2");
  });

  it("does not multiply conditional formatting work with repeated ranges", () => {
    const ranges = Array(300).fill("A1:T1000").join(" ");
    let blocks = "";
    for (let i = 0; i < 10; i++) {
      blocks += `<conditionalFormatting sqref="${ranges}"><cfRule type="cellIs" priority="${i}" operator="equal"><formula>1</formula></cfRule></conditionalFormatting>`;
    }
    const files = unzipSync(miniXlsx(`<row r="1"><c r="A1"><v>1</v></c></row>`));
    files["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>${blocks}</worksheet>`,
    );
    const start = performance.now();
    parseXlsxBuffer(zipSync(files));
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it("reports when conditional formatting exceeds its cell budget", () => {
    const blocks = Array.from({ length: 150 }, (_, i) => {
      const col = i + 1; // distinct ranges, each 1,000 x 20 cells
      return `<conditionalFormatting sqref="A${col}:T${col + 999}"><cfRule type="cellIs" priority="${i + 1}" operator="equal"><formula>1</formula></cfRule></conditionalFormatting>`;
    }).join("");
    const files = unzipSync(miniXlsx(`<row r="1"><c r="A1"><v>1</v></c></row>`));
    files["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>${blocks}</worksheet>`,
    );
    const model = parseXlsxBuffer(zipSync(files)).model;
    expect(model.warnings.find((w) => w.code === "CF_RULE_UNSUPPORTED")?.message).toContain("limit");
  });

  it("looks up merges quickly when a sheet has hundreds of thousands", () => {
    const merges = Array.from({ length: 200_000 }, (_, i) => ({ r1: i * 2, c1: 0, r2: i * 2 + 1, c2: 1 }));
    const layout = new Layout(emptySheet(merges), 7, 0, 0);
    const start = performance.now();
    let found = 0;
    for (let r = 150_000; r < 150_200; r++) found += layout.mergesIn(r, 0, r, 5).length + (layout.mergeCovering(r, 0) ? 1 : 0);
    expect(found).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("finds a merge that started far above the queried row", () => {
    const layout = new Layout(
      emptySheet([
        { r1: 0, c1: 0, r2: 500, c2: 2 },
        { r1: 10, c1: 5, r2: 11, c2: 6 },
      ]),
      7,
      0,
      0,
    );
    expect(layout.mergeCovering(400, 1)).toEqual({ r1: 0, c1: 0, r2: 500, c2: 2 });
    expect(layout.mergesIn(400, 0, 400, 9)).toHaveLength(1);
  });

  it("escapes file text in chart tooltips", () => {
    const html = tooltipHtml([
      { marker: "<span>m</span>", seriesName: "<img src=x onerror=alert(1)>", axisValueLabel: "</div><script>", value: 3 },
    ]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<span>m</span>");
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});
