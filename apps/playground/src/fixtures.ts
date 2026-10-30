// Files served from /fixtures (the playground's public dir).
export const FIXTURES = [
  "generated/basic.xlsx",
  "generated/number-formats.xlsx",
  "generated/borders.xlsx",
  "generated/merges.xlsx",
  "generated/text.xlsx",
  "generated/freeze.xlsx",
  "generated/freeze-rows-only.xlsx",
  "generated/resize.xlsx",
  "generated/notes-images.xlsx",
  "generated/charts.xlsx",
  "generated/conditional.xlsx",
  // Not committed (see .gitignore); available only when the files exist locally.
  "excel/sales-report.xlsx",
  "numbers/sales-report.xlsx",
] as const;
