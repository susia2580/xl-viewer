import workerSource from "virtual:xl-viewer-worker";
import { deserializeError } from "../errors.js";
import type { XlViewerLocale } from "../locales/types.js";
import type { XlViewerWarning, WorkbookModel } from "../model/types.js";
import type { ParseRequest, ParseResponse } from "./protocol.js";

export interface ParserOptions {
  useWorker: boolean;
  workerUrl?: string | URL;
  locale: XlViewerLocale;
  maxFileSize: number;
  maxUncompressedSize: number;
  maxCells: number;
}

/** Parses on a worker when possible, falling back to the main thread. */
export class ParserClient {
  private worker: Worker | undefined;
  private blobUrl: string | undefined;
  private workerFailed = false;
  private destroyed = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: WorkbookModel) => void; reject: (e: Error) => void }>();

  constructor(private readonly options: ParserOptions) {}

  async parse(buffer: ArrayBuffer): Promise<WorkbookModel> {
    if (this.destroyed) throw new Error("Parser destroyed");
    const opts = {
      locale: this.options.locale,
      maxFileSize: this.options.maxFileSize,
      maxUncompressedSize: this.options.maxUncompressedSize,
      maxCells: this.options.maxCells,
    };
    if (this.options.useWorker && !this.workerFailed) {
      const worker = this.getWorker();
      if (worker) {
        try {
          return await this.request(worker, { id: this.nextId++, buffer, options: opts });
        } catch (err) {
          if (!(err instanceof WorkerUnavailable)) throw err;
          this.workerFailed = true;
        }
      }
    }
    const { parseXlsxBuffer } = await import("../parser/index.js");
    const model = parseXlsxBuffer(buffer, opts).model;
    if (this.options.useWorker) model.warnings.unshift(workerWarning());
    return model;
  }

  private getWorker(): Worker | undefined {
    if (this.worker) return this.worker;
    if (this.destroyed) return undefined;
    if (typeof Worker === "undefined") {
      this.workerFailed = true;
      return undefined;
    }
    try {
      if (this.options.workerUrl) {
        this.worker = new Worker(this.options.workerUrl);
      } else {
        this.blobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        this.worker = new Worker(this.blobUrl);
      }
    } catch {
      this.workerFailed = true;
      this.revoke();
      return undefined;
    }
    this.worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.model);
      else p.reject(deserializeError(e.data.error));
    };
    // A load failure (CSP, 404) surfaces as an error event with no message data.
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.failAll(new WorkerUnavailable());
    };
    return this.worker;
  }

  private request(worker: Worker, req: ParseRequest): Promise<WorkbookModel> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      try {
        // The buffer is copied, not transferred, so the caller keeps it for a fallback parse.
        worker.postMessage(req);
      } catch {
        this.pending.delete(req.id);
        reject(new WorkerUnavailable());
      }
    });
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    this.revoke();
  }

  private revoke(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.failAll(new Error("Viewer destroyed"));
  }
}

/** Copies exactly the viewed bytes; `.buffer` of a view can be larger (Node buffers, subarrays). */
export function copyBytes(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

class WorkerUnavailable extends Error {
  constructor() {
    super("Worker unavailable");
  }
}

function workerWarning(): XlViewerWarning {
  return { code: "WORKER_UNAVAILABLE", message: "Web Worker could not be started; parsed on the main thread" };
}
