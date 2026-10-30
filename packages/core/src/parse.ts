import { en } from "./locales/en.js";
import type { XlViewerLocale } from "./locales/types.js";
import type { WorkbookModel } from "./model/types.js";
import { copyBytes, ParserClient } from "./worker/client.js";

export interface ParseXlsxOptions {
  useWorker?: boolean;
  workerUrl?: string | URL;
  locale?: XlViewerLocale;
  maxFileSize?: number;
  maxUncompressedSize?: number;
  maxCells?: number;
}

/** Parses an xlsx file into the plain data model without rendering it. */
export async function parseXlsx(input: ArrayBuffer | Uint8Array | Blob, options: ParseXlsxOptions = {}): Promise<WorkbookModel> {
  const client = new ParserClient({
    useWorker: options.useWorker !== false,
    ...(options.workerUrl ? { workerUrl: options.workerUrl } : {}),
    locale: options.locale ?? en,
    maxFileSize: options.maxFileSize ?? 20 * 1024 * 1024,
    maxUncompressedSize: options.maxUncompressedSize ?? 200 * 1024 * 1024,
    maxCells: options.maxCells ?? 5_000_000,
  });
  try {
    const buffer = input instanceof ArrayBuffer ? input : input instanceof Uint8Array ? copyBytes(input) : await input.arrayBuffer();
    return await client.parse(buffer);
  } finally {
    client.destroy();
  }
}
