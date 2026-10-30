import type { NoteModel, SheetModel } from "../../model/types.js";
import type { Layout } from "../layout.js";
import { paneKindFor, type OverlayPanes } from "./panes.js";

const DEFAULT_W = 144;
const DEFAULT_H = 79;

export class NotesOverlay {
  private readonly byCell = new Map<string, NoteModel>();
  private hoverBox: HTMLDivElement | undefined;
  private hoverKey: string | undefined;
  private readonly pinned: HTMLDivElement[] = [];

  constructor(
    private readonly sheet: SheetModel,
    private readonly layout: Layout,
    private readonly panes: OverlayPanes,
  ) {
    for (const n of sheet.notes) this.byCell.set(n.row + ":" + n.col, n);
    for (const n of sheet.notes) if (n.alwaysVisible) this.pinned.push(this.mount(n));
  }

  /** Shows the note for the hovered cell; pass undefined to hide. */
  hover(row: number | undefined, col: number | undefined): void {
    let note: NoteModel | undefined;
    if (row !== undefined && col !== undefined) {
      const merge = this.layout.mergeCovering(row, col);
      note = merge ? this.findInMerge(merge.r1, merge.c1, merge.r2, merge.c2) : this.byCell.get(row + ":" + col);
    }
    const key = note ? note.row + ":" + note.col : undefined;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hoverBox?.remove();
    this.hoverBox = undefined;
    if (note && !note.alwaysVisible) this.hoverBox = this.mount(note);
  }

  private findInMerge(r1: number, c1: number, r2: number, c2: number): NoteModel | undefined {
    for (const n of this.sheet.notes) if (n.row >= r1 && n.row <= r2 && n.col >= c1 && n.col <= c2) return n;
    return undefined;
  }

  private mount(note: NoteModel): HTMLDivElement {
    const { layout } = this;
    const s = layout.scale;
    const box = document.createElement("div");
    box.className = "xv-note";
    box.setAttribute("role", "note");
    let x: number;
    let y: number;
    let paneRow = note.row;
    let paneCol = note.col;
    if (note.from) {
      x = layout.colLeft[Math.min(note.from.col, layout.cols)]! + note.from.dx * s;
      y = layout.rowTop[Math.min(note.from.row, layout.rows)]! + note.from.dy * s;
      paneRow = note.from.row;
      paneCol = note.from.col;
    } else {
      x = layout.colLeft[Math.min(note.col + 1, layout.cols)]! + 12 * s;
      y = Math.max(0, layout.rowTop[note.row]! - 7 * s);
    }
    const w = (note.box?.width ?? DEFAULT_W) * s;
    const h = (note.box?.height ?? DEFAULT_H) * s;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.minHeight = `${h}px`;
    box.style.fontSize = `${9 * (96 / 72) * s}px`;
    if (note.fill) box.style.backgroundColor = note.fill;
    if (note.border) box.style.borderColor = note.border;

    if (note.threaded?.length) {
      for (const reply of note.threaded) {
        const p = document.createElement("div");
        p.className = "xv-note-reply";
        const author = document.createElement("strong");
        author.textContent = reply.author;
        const text = document.createElement("div");
        text.textContent = reply.text;
        p.append(author, text);
        box.appendChild(p);
      }
    } else {
      for (const run of note.rich) {
        const span = document.createElement("span");
        span.textContent = run.text;
        const f = run.font;
        if (f) {
          if (f.bold) span.style.fontWeight = "bold";
          if (f.italic) span.style.fontStyle = "italic";
          if (f.color && f.color !== "#000000") span.style.color = f.color;
          if (f.sizePx) span.style.fontSize = `${f.sizePx * s}px`;
          if (f.family) span.style.fontFamily = f.family;
          if (f.underline && f.underline !== "none") span.style.textDecoration = "underline";
          if (f.strike) span.style.textDecoration = "line-through";
        }
        box.appendChild(span);
      }
    }
    const { frozenRows, frozenCols } = this.sheet.view;
    this.panes.layer(paneKindFor(paneRow, paneCol, frozenRows, frozenCols)).appendChild(box);
    return box;
  }

  destroy(): void {
    this.hoverBox?.remove();
    for (const b of this.pinned) b.remove();
  }
}
