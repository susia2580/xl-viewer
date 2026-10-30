import type { XlViewerLocale } from "./types.js";

const longDate = 'yyyy"년" mm"월" dd"일"';

// Built-in ids for ko-KR, ECMA-376 Part 1, 18.8.30.
export const ko: XlViewerLocale = {
  code: "ko-KR",
  messages: {
    unsupportedChart: "지원하지 않는 차트",
    chartError: "차트를 표시할 수 없습니다",
    imageError: "이미지를 표시할 수 없습니다",
    gridLabel: "{file}, {sheet} 시트, {range}",
    sheetTabsLabel: "시트",
  },
  builtinFormats: {
    5: '"₩"#,##0;"₩"\\-#,##0',
    6: '"₩"#,##0;[Red]"₩"\\-#,##0',
    7: '"₩"#,##0.00;"₩"\\-#,##0.00',
    8: '"₩"#,##0.00;[Red]"₩"\\-#,##0.00',
    14: "yyyy-mm-dd",
    22: "yyyy-mm-dd h:mm",
    27: longDate,
    28: "mm-dd",
    29: "mm-dd",
    30: "mm-dd-yy",
    31: longDate,
    32: 'h"시" mm"분"',
    33: 'h"시" mm"분" ss"초"',
    34: "yyyy-mm-dd",
    35: "yyyy-mm-dd",
    36: longDate,
    50: longDate,
    51: "mm-dd",
    52: "yyyy-mm-dd",
    53: "yyyy-mm-dd",
    54: "mm-dd",
    55: "yyyy-mm-dd",
    56: "yyyy-mm-dd",
    57: longDate,
    58: "mm-dd",
  },
};

export default ko;
