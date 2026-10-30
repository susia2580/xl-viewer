/** Colours the canvas uses for things outside the file's own formatting. */
export interface ViewerTheme {
  gridColor: string;
  headerBg: string;
  headerColor: string;
  headerBorderColor: string;
  frozenLineColor: string;
  noteIndicatorColor: string;
  /** Extra CSS font families tried before the generic family. */
  fontFallback?: string;
}

export const DEFAULT_THEME: ViewerTheme = {
  gridColor: "#E2E2E2",
  headerBg: "#F3F3F3",
  headerColor: "#555555",
  headerBorderColor: "#D0D0D0",
  frozenLineColor: "#9B9B9B",
  noteIndicatorColor: "#FF0000",
};
