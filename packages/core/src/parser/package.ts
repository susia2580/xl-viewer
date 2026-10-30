import { InvalidFileError, UnsupportedFormatError } from "../errors.js";
import { decodeXml, parseXmlTree, StrictOoxmlError, type XmlElement } from "./xml.js";
import { normalizePath, type ZipEntries } from "./zip.js";

export interface Relationship {
  id: string;
  type: string;
  /** Normalized part path, or the raw target for external links. */
  target: string;
  external: boolean;
}

export const REL = {
  officeDocument: "/officeDocument",
  worksheet: "/worksheet",
  sharedStrings: "/sharedStrings",
  styles: "/styles",
  theme: "/theme",
  comments: "/comments",
  vmlDrawing: "/vmlDrawing",
  drawing: "/drawing",
  chart: "/chart",
  image: "/image",
  threadedComment: "/threadedComment",
  person: "/person",
} as const;

/** Relationship types differ between transitional, strict and MS extensions; match by suffix. */
export function relIs(rel: Relationship, suffix: string): boolean {
  return rel.type.toLowerCase().endsWith(suffix.toLowerCase());
}

/** Read-only view over the unzipped package. */
export class OpcPackage {
  constructor(private readonly entries: ZipEntries) {}

  has(path: string): boolean {
    return this.entries.has(normalizePath(path));
  }

  bytes(path: string): Uint8Array | undefined {
    return this.entries.get(normalizePath(path));
  }

  text(path: string): string | undefined {
    const b = this.bytes(path);
    return b ? decodeXml(b) : undefined;
  }

  xml(path: string): XmlElement | undefined {
    const t = this.text(path);
    if (t === undefined) return undefined;
    try {
      return parseXmlTree(t);
    } catch (err) {
      if (err instanceof StrictOoxmlError) throw new UnsupportedFormatError("Strict OOXML files are not supported");
      throw err;
    }
  }

  rels(partPath: string): Relationship[] {
    const relsPath = relsPathFor(partPath);
    const root = this.xml(relsPath);
    if (!root) return [];
    const base = dirname(normalizePath(partPath));
    const out: Relationship[] = [];
    for (const r of root.children) {
      if (r.local !== "Relationship") continue;
      const external = r.attrs.TargetMode === "External";
      const target = r.attrs.Target ?? "";
      out.push({
        id: r.attrs.Id ?? "",
        type: r.attrs.Type ?? "",
        target: external ? target : resolvePath(base, target),
        external,
      });
    }
    return out;
  }
}

export function validatePackage(pkg: OpcPackage): void {
  if (!pkg.has("[Content_Types].xml") || !pkg.has("_rels/.rels")) {
    throw new InvalidFileError("Missing [Content_Types].xml or _rels/.rels");
  }
}

export function relsPathFor(partPath: string): string {
  const p = normalizePath(partPath);
  if (p === "") return "_rels/.rels";
  const dir = dirname(p);
  const file = p.slice(dir.length ? dir.length + 1 : 0);
  return (dir ? dir + "/" : "") + "_rels/" + file + ".rels";
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function resolvePath(baseDir: string, target: string): string {
  const t = target.replace(/\\/g, "/");
  const parts = t.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of t.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return normalizePath(parts.join("/"));
}
