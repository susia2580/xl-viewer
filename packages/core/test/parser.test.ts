import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { FileTooLargeError, InvalidFileError, ParseError, UnsupportedFormatError } from "../src/errors";
import { ko } from "../src/locales/ko";
import { en } from "../src/locales/en";
import type { WorkbookModel } from "../src/model/types";
import { parseXlsxBuffer } from "../src/parser";
import { fixture, hasFixture, miniXlsx } from "./helpers";

const parse = (path: string, locale = ko) => parseXlsxBuffer(fixture(path), { locale }).model;

function texts(model: WorkbookModel, sheet: number): string[][] {
  const s = model.sheets[sheet]!;
  const out: string[][] = [];
  for (let r = 0; r < s.rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < s.colCount; c++) row.push(s.cells[r]?.[c]?.text ?? "");
    out.push(row);
  }
  return out;
}

const theme = { colors: Array<string>(12).fill("#000000"), majorFont: "Calibri", minorFont: "Calibri" };

// The sales report is not committed; its tests run only where the files exist.
const hasSales = hasFixture("excel/sales-report.xlsx") && hasFixture("numbers/sales-report.xlsx");

describe.skipIf(!hasSales)("sales report (reference file)", () => {
  const numbers = hasSales ? parse("numbers/sales-report.xlsx") : undefined!;
  const excel = hasSales ? parse("excel/sales-report.xlsx") : undefined!;

  it("reads both sheets without warnings", () => {
    for (const m of [numbers, excel]) {
      expect(m.sheets.map((s) => s.name)).toEqual(["매출현황", "항목정의"]);
      expect(m.warnings).toEqual([]);
      expect(m.sheets[0]!.view.showGridLines).toBe(false);
    }
  });

  it("shows the same text whichever app saved the file", () => {
    expect(texts(numbers, 0)).toEqual(texts(excel, 0));
    expect(texts(numbers, 1)).toEqual(texts(excel, 1));
  });

  it("uses cached formula results", () => {
    const s = excel.sheets[0]!;
    expect(s.cells[1]![4]!.text).toBe("3,000,000");
    expect(s.cells[20]![2]!.text).toBe("15,980");
    expect(s.cells[34]![1]!.text).toBe("8,840");
  });

  it("reads the five header notes with their VML boxes", () => {
    for (const m of [numbers, excel]) {
      const notes = m.sheets[0]!.notes;
      expect(notes.map((n) => [n.row, n.col])).toEqual([
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ]);
      expect(notes[2]!.rich.map((r) => r.text).join("")).toBe("작성자:\n해당 월·채널의 매출 금액. 단위는 백만원입니다.");
      expect(notes.every((n) => !n.alwaysVisible && n.box && n.from)).toBe(true);
    }
  });

  it("reads two clustered column charts", () => {
    for (const m of [numbers, excel]) {
      const charts = m.sheets[0]!.charts;
      expect(charts).toHaveLength(2);
      expect(charts.map((c) => c.kind)).toEqual(["bar", "bar"]);
      expect(charts[0]!.series.map((s) => s.values)).toEqual([
        [0, 0, 0, 0, 0, 0, 0],
        [0, 1200, 1350, 1500, 1420, 1620, 1750],
        [0, 800, 760, 840, 790, 870, 910],
        [0, 300, 330, 360, 350, 400, 430],
      ]);
      expect(charts[1]!.series[1]!.values).toEqual([null, 8840, 4970, 2170]);
      expect(charts[0]!.axes.category.labels).toBe(false);
      expect(charts[0]!.axes.value.majorUnit).toBe(450);
      expect(charts[0]!.legend).toBe("none");
      expect(charts[0]!.title).toBeUndefined();
    }
  });

  it("keeps column ranges instead of expanding them", () => {
    const cols = numbers.sheets[0]!.cols;
    expect(cols[cols.length - 1]).toMatchObject({ min: 5, max: 16383 });
    expect(numbers.sheets[0]!.colCount).toBe(14);
  });
});

