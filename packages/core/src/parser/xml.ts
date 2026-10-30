import { ParseError } from "../errors.js";
import { scanXml } from "./xml-scan.js";

export const NS = {
  main: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  pkgRel: "http://schemas.openxmlformats.org/package/2006/relationships",
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  x14: "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
  xm: "http://schemas.microsoft.com/office/excel/2006/main",
  tc: "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
} as const;

export const STRICT_PREFIX = "http://purl.oclc.org/ooxml/";

export interface XmlElement {
  uri: string;
  local: string;
  /** Plain attributes by local name; relationship attributes as `r:<local>`. */
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export interface StreamHandlers {
  open(uri: string, local: string, attrs: Record<string, string>): void;
  close(uri: string, local: string): void;
  text?(text: string): void;
}

const decoder8 = new TextDecoder("utf-8");

export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return decoder8.decode(bytes);
}

export class StrictOoxmlError extends Error {}

/** Event-based parse. Used for every part; worksheets can be tens of MB. */
export function streamXml(xml: string, handlers: StreamHandlers): void {
  scanXml(xml, handlers, (uri) => {
    if (uri.startsWith(STRICT_PREFIX)) throw new StrictOoxmlError("Strict OOXML");
  });
}

/** Builds a small element tree. Use for parts that are always small. */
export function parseXmlTree(xml: string): XmlElement {
  const root: XmlElement = { uri: "", local: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  streamXml(xml, {
    open(uri, local, attrs) {
      const el: XmlElement = { uri, local, attrs, children: [], text: "" };
      stack[stack.length - 1]!.children.push(el);
      stack.push(el);
    },
    close() {
      stack.pop();
    },
    text(t) {
      stack[stack.length - 1]!.text += t;
    },
  });
  const top = root.children[0];
  if (!top) throw new ParseError("Empty XML document");
  return top;
}

export function child(el: XmlElement | undefined, local: string, uri?: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (c.local === local && (uri === undefined || c.uri === uri)) return c;
  return undefined;
}

export function children(el: XmlElement | undefined, local: string, uri?: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((c) => c.local === local && (uri === undefined || c.uri === uri));
}

/** Depth-first path lookup: path("a/b/c"). */
export function path(el: XmlElement | undefined, p: string, uri?: string): XmlElement | undefined {
  let cur = el;
  for (const part of p.split("/")) {
    cur = child(cur, part, uri);
    if (!cur) return undefined;
  }
  return cur;
}

export function descendants(el: XmlElement, local: string, uri?: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.local === local && (uri === undefined || c.uri === uri)) out.push(c);
    descendants(c, local, uri, out);
  }
  return out;
}

export function attrNum(el: XmlElement | undefined, name: string): number | undefined {
  const v = el?.attrs[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** OOXML booleans: "1"/"true" are true, absent uses the default. */
export function attrBool(el: XmlElement | undefined, name: string, def: boolean): boolean {
  const v = el?.attrs[name];
  if (v === undefined) return def;
  return v === "1" || v === "true";
}

export function boolValue(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === "1" || v === "true";
}

/** Decodes `_xHHHH_` escapes used in shared strings and inline strings. */
export function unescapeOoxml(s: string): string {
  if (s.indexOf("_x") < 0) return s;
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
