import { unzipSync, type UnzipFileInfo } from "fflate";
import { FileTooLargeError, InvalidFileError, UnsupportedFormatError } from "../errors.js";

export interface ZipLimits {
  maxFileSize: number;
  maxUncompressedSize: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxFileSize: 20 * 1024 * 1024,
  maxUncompressedSize: 200 * 1024 * 1024,
};

// Parts we never read. Skipping them also keeps them out of the size budget.
const SKIP = /(^|\/)(vbaProject\.bin|activeX\/|externalLinks\/|customXml\/|printerSettings\/|embeddings\/)/i;

export type ZipEntries = Map<string, Uint8Array>;

export function checkSignature(data: Uint8Array): void {
  if (data.length < 4) throw new InvalidFileError("File is too small to be an xlsx file");
  const [a, b, c, d] = data;
  if (a === 0x50 && b === 0x4b && c === 0x03 && d === 0x04) return;
  if (a === 0xd0 && b === 0xcf && c === 0x11 && d === 0xe0) {
    throw new UnsupportedFormatError("Encrypted workbooks and legacy .xls files are not supported");
  }
  throw new InvalidFileError("Not an xlsx file");
}

export function unzip(data: Uint8Array, limits: ZipLimits): ZipEntries {
  if (data.byteLength > limits.maxFileSize) {
    throw new FileTooLargeError(`File is ${data.byteLength} bytes, limit is ${limits.maxFileSize}`);
  }
  checkSignature(data);
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter(file: UnzipFileInfo) {
        if (file.name.endsWith("/") || SKIP.test(file.name)) return false;
        // fflate inflates into a buffer of the declared size, so the
        // declared size is a hard cap on what each entry can produce.
        total += file.originalSize;
        if (total > limits.maxUncompressedSize) {
          throw new FileTooLargeError(`Uncompressed size exceeds ${limits.maxUncompressedSize} bytes`);
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FileTooLargeError) throw err;
    throw new InvalidFileError("Corrupt zip archive: " + (err instanceof Error ? err.message : String(err)));
  }
  const out: ZipEntries = new Map();
  // Own keys only: an entry named "__proto__" replaces the result's prototype, and for-in
  // would then enumerate every byte of it as a key.
  for (const name of Object.keys(raw)) out.set(normalizePath(name), raw[name]!);
  return out;
}

/** Part names are case-insensitive in OPC; we key them lower-case without a leading slash. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}
