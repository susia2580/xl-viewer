import { serializeError } from "../errors.js";
import { parseXlsxBuffer } from "../parser/index.js";
import type { ParseRequest, ParseResponse } from "./protocol.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: ParseResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, buffer, options } = e.data;
  try {
    const { model, transfer } = parseXlsxBuffer(buffer, options);
    scope.postMessage({ id, ok: true, model }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: serializeError(err) });
  }
};
