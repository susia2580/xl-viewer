import type { SerializedError } from "../errors.js";
import type { XlViewerLocale } from "../locales/types.js";
import type { WorkbookModel } from "../model/types.js";

export interface ParseRequest {
  id: number;
  buffer: ArrayBuffer;
  options: {
    locale: XlViewerLocale;
    maxFileSize: number;
    maxUncompressedSize: number;
    maxCells: number;
  };
}

export type ParseResponse = { id: number; ok: true; model: WorkbookModel } | { id: number; ok: false; error: SerializedError };
