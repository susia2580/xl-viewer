import { existsSync, readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

export function hasFixture(path: string): boolean {
  return existsSync(new URL("../../../fixtures/" + path, import.meta.url));
}

export function fixture(path: string): Uint8Array {
  return readFileSync(new URL("../../../fixtures/" + path, import.meta.url));
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WB_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Builds a minimal one-sheet workbook around the given sheetData XML. */
export function miniXlsx(sheetData: string, extra: Record<string, string> = {}, workbookAttrs = ""): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"${workbookAttrs}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(WB_RELS),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet xmlns="${MAIN}"><sheetData>${sheetData}</sheetData></worksheet>`),
  };
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return zipSync(files);
}
