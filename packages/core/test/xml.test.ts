import { describe, expect, it } from "vitest";
import { ParseError } from "../src/errors";
import { decodeEntities, scanXml } from "../src/parser/xml-scan";
import { parseXmlTree } from "../src/parser/xml";

function events(xml: string): string[] {
  const out: string[] = [];
  scanXml(xml, {
    open: (uri, local, attrs) => out.push(`open ${uri}|${local} ${JSON.stringify(attrs)}`),
    close: (uri, local) => out.push(`close ${uri}|${local}`),
    text: (t) => out.push(`text ${JSON.stringify(t)}`),
  });
  return out;
}

describe("scanXml", () => {
  it("resolves default and prefixed namespaces", () => {
    const a = events(`<x:a xmlns:x="urn:x"><x:b/></x:a>`);
    const b = events(`<a xmlns="urn:x"><b/></a>`);
    expect(a.map((e) => e.replace(/ \{.*\}/, ""))).toEqual(b.map((e) => e.replace(/ \{.*\}/, "")));
    expect(a[1]).toBe("open urn:x|b {}");
  });

  it("scopes namespace declarations", () => {
    const e = events(`<a xmlns="urn:1"><b xmlns="urn:2"><c/></b><d/></a>`);
    expect(e.filter((x) => x.startsWith("open")).map((x) => x.split(" ")[1])).toEqual(["urn:1|a", "urn:2|b", "urn:2|c", "urn:1|d"]);
  });

  it("maps relationship attributes to r:<local>", () => {
    const e = events(`<a xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships" rel:id="rId1" name="x"/>`);
    expect(e[0]).toBe(`open |a {"name":"x","r:id":"rId1"}`);
  });

  it("decodes entities, CDATA and line endings", () => {
    const e = events(`<a t="&lt;&#x41;&amp;">x&amp;y<![CDATA[<raw>]]>1\r\n2&#13;</a>`);
    expect(e).toEqual([`open |a {"t":"<A&"}`, `text "x&y"`, `text "<raw>"`, `text "1\\n2\\r"`, `close |a`]);
  });

  it("skips comments and processing instructions", () => {
    expect(events(`<?xml version="1.0"?><!-- c --><a/>`)).toEqual([`open |a {}`, `close |a`]);
  });

  it("rejects DTDs and malformed input", () => {
    expect(() => events(`<!DOCTYPE a><a/>`)).toThrow(ParseError);
    expect(() => events(`<a><b></a>`)).toThrow(ParseError);
    expect(() => events(`<a>`)).toThrow(ParseError);
    expect(() => events(`<a b=c/>`)).toThrow(ParseError);
    expect(() => events(`<p:a/>`)).toThrow(ParseError);
  });

  it("keeps attribute values containing > and /", () => {
    expect(events(`<a href="x/>y"/>`)[0]).toBe(`open |a {"href":"x/>y"}`);
  });

  it("builds trees", () => {
    const t = parseXmlTree(`<a xmlns="urn:x"><b k="1">hi</b></a>`);
    expect(t.local).toBe("a");
    expect(t.children[0]).toMatchObject({ local: "b", uri: "urn:x", attrs: { k: "1" }, text: "hi" });
  });

  it("leaves unknown entities alone", () => {
    expect(decodeEntities("&nbsp;&amp;")).toBe("&nbsp;&");
  });
});
