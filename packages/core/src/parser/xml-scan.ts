import { ParseError } from "../errors.js";

/**
 * Minimal non-validating XML tokenizer, several times faster than a general
 * SAX parser on large worksheets. Namespace-aware; never processes DTDs.
 */
export interface ScanHandlers {
  open(uri: string, local: string, attrs: Record<string, string>): void;
  close(uri: string, local: string): void;
  text?(text: string): void;
}

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

interface Scope {
  depth: number;
  map: Map<string, string>;
}

interface Name {
  qname: string;
  uri: string;
  local: string;
}

/** `onRoot` receives the namespace of the document element. */
export function scanXml(xml: string, h: ScanHandlers, onRoot?: (uri: string) => void): void {
  const n = xml.length;
  const text = h.text;
  let i = 0;
  let depth = 0;
  const scopes: Scope[] = [{ depth: -1, map: new Map([["xml", XML_NS]]) }];
  let ns = scopes[0]!.map;
  // qname -> resolved name, valid until the namespace scope changes.
  let names = new Map<string, Name>();
  const stack: Name[] = [];

  const nameOf = (qname: string): Name => {
    let v = names.get(qname);
    if (v) return v;
    const colon = qname.indexOf(":");
    const prefix = colon < 0 ? "" : qname.slice(0, colon);
    const uri = ns.get(prefix);
    if (uri === undefined && prefix !== "") throw new ParseError(`Unbound namespace prefix "${prefix}"`);
    v = { qname, uri: uri ?? "", local: colon < 0 ? qname : qname.slice(colon + 1) };
    names.set(qname, v);
    return v;
  };
  const popScope = () => {
    if (scopes[scopes.length - 1]!.depth === depth) {
      scopes.pop();
      ns = scopes[scopes.length - 1]!.map;
      names = new Map();
    }
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      if (text && i < n) emitText(xml.slice(i), text);
      break;
    }
    if (lt > i && text) emitText(xml.slice(i, lt), text);
    const c = xml.charCodeAt(lt + 1);

    if (c === 47 /* / */) {
      const top = stack.pop();
      if (!top || !xml.startsWith(top.qname, lt + 2)) throw new ParseError("Mismatched closing tag");
      let p = lt + 2 + top.qname.length;
      while (isSpace(xml.charCodeAt(p))) p++;
      if (xml.charCodeAt(p) !== 62) throw new ParseError("Mismatched closing tag");
      depth--;
      h.close(top.uri, top.local);
      popScope();
      i = p + 1;
      continue;
    }
    if (c === 63 /* ? */) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new ParseError("Unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (c === 33 /* ! */) {
      if (xml.startsWith("<!--", lt)) {
        const end = xml.indexOf("-->", lt + 4);
        if (end < 0) throw new ParseError("Unterminated comment");
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", lt)) {
        const end = xml.indexOf("]]>", lt + 9);
        if (end < 0) throw new ParseError("Unterminated CDATA section");
        if (text) text(xml.slice(lt + 9, end).replace(/\r\n?/g, "\n"));
        i = end + 3;
        continue;
      }
      throw new ParseError("DTD is not allowed");
    }

    // Start tag: name, then attributes up to `>` or `/>`.
    let p = lt + 1;
    for (;;) {
      const ch = xml.charCodeAt(p);
      if (ch === 62 || ch === 47 || isSpace(ch) || p >= n) break;
      p++;
    }
    const qname = xml.slice(lt + 1, p);
    const attrs: Record<string, string> = {};
    let prefixed: string[] | undefined;
    let declared: string[] | undefined;
    let selfClose = false;
    for (;;) {
      while (isSpace(xml.charCodeAt(p))) p++;
      const ch = xml.charCodeAt(p);
      if (ch === 62) break;
      if (ch === 47 && xml.charCodeAt(p + 1) === 62) {
        selfClose = true;
        p++;
        break;
      }
      if (p >= n) throw new ParseError("Unterminated tag");
      const eq = xml.indexOf("=", p);
      if (eq < 0) throw new ParseError("Malformed attribute");
      let ne = eq;
      while (ne > p && isSpace(xml.charCodeAt(ne - 1))) ne--;
      const name = xml.slice(p, ne);
      let q = eq + 1;
      while (isSpace(xml.charCodeAt(q))) q++;
      const quote = xml.charCodeAt(q);
      if (quote !== 34 && quote !== 39) throw new ParseError("Unquoted attribute value");
      const close = xml.indexOf(quote === 34 ? '"' : "'", q + 1);
      if (close < 0) throw new ParseError("Unterminated attribute value");
      let value = xml.slice(q + 1, close);
      if (value.indexOf("&") >= 0) value = decodeEntities(value);
      p = close + 1;
      if (name.indexOf(":") < 0) {
        if (name === "xmlns") (declared ??= []).push("", value);
        else attrs[name] = value;
      } else if (name.startsWith("xmlns:")) (declared ??= []).push(name.slice(6), value);
      else (prefixed ??= []).push(name, value);
    }

    if (declared) {
      const map = new Map(ns);
      for (let k = 0; k < declared.length; k += 2) map.set(declared[k]!, declared[k + 1]!);
      scopes.push({ depth, map });
      ns = map;
      names = new Map();
    }
    if (prefixed) {
      for (let k = 0; k < prefixed.length; k += 2) {
        const name = prefixed[k]!;
        const ac = name.indexOf(":");
        const aLocal = name.slice(ac + 1);
        if (ns.get(name.slice(0, ac)) === REL_NS) attrs["r:" + aLocal] = prefixed[k + 1]!;
        else if (!(aLocal in attrs)) attrs[aLocal] = prefixed[k + 1]!;
      }
    }

    const el = nameOf(qname);
    if (depth === 0 && onRoot) onRoot(el.uri);
    h.open(el.uri, el.local, attrs);
    if (selfClose) {
      h.close(el.uri, el.local);
      popScope();
    } else {
      stack.push(el);
      depth++;
    }
    i = p + 1;
  }
  if (stack.length) throw new ParseError(`Unclosed element <${stack[stack.length - 1]!.qname}>`);
}

function isSpace(c: number): boolean {
  return c === 32 || c === 10 || c === 13 || c === 9;
}

function emitText(raw: string, text: (t: string) => void): void {
  // XML 1.0 end-of-line handling; character references like &#13; survive.
  const t = raw.indexOf("\r") >= 0 ? raw.replace(/\r\n?/g, "\n") : raw;
  text(t.indexOf("&") >= 0 ? decodeEntities(t) : t);
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent.charCodeAt(0) === 35) {
      const code = ent.charCodeAt(1) === 120 ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[ent] ?? m;
  });
}
