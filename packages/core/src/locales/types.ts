export interface XlViewerLocale {
  /** BCP 47 tag, also passed to numfmt for month and day names. */
  code: string;
  messages: LocaleMessages;
  /** Built-in number format ids whose code depends on the locale. */
  builtinFormats: Record<number, string>;
}

export interface LocaleMessages {
  unsupportedChart: string;
  chartError: string;
  imageError: string;
  /** Canvas aria-label. `{file}`, `{sheet}` and `{range}` are replaced. */
  gridLabel: string;
  sheetTabsLabel: string;
}
