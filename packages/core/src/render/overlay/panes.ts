import type { Pane, PaneKind } from "../panes.js";

/** One clipped DOM layer per pane, holding overlay items in sheet coordinates. */
export class OverlayPanes {
  private readonly layers = new Map<PaneKind, { clip: HTMLDivElement; layer: HTMLDivElement }>();

  constructor(private readonly root: HTMLDivElement) {}

  layer(kind: PaneKind): HTMLDivElement {
    let entry = this.layers.get(kind);
    if (!entry) {
      const clip = document.createElement("div");
      clip.className = "xv-pane";
      const layer = document.createElement("div");
      layer.className = "xv-layer";
      clip.appendChild(layer);
      this.root.appendChild(clip);
      entry = { clip, layer };
      this.layers.set(kind, entry);
      this.place(kind);
    }
    return entry.layer;
  }

  /** Positions pane clips; `root` covers the whole viewport. */
  update(panes: Pane[]): void {
    this.last = panes;
    for (const kind of this.layers.keys()) this.place(kind);
  }

  private last: Pane[] = [];

  private place(kind: PaneKind): void {
    const entry = this.layers.get(kind);
    if (!entry) return;
    const p = this.last.find((x) => x.kind === kind);
    if (!p) {
      entry.clip.style.display = "none";
      return;
    }
    const { clip, layer } = entry;
    clip.style.display = "";
    clip.style.left = `${p.x}px`;
    clip.style.top = `${p.y}px`;
    clip.style.width = `${p.w}px`;
    clip.style.height = `${p.h}px`;
    layer.style.transform = `translate(${-p.sx}px, ${-p.sy}px)`;
  }

  clear(): void {
    for (const { clip } of this.layers.values()) clip.remove();
    this.layers.clear();
  }
}

export function paneKindFor(row: number, col: number, frozenRows: number, frozenCols: number): PaneKind {
  const top = row < frozenRows;
  const left = col < frozenCols;
  if (top && left) return "corner";
  if (top) return "top";
  if (left) return "left";
  return "main";
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function intersects(r: Rect, p: Pane): boolean {
  return r.x < p.sx + p.w && r.x + r.w > p.sx && r.y < p.sy + p.h && r.y + r.h > p.sy;
}
