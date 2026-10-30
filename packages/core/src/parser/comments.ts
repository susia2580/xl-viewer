import type { ColorContext } from "../format/color.js";
import { parseCellRef } from "../format/address.js";
import { cssLengthToPx } from "../format/units.js";
import type { NoteModel, ThreadReply } from "../model/types.js";
import { RichTextCollector } from "./shared-strings.js";
import type { ThemeModel } from "./theme.js";
import { NS, streamXml, unescapeOoxml } from "./xml.js";

export function parseComments(xml: string, colors: ColorContext, theme: ThemeModel): NoteModel[] {
  const authors: string[] = [];
  const notes: NoteModel[] = [];
  const rt = new RichTextCollector(colors, theme);
  let inAuthor = false;
  let author = "";
  let current: { row: number; col: number; author?: string } | undefined;
  let inText = false;

  streamXml(xml, {
    open(uri, local, a) {
      if (inText) {
        rt.open(uri, local, a);
        return;
      }
      if (uri !== NS.main) return;
      if (local === "author") {
        inAuthor = true;
        author = "";
      } else if (local === "comment") {
        const ref = a.ref ? parseCellRef(a.ref.split(":")[0]!) : null;
        current = ref ? { row: ref.row, col: ref.col } : undefined;
        const name = authors[Number(a.authorId)];
        if (current && name) current.author = name;
      } else if (local === "text" && current) {
        inText = true;
        rt.reset();
      }
    },
    close(uri, local) {
      if (inText) {
        if (uri === NS.main && local === "text") {
          inText = false;
          const s = rt.result();
          if (current) {
            const note: NoteModel = {
              row: current.row,
              col: current.col,
              rich: s.rich ?? [{ text: s.text }],
              alwaysVisible: false,
            };
            if (current.author) note.author = current.author;
            notes.push(note);
          }
        } else rt.close(uri, local);
        return;
      }
      if (uri === NS.main && local === "author") {
        inAuthor = false;
        authors.push(unescapeOoxml(author));
      }
    },
    text(t) {
      if (inText) rt.onText(t);
      else if (inAuthor) author += t;
    },
  });
  return notes;
}

interface VmlShape {
  row: number;
  col: number;
  visible: boolean;
  width?: number;
  height?: number;
  fill?: string;
  border?: string;
  /** Top-left of the box: column, px offset, row, px offset. */
  from?: { col: number; dx: number; row: number; dy: number };
}

/**
 * VML is often not well-formed XML (unclosed <br>), so it is scanned with
 * regular expressions instead of a parser. Only note shapes are read.
 */
export function parseVmlNotes(vml: string): VmlShape[] {
  const out: VmlShape[] = [];
  const shapeRe = /<v:shape\b([^>]*)>([\s\S]*?)<\/v:shape>/gi;
  for (let m = shapeRe.exec(vml); m; m = shapeRe.exec(vml)) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    if (!/ObjectType\s*=\s*["']Note["']/i.test(body)) continue;
    const row = /<x:Row>\s*(\d+)\s*<\/x:Row>/i.exec(body);
    const col = /<x:Column>\s*(\d+)\s*<\/x:Column>/i.exec(body);
    if (!row || !col) continue;
    const style = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs)?.[2] ?? "";
    const css = parseInlineCss(style);
    const hiddenByStyle = css.visibility === "hidden";
    const visibleTag = /<x:Visible\s*\/?>(?!\s*false)/i.test(body);
    const shape: VmlShape = {
      row: Number(row[1]),
      col: Number(col[1]),
      visible: visibleTag || (!hiddenByStyle && css.visibility === "visible"),
    };
    const fill = /\bfillcolor\s*=\s*["'](#[0-9a-f]{6})/i.exec(attrs)?.[1];
    if (fill) shape.fill = fill.toUpperCase();
    const stroke = /\bstrokecolor\s*=\s*["'](#[0-9a-f]{6})/i.exec(attrs)?.[1];
    if (stroke) shape.border = stroke.toUpperCase();
    const anchor = /<x:Anchor>([\s\S]*?)<\/x:Anchor>/i
      .exec(body)?.[1]
      ?.split(",")
      .map((v) => Number(v.trim()));
    if (anchor && anchor.length >= 4 && anchor.every((v) => Number.isFinite(v))) {
      shape.from = { col: anchor[0]!, dx: anchor[1]!, row: anchor[2]!, dy: anchor[3]! };
    }
    const w = css.width ? cssLengthToPx(css.width) : undefined;
    const h = css.height ? cssLengthToPx(css.height) : undefined;
    if (w && h) {
      shape.width = Math.round(w);
      shape.height = Math.round(h);
    }
    out.push(shape);
  }
  return out;
}

function parseInlineCss(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

export function applyVml(notes: NoteModel[], shapes: VmlShape[]): void {
  const byCell = new Map<string, VmlShape>();
  for (const s of shapes) byCell.set(s.row + ":" + s.col, s);
  for (const n of notes) {
    const s = byCell.get(n.row + ":" + n.col);
    if (!s) continue;
    n.alwaysVisible = s.visible;
    if (s.width && s.height) n.box = { width: s.width, height: s.height };
    if (s.fill) n.fill = s.fill;
    if (s.border) n.border = s.border;
    if (s.from) n.from = s.from;
  }
}

export function parsePersons(xml: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  streamXml(xml, {
    open(_uri, local, a) {
      if (local === "person" && a.id) out.set(a.id, a.displayName ?? "");
    },
    close() {},
  });
  return out;
}

/** Threaded comments (Microsoft 365). Replies are grouped under their root by cell. */
export function parseThreadedComments(xml: string, persons: Map<string, string>): Map<string, ThreadReply[]> {
  const out = new Map<string, ThreadReply[]>();
  let current: { ref: string; reply: ThreadReply } | undefined;
  let inText = false;
  let text = "";
  streamXml(xml, {
    open(uri, local, a) {
      if (uri !== NS.tc) return;
      if (local === "threadedComment") {
        const ref = a.ref ? parseCellRef(a.ref) : null;
        if (!ref) return;
        const reply: ThreadReply = { author: persons.get(a.personId ?? "") ?? "", text: "" };
        if (a.dT) reply.date = a.dT;
        current = { ref: ref.row + ":" + ref.col, reply };
      } else if (local === "text") {
        inText = true;
        text = "";
      }
    },
    close(uri, local) {
      if (uri !== NS.tc) return;
      if (local === "text") inText = false;
      else if (local === "threadedComment" && current) {
        current.reply.text = text;
        const list = out.get(current.ref) ?? [];
        list.push(current.reply);
        out.set(current.ref, list);
        current = undefined;
      }
    },
    text(t) {
      if (inText) text += t;
    },
  });
  return out;
}
