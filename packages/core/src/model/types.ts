// Plain data passed from the parser (often a worker) to the renderer.
// No functions or class instances: everything must survive structuredClone.

export interface WorkbookModel {
  sheets: SheetModel[];
  styles: ResolvedStyle[];
  /** Differential styles used by conditional formatting. */
  dxfs: DiffStyle[];
  date1904: boolean;
  /** Font of the Normal style; drives column width math (max digit width). */
  defaultFont: ResolvedFont;
  warnings: XlViewerWarning[];
}

export type SheetState = "visible" | "hidden" | "veryHidden";

export interface SheetModel {
  name: string;
  state: SheetState;
  /** px */
  defaultRowHeight: number;
  /** File units (characters). Converted to px by the renderer. */
  defaultColWidth?: number;
  baseColWidth: number;
  rowCount: number;
  colCount: number;
  rows: Record<number, RowInfo>;
  /** `<col>` ranges as stored, sorted by `min`. */
  cols: ColRange[];
  cells: Record<number, Record<number, CellModel>>;
  merges: CellRange[];
  notes: NoteModel[];
  images: ImageModel[];
  shapes: ShapeModel[];
  charts: ChartModel[];
  /** Conditional formatting results, keyed [row][col]. */
  cf: Record<number, Record<number, CfResult>>;
  view: SheetView;
}

export interface SheetView {
  showGridLines: boolean;
  showHeaders: boolean;
  frozenRows: number;
  frozenCols: number;
  /** 100 = 100% */
  zoom: number;
  /** First visible row/col of the scrollable pane when frozen. */
  topRow: number;
  leftCol: number;
}

export type CellType = "number" | "string" | "boolean" | "error";

export interface CellModel {
  /** Display text with number format applied. */
  text: string;
  type: CellType;
  styleId: number;
  /** Raw value when it differs from `text` (numbers, booleans). */
  value?: number | boolean;
  rich?: RichRun[];
  /** Colour from a number format section such as `[Red]`. */
  fmtColor?: string;
}

export interface RowInfo {
  /** px */
  height?: number;
  hidden?: boolean;
  styleId?: number;
}

/** 0-based, inclusive. */
export interface ColRange {
  min: number;
  max: number;
  width?: number;
  hidden?: boolean;
  styleId?: number;
}

/** 0-based, inclusive. */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface XlViewerWarning {
  code: string;
  message: string;
  sheet?: string;
  ref?: string;
}

export interface Anchor {
  /** dx, dy in px from the top-left of the cell. */
  from: { row: number; col: number; dx: number; dy: number };
  /** Present for two-cell anchors; the renderer resolves the size from cells. */
  to?: { row: number; col: number; dx: number; dy: number };
  /** px, used when `to` is absent. */
  width: number;
  height: number;
  /** Absolute anchors: px from the sheet origin. */
  x?: number;
  y?: number;
}

export interface NoteModel {
  row: number;
  col: number;
  author?: string;
  rich: RichRun[];
  /** px */
  box?: { width: number; height: number };
  /** Box position from VML: column/row plus px offsets. */
  from?: { col: number; dx: number; row: number; dy: number };
  fill?: string;
  border?: string;
  alwaysVisible: boolean;
  threaded?: ThreadReply[];
}

export interface ThreadReply {
  author: string;
  text: string;
  date?: string;
}

/** Box inside the anchor as 0..1 fractions; set for items nested in a group. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageModel {
  anchor: Anchor;
  frame?: Frame;
  /** Paint order within the sheet's drawing layer. */
  z?: number;
  mime: string;
  data: ArrayBuffer;
}

export interface ShapeRun {
  text: string;
  /** px at 100% zoom */
  size: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  family?: string;
  /** Letter spacing in px. */
  spacing?: number;
  shadow?: boolean;
}

export interface ShapeParagraph {
  align: "left" | "center" | "right" | "justify";
  /** Line height multiplier, when the file sets one. */
  lineHeight?: number;
  /** Size for an empty paragraph. */
  size: number;
  runs: ShapeRun[];
}

export interface ShapeModel {
  anchor: Anchor;
  frame?: Frame;
  z?: number;
  geometry: "rect" | "roundRect" | "ellipse";
  fill?: string;
  line?: { color: string; width: number };
  vAlign: "top" | "middle" | "bottom";
  /** l, t, r, b in px. */
  insets: [number, number, number, number];
  wrap: boolean;
  paragraphs: ShapeParagraph[];
}

