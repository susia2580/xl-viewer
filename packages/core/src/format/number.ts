import { format, formatColor, isDateFormat } from "numfmt";
import { DEFAULT_INDEXED } from "./color.js";

/** ECMA-376 Part 1, 18.8.30, locale-neutral ids. */
const BUILTIN: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

export function builtinFormat(id: number, overrides: Record<number, string>): string | undefined {
  return overrides[id] ?? BUILTIN[id];
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  yellow: "#FFFF00",
  magenta: "#FF00FF",
  cyan: "#00FFFF",
};

export interface Formatted {
  text: string;
  color?: string;
}

/** Compiled per format code; numfmt caches parsed patterns internally. */
export class NumberFormatter {
  private readonly dateCache = new Map<string, boolean>();
  private readonly colorCache = new Map<string, boolean>();

  constructor(
    private readonly locale: string,
    private readonly date1904: boolean,
  ) {}

  formatNumber(pattern: string, value: number): Formatted {
    let v = value;
    if (this.date1904 && this.isDate(pattern)) v += 1462;
    let text: string;
    try {
      text = format(pattern, v, { locale: this.locale, leap1900: true, overflow: "######", nbsp: false });
    } catch {
      text = format("General", value, { locale: this.locale });
    }
    if (!this.hasColor(pattern)) return { text };
    const c = formatColor(pattern, v);
    let color: string | undefined;
    if (typeof c === "string") color = c.startsWith("#") ? c.toUpperCase() : NAMED_COLORS[c.toLowerCase()];
    else if (typeof c === "number") color = DEFAULT_INDEXED[c + 7];
    return color ? { text, color } : { text };
  }

  formatText(pattern: string, value: string): Formatted {
    if (pattern === "General" || pattern === "@") return { text: value };
    try {
      return { text: format(pattern, value, { locale: this.locale }) };
    } catch {
      return { text: value };
    }
  }

  isDate(pattern: string): boolean {
    let v = this.dateCache.get(pattern);
    if (v === undefined) {
      try {
        v = isDateFormat(pattern);
      } catch {
        v = false;
      }
      this.dateCache.set(pattern, v);
    }
    return v;
  }

  private hasColor(pattern: string): boolean {
    let v = this.colorCache.get(pattern);
    if (v === undefined) {
      v = /\[(black|white|red|green|blue|yellow|magenta|cyan|color\s*\d+)\]/i.test(pattern);
      this.colorCache.set(pattern, v);
    }
    return v;
  }
}
