export class SheetTabs {
  readonly el: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];

  constructor(
    label: string,
    private readonly onSelect: (index: number) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = "xv-tabs";
    this.el.setAttribute("role", "tablist");
    this.el.setAttribute("aria-label", label);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** `sheets` are (index into the workbook, name) pairs for visible sheets. */
  render(sheets: { index: number; name: string }[], active: number): void {
    this.el.replaceChildren();
    this.buttons = sheets.map(({ index, name }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xv-tab";
      b.setAttribute("role", "tab");
      b.dataset.index = String(index);
      b.textContent = name;
      b.addEventListener("click", () => this.onSelect(index));
      this.el.appendChild(b);
      return b;
    });
    this.setActive(active);
  }

  setActive(index: number): void {
    for (const b of this.buttons) {
      const on = Number(b.dataset.index) === index;
      b.classList.toggle("xv-tab-active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = this.buttons.findIndex((b) => b === document.activeElement);
    if (i < 0) return;
    const next = this.buttons[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    this.onSelect(Number(next.dataset.index));
  }
}