export type ChartKind = "bar" | "line" | "pie" | "doughnut" | "area" | "scatter" | "combo" | "unsupported";

export interface ChartModel {
  anchor: Anchor;
  z?: number;
  kind: ChartKind;
  /** Set when parsing failed; rendered as an error box. */
  error?: boolean;
  title?: string;
  legend: "top" | "bottom" | "left" | "right" | "none";
  series: ChartSeries[];
  axes: ChartAxes;
  /** Chart area background and border. */
  area: { fill?: string; border?: string; borderWidth?: number };
  /** Inner plot area as fractions of the chart size (manualLayout). */
  plot?: { x: number; y: number; w: number; h: number; fill?: string };
  titleFont?: ChartFont;
  legendFont?: ChartFont;
  options: ChartOptions;
}

export interface ChartFont {
  /** px */
  size?: number;
  color?: string;
  bold?: boolean;
  family?: string;
}

export interface ChartOptions {
  horizontal?: boolean;
  grouping?: "clustered" | "stacked" | "percentStacked" | "standard";
  gapWidth?: number;
  overlap?: number;
  holeSize?: number;
  firstSliceAngle?: number;
  varyColors?: boolean;
  /** Theme accent colours used when a series or point has no colour. */
  palette: string[];
}

export interface ChartAxis {
  hidden: boolean;
  labels: boolean;
  gridlines: boolean;
  title?: string;
  min?: number;
  max?: number;
  majorUnit?: number;
  numFmt?: string;
  reversed?: boolean;
  position?: "b" | "t" | "l" | "r";
  line?: { color: string; width: number };
  grid?: { color: string; width: number };
  font?: ChartFont;
}

export interface ChartAxes {
  category: ChartAxis;
  value: ChartAxis;
  secondary?: ChartAxis;
}

export interface ChartSeries {
  name: string;
  type: "bar" | "line" | "pie" | "area" | "scatter";
  categories: (string | number)[];
  values: (number | null)[];
  color?: string;
  pointColors?: Record<number, string>;
  secondary?: boolean;
  smooth?: boolean;
  marker?: boolean;
  labels?: boolean;
  /** Scatter with lines. */
  lines?: boolean;
  border?: { color: string; width: number };
  /** Line width in px for line and scatter series. */
  lineWidth?: number;
}

export interface RichRun {
  text: string;
  font?: Partial<ResolvedFont>;
}

export type HAlign = "general" | "left" | "center" | "right" | "justify" | "fill" | "centerContinuous" | "distributed";
export type VAlign = "top" | "middle" | "bottom" | "justify" | "distributed";

export interface ResolvedStyle {
  font: ResolvedFont;
  fill?: string;
  border?: Borders;
  hAlign: HAlign;
  vAlign: VAlign;
  wrap: boolean;
  shrink: boolean;
  indent: number;
  /** Degrees, -90..90, or 255 for stacked vertical text. */
  rotation: number;
  numFmt: string;
}

export interface Borders {
  top?: BorderSide;
  right?: BorderSide;
  bottom?: BorderSide;
  left?: BorderSide;
  diagonalUp?: BorderSide;
  diagonalDown?: BorderSide;
}

export interface ResolvedFont {
  /** Name as stored in the file. */
  name: string;
  /** CSS font-family list including fallbacks. */
  family: string;
  sizePx: number;
  bold: boolean;
  italic: boolean;
  underline: "none" | "single" | "double";
  strike: boolean;
  color: string;
  vertAlign?: "superscript" | "subscript";
}

export type BorderStyle =
  | "thin"
  | "medium"
  | "thick"
  | "dashed"
  | "dotted"
  | "double"
  | "hair"
  | "mediumDashed"
  | "dashDot"
  | "mediumDashDot"
  | "dashDotDot"
  | "mediumDashDotDot"
  | "slantDashDot";

export interface BorderSide {
  style: BorderStyle;
  color: string;
}

export interface DiffStyle {
  font?: Partial<Pick<ResolvedFont, "bold" | "italic" | "strike" | "underline" | "color">>;
  fill?: string;
  border?: Borders;
  numFmt?: string;
}

export interface CfResult {
  fill?: string;
  font?: DiffStyle["font"];
  border?: Borders;
  dataBar?: { from: number; to: number; color: string; gradient: boolean; showValue: boolean; negative: boolean };
  icon?: { set: string; index: number; showValue: boolean };
}
