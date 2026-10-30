import type { ColorContext } from "../format/color.js";
import type { RichRun } from "../model/types.js";
import { parseRunFont } from "./styles.js";
import type { ThemeModel } from "./theme.js";
import { NS, streamXml, unescapeOoxml, type XmlElement } from "./xml.js";

export interface SharedString {
  text: string;
  rich?: RichRun[];
}

/**
 * Collects `<si>`/`<is>` content. Shared by shared strings, inline strings
 * and comments. Phonetic runs (`rPh`) are skipped.
 */
export class RichTextCollector {
  private runs: RichRun[] = [];
  private text = "";
  private inT = false;
  private skipDepth = 0;
  private rPr: XmlElement | undefined;
  private rPrStack: XmlElement[] = [];
  private runText = "";
  private inRun = false;

  constructor(
    private readonly colors: ColorContext,
    private readonly theme: ThemeModel,
  ) {}

  reset(): void {
    this.runs = [];
    this.text = "";
    this.inT = false;
    this.skipDepth = 0;
    this.rPr = undefined;
    this.rPrStack = [];
    this.runText = "";
    this.inRun = false;
  }

  /** Returns true if the element was consumed. */
  open(uri: string, local: string, attrs: Record<string, string>): boolean {
    if (this.skipDepth > 0) {
      this.skipDepth++;
      return true;
    }
    if (this.rPrStack.length > 0) return this.pushRPr(uri, local, attrs);
    if (uri !== NS.main) {
      this.skipDepth = 1;
      return true;
    }
    switch (local) {
      case "rPh":
      case "phoneticPr":
        this.skipDepth = 1;
        return true;
      case "r":
        this.inRun = true;
        this.runText = "";
        this.rPr = undefined;
        return true;
      case "rPr":
        if (this.inRun) {
          const el: XmlElement = { uri, local, attrs, children: [], text: "" };
          this.rPr = el;
          this.rPrStack.push(el);
          return true;
        }
        return false;
      case "t":
        this.inT = true;
        return true;
    }
    return false;
  }

  private pushRPr(uri: string, local: string, attrs: Record<string, string>): boolean {
    const el: XmlElement = { uri, local, attrs, children: [], text: "" };
    this.rPrStack[this.rPrStack.length - 1]!.children.push(el);
    this.rPrStack.push(el);
    return true;
  }

  close(uri: string, local: string): boolean {
    if (this.skipDepth > 0) {
      this.skipDepth--;
      return true;
    }
    if (this.rPrStack.length > 0) {
      this.rPrStack.pop();
      return true;
    }
    if (uri !== NS.main) return false;
    if (local === "t") {
      this.inT = false;
      return true;
    }
    if (local === "r" && this.inRun) {
      this.inRun = false;
      const run: RichRun = { text: unescapeOoxml(this.runText) };
      if (this.rPr) {
        const font = parseRunFont(this.rPr, this.colors, this.theme);
        if (Object.keys(font).length) run.font = font;
      }
      this.runs.push(run);
      return true;
    }
    return false;
  }

  onText(t: string): void {
    if (!this.inT || this.skipDepth > 0) return;
    if (this.inRun) this.runText += t;
    else this.text += t;
  }

  result(): SharedString {
    if (this.runs.length === 0) return { text: unescapeOoxml(this.text) };
    const text = this.runs.map((r) => r.text).join("");
    if (this.runs.length === 1 && !this.runs[0]!.font) return { text };
    return { text, rich: this.runs };
  }
}

export function parseSharedStrings(xml: string | undefined, colors: ColorContext, theme: ThemeModel): SharedString[] {
  if (!xml) return [];
  const out: SharedString[] = [];
  const rt = new RichTextCollector(colors, theme);
  let inSi = false;
  streamXml(xml, {
    open(uri, local, attrs) {
      if (uri === NS.main && local === "si" && !inSi) {
        inSi = true;
        rt.reset();
        return;
      }
      if (inSi) rt.open(uri, local, attrs);
    },
    close(uri, local) {
      if (!inSi || rt.close(uri, local)) return;
      if (uri === NS.main && local === "si") {
        out.push(rt.result());
        inSi = false;
      }
    },
    text(t) {
      if (inSi) rt.onText(t);
    },
  });
  return out;
}
