import type { XlViewerLocale } from "./types.js";

export const en: XlViewerLocale = {
  code: "en-US",
  messages: {
    unsupportedChart: "Unsupported chart",
    chartError: "This chart can't be displayed",
    imageError: "This image can't be displayed",
    gridLabel: "{file}, sheet {sheet}, {range}",
    sheetTabsLabel: "Sheets",
  },
  builtinFormats: {
    5: '"$"#,##0_);\\("$"#,##0\\)',
    6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
    7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
    8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
    14: "m/d/yyyy",
    22: "m/d/yyyy h:mm",
  },
};

export default en;