describe("generated fixtures", () => {
  it("basic: types, hidden sheet, hidden row/col", () => {
    const m = parse("generated/basic.xlsx", en);
    expect(m.sheets.map((s) => [s.name, s.state])).toEqual([
      ["Basic", "visible"],
      ["Hidden", "hidden"],
      ["한글 시트", "visible"],
    ]);
    const s = m.sheets[0]!;
    expect(s.cells[1]![3]).toMatchObject({ text: "TRUE", type: "boolean" });
    expect(s.cells[1]![4]!.text).toBe("2026-01-01");
    expect(s.rows[7]?.hidden).toBe(true);
    expect(s.cols.find((c) => c.min === 6)?.hidden).toBe(true);
    expect(m.warnings.map((w) => w.code)).toContain("FORMULA_WITHOUT_VALUE");
  });

  it("number formats", () => {
    const s = parse("generated/number-formats.xlsx").sheets[0]!;
    const shown = (r: number) => s.cells[r]![2]!.text;
    expect(shown(1)).toBe("1234567.891");
    expect(shown(6)).toBe("-1,234,567");
    expect(s.cells[7]![2]!.fmtColor).toBe("#FF0000");
    expect(shown(8)).toBe("26%");
    expect(shown(12)).toBe("₩15,000");
    expect(shown(14)).toBe("2026-10-28");
    expect(shown(16)).toBe("2026년 10월 28일");
    expect(shown(17)).toBe("수");
    expect(shown(21)).toBe("high");
  });

  it("borders keep every style", () => {
    const m = parse("generated/borders.xlsx");
    const s = m.sheets[0]!;
    const style = (r: number, c: number) => m.styles[s.cells[r]![c]!.styleId]!;
    expect(style(1, 2).border?.top?.style).toBe("thin");
    expect(style(11, 2).border?.left?.style).toBe("double");
    expect(style(3, 4).border?.diagonalUp?.color).toBe("#0070C0");
  });

  it("merges", () => {
    const s = parse("generated/merges.xlsx").sheets[0]!;
    expect(s.merges).toContainEqual({ r1: 0, c1: 0, r2: 0, c2: 3 });
    expect(s.merges).toContainEqual({ r1: 1, c1: 5, r2: 39, c2: 7 });
  });

  it("freeze panes and zoom", () => {
    const s = parse("generated/freeze.xlsx").sheets[0]!;
    expect(s.view).toMatchObject({ frozenRows: 1, frozenCols: 1, zoom: 125 });
  });

  it("notes and images", () => {
    const s = parse("generated/notes-images.xlsx").sheets[0]!;
    expect(s.notes).toHaveLength(2);
    expect(s.images).toHaveLength(1);
    expect(s.images[0]!.mime).toBe("image/png");
    expect(s.images[0]!.data.byteLength).toBeGreaterThan(100);
  });

  it("charts without caches resolve cell references", () => {
    const s = parse("generated/charts.xlsx").sheets[0]!;
    expect(s.charts.map((c) => c.kind)).toEqual(["bar", "bar", "bar", "line", "pie", "doughnut", "area", "scatter", "combo"]);
    const bar = s.charts[0]!;
    expect(bar.series.map((x) => x.name)).toEqual(["North", "South", "East"]);
    expect(bar.series[0]!.categories).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
    expect(bar.series[0]!.values.every((v) => typeof v === "number")).toBe(true);
    expect(s.charts[1]!.options.grouping).toBe("stacked");
    expect(s.charts[2]!.options).toMatchObject({ horizontal: true, grouping: "percentStacked" });
    expect(s.charts[8]!.series.find((x) => x.type === "line")?.secondary).toBe(true);
  });

  it("conditional formatting", () => {
    const m = parse("generated/conditional.xlsx");
    const cf = m.sheets[0]!.cf;
    expect(cf[1]![0]!.fill).toBe("#F8696B");
    expect(cf[10]![0]!.fill).toBe("#63BE7B");
    expect(cf[10]![1]!.dataBar?.to).toBeCloseTo(0.9);
    expect(cf[1]![2]!.icon).toMatchObject({ set: "3Arrows", index: 0 });
    expect(cf[10]![2]!.icon?.index).toBe(2);
    expect(cf[1]![3]!.fill).toBe("#FFC7CE");
    expect(cf[5]![3]!.font?.bold).toBe(true);
    expect(cf[1]![3]!.font?.color).toBe("#9C0006");
    expect(cf[1]![5]!.fill).toBe("#FFC7CE");
    expect(cf[3]?.[5]).toBeUndefined();
    expect(m.warnings.map((w) => w.code)).toContain("CF_RULE_UNSUPPORTED");
  });
});

