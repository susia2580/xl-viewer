export type XlViewerErrorCode = "INVALID_FILE" | "UNSUPPORTED_FORMAT" | "FILE_TOO_LARGE" | "PARSE_ERROR";

export class XlViewerError extends Error {
  readonly code: XlViewerErrorCode;

  constructor(code: XlViewerErrorCode, message: string) {
    super(message);
    this.name = "XlViewerError";
    this.code = code;
  }
}

export class InvalidFileError extends XlViewerError {
  constructor(message: string) {
    super("INVALID_FILE", message);
    this.name = "InvalidFileError";
  }
}

export class UnsupportedFormatError extends XlViewerError {
  constructor(message: string) {
    super("UNSUPPORTED_FORMAT", message);
    this.name = "UnsupportedFormatError";
  }
}

export class FileTooLargeError extends XlViewerError {
  constructor(message: string) {
    super("FILE_TOO_LARGE", message);
    this.name = "FileTooLargeError";
  }
}

export class ParseError extends XlViewerError {
  constructor(message: string) {
    super("PARSE_ERROR", message);
    this.name = "ParseError";
  }
}

/** Errors cross the worker boundary as plain objects. */
export interface SerializedError {
  code: XlViewerErrorCode;
  message: string;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof XlViewerError) return { code: err.code, message: err.message };
  return { code: "PARSE_ERROR", message: err instanceof Error ? err.message : String(err) };
}

export function deserializeError(e: SerializedError): XlViewerError {
  switch (e.code) {
    case "INVALID_FILE":
      return new InvalidFileError(e.message);
    case "UNSUPPORTED_FORMAT":
      return new UnsupportedFormatError(e.message);
    case "FILE_TOO_LARGE":
      return new FileTooLargeError(e.message);
    default:
      return new ParseError(e.message);
  }
}
