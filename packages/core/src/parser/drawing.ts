import { fontFamily } from "../format/fonts.js";
import { emuToPx } from "../format/units.js";
import type { Anchor, Frame, ShapeModel, ShapeParagraph, ShapeRun } from "../model/types.js";
import { drawingColor, lineStyle, solidFill } from "./drawingml.js";
import type { ThemeModel } from "./theme.js";
import { attrNum, child, descendants, NS, type XmlElement } from "./xml.js";

export type DrawingItem =
  | { kind: "image"; anchor: Anchor; relId: string; frame?: Frame; z: number }
  | { kind: "chart"; anchor: Anchor; relId: string; z: number }
  | { kind: "unsupportedChart"; anchor: Anchor; z: number }
  | { kind: "shape"; shape: ShapeModel };

const CHART_URI = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const CHARTEX_URI = "http://schemas.microsoft.com/office/drawing/2014/chartex";

function marker(el: XmlElement | undefined): Anchor["from"] | undefined {
  if (!el) return undefined;
  const n = (name: string) => Number(child(el, name, NS.xdr)?.text.trim() ?? 0) || 0;
  return { col: n("col"), row: n("row"), dx: emuToPx(n("colOff")), dy: emuToPx(n("rowOff")) };
}

function readAnchor(el: XmlElement): Anchor | undefined {
  const ext = child(el, "ext", NS.xdr);
  const width = emuToPx(attrNum(ext, "cx") ?? 0);
  const height = emuToPx(attrNum(ext, "cy") ?? 0);
  if (el.local === "twoCellAnchor") {
    const from = marker(child(el, "from", NS.xdr));
    const to = marker(child(el, "to", NS.xdr));
    if (!from || !to) return undefined;
    return { from, to, width: 0, height: 0 };
  }
  if (el.local === "oneCellAnchor") {
    const from = marker(child(el, "from", NS.xdr));
    if (!from) return undefined;
    return { from, width, height };
  }
  if (el.local === "absoluteAnchor") {
    const pos = child(el, "pos", NS.xdr);
    return {
      from: { row: 0, col: 0, dx: 0, dy: 0 },
      width,
      height,
      x: emuToPx(attrNum(pos, "x") ?? 0),
      y: emuToPx(attrNum(pos, "y") ?? 0),
    };
  }
  return undefined;
}