describe("edge cases", () => {
  const one = (xml: string, extra?: Record<string, string>) => parseXlsxBuffer(miniXlsx(xml, extra), { locale: en }).model.sheets[0]!;

  it("handles cells without addresses", () => {
    const s = one(`<row><c t="inlineStr"><is><t>a</t></is></c><c><v>2</v></c></row><row><c t="inlineStr"><is><t>b</t></is></c></row>`);
    expect(s.cells[0]![0]!.text).toBe("a");
    expect(s.cells[0]![1]!.text).toBe("2");
    expect(s.cells[1]![0]!.text).toBe("b");
  });

  it("skips phonetic runs and decodes escapes", () => {
    const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh></si><si><t>a_x000D_b</t></si></sst>`;
    const data = miniXlsx(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`, {
      "xl/sharedStrings.xml": sst,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    });
    const s = parseXlsxBuffer(data).model.sheets[0]!;
    expect(s.cells[0]![0]!.text).toBe("漢字");
    expect(s.cells[0]![1]!.text).toBe("a\rb");
  });

  it("reads booleans, errors and ISO dates", () => {
    const s = one(
      `<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="e"><v>#DIV/0!</v></c><c r="C1" t="d"><v>2026-10-28T00:00:00</v></c></row>`,
    );
    expect(s.cells[0]![0]!.text).toBe("TRUE");
    expect(s.cells[0]![1]!.text).toBe("#DIV/0!");
    expect(s.cells[0]![2]!.value).toBe(46323);
  });

  it("rejects non-xlsx input", () => {
    expect(() => parseXlsxBuffer(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(InvalidFileError);
    expect(() => parseXlsxBuffer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(UnsupportedFormatError);
    expect(() => parseXlsxBuffer(zipSync({ "a.txt": strToU8("x") }))).toThrow(InvalidFileError);
  });

  it("enforces size limits", () => {
    const data = miniXlsx(`<row r="1"><c r="A1"><v>1</v></c></row>`);
    expect(() => parseXlsxBuffer(data, { maxFileSize: 10 })).toThrow(FileTooLargeError);
    const bomb = miniXlsx("", { "xl/padding.bin": "0".repeat(100_000) });
    expect(() => parseXlsxBuffer(bomb, { maxUncompressedSize: 50_000 })).toThrow(FileTooLargeError);
  });

  it("enforces the cell limit", () => {
    const rows = Array.from({ length: 20 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join("");
    expect(() => parseXlsxBuffer(miniXlsx(rows), { maxCells: 10 })).toThrow(ParseError);
  });

  it("refuses DTDs", () => {
    const data = miniXlsx("", {
      "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`,
    });
    expect(() => parseXlsxBuffer(data)).toThrow();
  });

  it("detects Strict OOXML", () => {
    const data = miniXlsx("", {
      "xl/workbook.xml": `<workbook xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main"><sheets/></workbook>`,
    });
    expect(() => parseXlsxBuffer(data)).toThrow(UnsupportedFormatError);
  });
});

describe.skipIf(!hasSales)("chart data sources", () => {
  const rewrite = (fn: (xml: string) => string) => {
    const files = unzipSync(fixture("excel/sales-report.xlsx"));
    for (const name of Object.keys(files)) {
      if (name.startsWith("xl/charts/chart")) files[name] = strToU8(fn(strFromU8(files[name]!)));
    }
    return parseXlsxBuffer(zipSync(files), { locale: ko }).model.sheets[0]!.charts;
  };
  const values = (charts: WorkbookModel["sheets"][number]["charts"]) => charts.map((c) => c.series.map((s) => s.values));
  const original = hasSales ? values(parse("excel/sales-report.xlsx").sheets[0]!.charts) : [];

  it("gives the same series without caches (references only)", () => {
    expect(values(rewrite((x) => x.replace(/<c:(numCache|strCache)>[\s\S]*?<\/c:\1>/g, "")))).toEqual(original);
  });

  it("falls back to caches when references can't be resolved", () => {
    expect(values(rewrite((x) => x.replace(/매출현황!/g, "[1]Other!")))).toEqual(original);
  });
});

describe("review regressions", () => {
  it("leaves shared-string cells without a value empty", () => {
    const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>FIRST</t></si></sst>`;
    const data = miniXlsx(`<row r="1"><c r="A1" t="s"/><c r="B1" t="s"><v></v></c></row>`, {
      "xl/sharedStrings.xml": sst,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    });
    const s = parseXlsxBuffer(data).model.sheets[0]!;
    expect(s.cells[0]?.[0]?.text ?? "").toBe("");
    expect(s.cells[0]?.[1]?.text ?? "").toBe("");
  });

  it("formats ISO dates in 1904 workbooks", () => {
    const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
    const data = miniXlsx(
      `<row r="1"><c r="A1" s="1" t="d"><v>2024-01-01T00:00:00</v></c></row>`,
      {
        "xl/styles.xml": styles,
        "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      },
      "",
    );
    const patched = unzipSync(data);
    patched["xl/workbook.xml"] = strToU8(strFromU8(patched["xl/workbook.xml"]!).replace("<sheets>", '<workbookPr date1904="1"/><sheets>'));
    const s = parseXlsxBuffer(zipSync(patched), { locale: en }).model.sheets[0]!;
    expect(s.cells[0]![0]!.text).toBe("1/1/2024");
  });

  it("finds anchors wrapped in mc:AlternateContent", async () => {
    const { parseDrawing } = await import("../src/parser/drawing");
    const { parseXmlTree } = await import("../src/parser/xml");
    const xml = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:AlternateContent><mc:Choice Requires="cx1"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"/></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></mc:Choice></mc:AlternateContent></xdr:wsDr>`;
    expect(parseDrawing(parseXmlTree(xml), theme).map((d) => d.kind)).toEqual(["unsupportedChart"]);
  });

  it("flattens nested groups into frames of the anchor box", async () => {
    const { parseDrawing } = await import("../src/parser/drawing");
    const { parseXmlTree } = await import("../src/parser/xml");
    const grp = (off: string, ext: string, chOff: string, chExt: string, inner: string) =>
      `<xdr:grpSp><xdr:nvGrpSpPr/><xdr:grpSpPr><a:xfrm><a:off ${off}/><a:ext ${ext}/><a:chOff ${chOff}/><a:chExt ${chExt}/></a:xfrm></xdr:grpSpPr>${inner}</xdr:grpSp>`;
    const pic = `<xdr:pic><xdr:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="500" cy="1000"/></a:xfrm></xdr:spPr></xdr:pic>`;
    const sp = `<xdr:sp><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"/><a:t>hi</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;
    // Root child space is 2000x4000; the inner group maps its 1000x1000 child space onto 1000..2000 x 2000..3000.
    const inner = grp('x="1000" y="2000"', 'cx="1000" cy="1000"', 'x="0" y="0"', 'cx="1000" cy="1000"', sp);
    const xml = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${grp('x="0" y="0"', 'cx="2000" cy="4000"', 'x="0" y="0"', 'cx="2000" cy="4000"', pic + inner)}<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
    const items = parseDrawing(parseXmlTree(xml), theme);
    expect(items.map((i) => i.kind)).toEqual(["image", "shape"]);
    const [image, shape] = items;
    expect(image).toMatchObject({ frame: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, z: 0 });
    expect(shape).toMatchObject({ shape: { frame: { x: 0.5, y: 0.5, w: 0.5, h: 0.25 }, fill: "#FF0000", z: 1 } });
    expect(shape!.kind === "shape" && shape!.shape.paragraphs[0]!.runs[0]).toMatchObject({ text: "hi" });
  });
});
