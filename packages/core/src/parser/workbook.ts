import type { SheetState } from "../model/types.js";
import { attrBool, attrNum, child, children, NS, type XmlElement } from "./xml.js";

export interface SheetEntry {
  name: string;
  relId: string;
  state: SheetState;
}

export interface DefinedName {
  name: string;
  /** Index into the sheet list for sheet-scoped names. */
  sheet?: number;
  formula: string;
}

export interface WorkbookInfo {
  sheets: SheetEntry[];
  date1904: boolean;
  definedNames: DefinedName[];
  activeTab: number;
}

export function parseWorkbook(root: XmlElement): WorkbookInfo {
  const sheets = children(child(root, "sheets", NS.main), "sheet", NS.main).map((s): SheetEntry => {
    const state = s.attrs.state;
    return {
      name: s.attrs.name ?? "",
      relId: s.attrs["r:id"] ?? "",
      state: state === "hidden" || state === "veryHidden" ? state : "visible",
    };
  });
  const definedNames = children(child(root, "definedNames", NS.main), "definedName", NS.main).map((d): DefinedName => {
    const out: DefinedName = { name: d.attrs.name ?? "", formula: d.text.trim() };
    const local = attrNum(d, "localSheetId");
    if (local !== undefined) out.sheet = local;
    return out;
  });
  const view = child(child(root, "bookViews", NS.main), "workbookView", NS.main);
  return {
    sheets,
    date1904: attrBool(child(root, "workbookPr", NS.main), "date1904", false),
    definedNames,
    activeTab: attrNum(view, "activeTab") ?? 0,
  };
}