/** Content may be wrapped in mc:AlternateContent; prefer the Choice branch. */
function contentOf(anchorEl: XmlElement): XmlElement | undefined {
  for (const c of anchorEl.children) {
    if (
      c.uri === NS.xdr &&
      (c.local === "pic" || c.local === "graphicFrame" || c.local === "sp" || c.local === "grpSp" || c.local === "cxnSp")
    ) {
      return c;
    }
    if (c.uri === NS.mc && c.local === "AlternateContent") {
      const choice = c.children.find((x) => x.local === "Choice") ?? c.children.find((x) => x.local === "Fallback");
      const inner = choice?.children.find((x) => x.uri === NS.xdr);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** Anchors, including ones wrapped whole in mc:AlternateContent (chartex charts). */
function anchors(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const el of root.children) {
    if (el.uri === NS.xdr) out.push(el);
    else if (el.uri === NS.mc && el.local === "AlternateContent") {
      const branch = el.children.find((x) => x.local === "Choice") ?? el.children.find((x) => x.local === "Fallback");
      for (const inner of branch?.children ?? []) if (inner.uri === NS.xdr) out.push(inner);
    }
  }
  return out;
}

/** x_fraction = a * x + b, for the child space of the group being walked. */
interface Axis {
  a: number;
  b: number;
}
interface Mapping {
  x: Axis;
  y: Axis;
}

const PX_PER_PT = 96 / 72;
const MAX_GROUP_DEPTH = 16;

function xfrm(el: XmlElement): XmlElement | undefined {
  return child(child(el, "grpSpPr", NS.xdr) ?? child(el, "spPr", NS.xdr), "xfrm", NS.a);
}

function pair(el: XmlElement | undefined, name: string, a: string, b: string): [number, number] | undefined {
  const e = child(el, name, NS.a);
  const x = attrNum(e, a);
  const y = attrNum(e, b);
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** Child space of a group -> fractions of the root group's box. */
function nest(parent: Mapping | undefined, group: XmlElement): Mapping | undefined {
  const t = xfrm(group);
  const off = pair(t, "off", "x", "y");
  const ext = pair(t, "ext", "cx", "cy");
  const chOff = pair(t, "chOff", "x", "y") ?? off;
  const chExt = pair(t, "chExt", "cx", "cy") ?? ext;
  if (!off || !ext || !chOff || !chExt || chExt[0] <= 0 || chExt[1] <= 0 || ext[0] <= 0 || ext[1] <= 0) return undefined;
  if (!parent) {
    // The root group's own box is the anchor box.
    return {
      x: { a: 1 / chExt[0], b: -chOff[0] / chExt[0] },
      y: { a: 1 / chExt[1], b: -chOff[1] / chExt[1] },
    };
  }
  const axis = (p: Axis, o: number, e: number, co: number, ce: number): Axis => {
    const a = (p.a * e) / ce;
    return { a, b: p.a * o - a * co + p.b };
  };
  return {
    x: axis(parent.x, off[0], ext[0], chOff[0], chExt[0]),
    y: axis(parent.y, off[1], ext[1], chOff[1], chExt[1]),
  };
}

function frameOf(el: XmlElement, m: Mapping | undefined): Frame | undefined {
  if (!m) return undefined;
  const t = xfrm(el);
  const off = pair(t, "off", "x", "y");
  const ext = pair(t, "ext", "cx", "cy");
  if (!off || !ext) return undefined;
  return {
    x: m.x.a * off[0] + m.x.b,
    y: m.y.a * off[1] + m.y.b,
    w: m.x.a * ext[0],
    h: m.y.a * ext[1],
  };
}

function runStyle(
  base: XmlElement | undefined,
  rPr: XmlElement | undefined,
  fallbackColor: string | undefined,
  theme: ThemeModel,
): Omit<ShapeRun, "text"> {
  const attr = (name: string) => rPr?.attrs[name] ?? base?.attrs[name];
  const fill = (rPr && child(rPr, "solidFill", NS.a)) ?? (base && child(base, "solidFill", NS.a));
  const face = (rPr && child(rPr, "latin", NS.a)) ?? (rPr && child(rPr, "ea", NS.a)) ?? (base && child(base, "latin", NS.a));
  const typeface = face?.attrs.typeface;
  const sz = Number(attr("sz"));
  const spc = Number(attr("spc"));
  const run: Omit<ShapeRun, "text"> = { size: (Number.isFinite(sz) && sz > 0 ? sz / 100 : 18) * PX_PER_PT };
  if (attr("b") === "1") run.bold = true;
  if (attr("i") === "1") run.italic = true;
  const u = attr("u");
  if (u && u !== "none") run.underline = true;
  const color = drawingColor(fill?.children[0], theme) ?? fallbackColor;
  if (color) run.color = color;
  if (typeface && !typeface.startsWith("+")) run.family = fontFamily(typeface, theme.minorFontHangul);
  if (Number.isFinite(spc) && spc !== 0) run.spacing = (spc / 100) * PX_PER_PT;
  const effects = (rPr && child(rPr, "effectLst", NS.a)) ?? (rPr && child(rPr, "effectDag", NS.a));
  if (effects && child(effects, "outerShdw", NS.a)) run.shadow = true;
  return run;
}

const ALIGN: Record<string, ShapeParagraph["align"]> = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" };

function readText(sp: XmlElement, theme: ThemeModel): ShapeParagraph[] {
  const body = child(sp, "txBody", NS.xdr);
  if (!body) return [];
  const lvl1 = child(child(body, "lstStyle", NS.a), "lvl1pPr", NS.a);
  const lvl1Def = child(lvl1, "defRPr", NS.a);
  const fontRef = child(child(sp, "style", NS.xdr), "fontRef", NS.a);
  const refColor = drawingColor(fontRef?.children[0], theme);
  const out: ShapeParagraph[] = [];
  for (const p of body.children) {
    if (p.uri !== NS.a || p.local !== "p") continue;
    const pPr = child(p, "pPr", NS.a);
    const lnSpc = child(child(pPr, "lnSpc", NS.a), "spcPct", NS.a);
    const pct = attrNum(lnSpc, "val");
    const para: ShapeParagraph = {
      align: ALIGN[pPr?.attrs.algn ?? lvl1?.attrs.algn ?? "l"] ?? "left",
      size: runStyle(lvl1Def, child(p, "endParaRPr", NS.a), refColor, theme).size,
      runs: [],
    };
    if (pct !== undefined && pct > 0) para.lineHeight = pct / 100000;
    const pDef = child(pPr, "defRPr", NS.a);
    for (const r of p.children) {
      if (r.uri !== NS.a) continue;
      if (r.local === "br") {
        para.runs.push({ ...runStyle(lvl1Def, child(r, "rPr", NS.a), refColor, theme), text: "\n" });
      } else if (r.local === "r" || r.local === "fld") {
        const text = child(r, "t", NS.a)?.text ?? "";
        if (text) para.runs.push({ ...runStyle(pDef ?? lvl1Def, child(r, "rPr", NS.a), refColor, theme), text });
      }
    }
    out.push(para);
  }
  return out;
}

const GEOMETRY: Record<string, ShapeModel["geometry"]> = { rect: "rect", roundRect: "roundRect", ellipse: "ellipse" };

function readShape(sp: XmlElement, anchor: Anchor, frame: Frame | undefined, z: number, theme: ThemeModel): ShapeModel | undefined {
  const spPr = child(sp, "spPr", NS.xdr);
  const style = child(sp, "style", NS.xdr);
  const prst = child(spPr, "prstGeom", NS.a)?.attrs.prst ?? "rect";
  const geometry = GEOMETRY[prst];
  // Other presets would be drawn as the wrong outline, so only their text is kept.
  let fill = geometry ? solidFill(spPr, theme) : null;
  if (fill === undefined && Number(child(style, "fillRef", NS.a)?.attrs.idx) > 0) {
    fill = drawingColor(child(style, "fillRef", NS.a)?.children[0], theme);
  }
  let line = geometry ? lineStyle(spPr, theme) : null;
  if (line === undefined && Number(child(style, "lnRef", NS.a)?.attrs.idx) > 0) {
    const color = drawingColor(child(style, "lnRef", NS.a)?.children[0], theme);
    line = color ? { color, width: 1 } : null;
  }
  const paragraphs = readText(sp, theme);
  if (!fill && !line && !paragraphs.some((p) => p.runs.length > 0)) return undefined;
  const bodyPr = child(child(sp, "txBody", NS.xdr), "bodyPr", NS.a);
  const inset = (name: string, def: number) => emuToPx(attrNum(bodyPr, name) ?? def);
  const anchorV = bodyPr?.attrs.anchor;
  return {
    anchor,
    ...(frame ? { frame } : {}),
    z,
    geometry: geometry ?? "rect",
    ...(fill ? { fill } : {}),
    ...(line ? { line } : {}),
    vAlign: anchorV === "ctr" ? "middle" : anchorV === "b" ? "bottom" : "top",
    insets: [inset("lIns", 91440), inset("tIns", 45720), inset("rIns", 91440), inset("bIns", 45720)],
    wrap: bodyPr?.attrs.wrap !== "none",
    paragraphs,
  };
}

export function parseDrawing(root: XmlElement, theme: ThemeModel): DrawingItem[] {
  const out: DrawingItem[] = [];
  let z = 0;

  const walk = (el: XmlElement, anchor: Anchor, m: Mapping | undefined, depth: number): void => {
    if (depth > MAX_GROUP_DEPTH) return;
    switch (el.local) {
      case "grpSp": {
        const inner = nest(m, el);
        if (!inner) return;
        for (const c of el.children) if (c.uri === NS.xdr) walk(c, anchor, inner, depth + 1);
        return;
      }
      case "pic": {
        const relId = descendants(el, "blip", NS.a)[0]?.attrs["r:embed"];
        if (relId) out.push({ kind: "image", anchor, relId, ...optionalFrame(frameOf(el, m)), z: z++ });
        return;
      }
      case "sp": {
        const shape = readShape(el, anchor, frameOf(el, m), z, theme);
        if (shape) {
          out.push({ kind: "shape", shape });
          z++;
        }
        return;
      }
      case "graphicFrame": {
        const data = descendants(el, "graphicData", NS.a)[0];
        const uri = data?.attrs.uri;
        if (uri === CHART_URI) {
          const relId = data?.children.find((c) => c.local === "chart")?.attrs["r:id"];
          if (relId) out.push({ kind: "chart", anchor, relId, z: z++ });
        } else if (uri === CHARTEX_URI) {
          out.push({ kind: "unsupportedChart", anchor, z: z++ });
        }
      }
    }
  };

  for (const el of anchors(root)) {
    const anchor = readAnchor(el);
    if (!anchor) continue;
    const content = contentOf(el);
    if (content) walk(content, anchor, undefined, 0);
  }
  return out;
}

function optionalFrame(frame: Frame | undefined): { frame?: Frame } {
  return frame ? { frame } : {};
}
