import { describe, expect, it } from "vitest";
import { en } from "../src/locales/en";
import { parseXlsx } from "../src/parse";
import { fixture } from "./helpers";

describe("parseXlsx", () => {
  it("falls back to the main thread when workers are unavailable", async () => {
    const data = fixture("generated/basic.xlsx");
    const model = await parseXlsx(data, { locale: en });
    expect(model.sheets[0]!.name).toBe("Basic");
    expect(model.warnings[0]?.code).toBe("WORKER_UNAVAILABLE");
  });

  it("parses on the main thread without a warning when asked to", async () => {
    const model = await parseXlsx(fixture("generated/basic.xlsx"), { useWorker: false });
    expect(model.warnings.map((w) => w.code)).not.toContain("WORKER_UNAVAILABLE");
  });

  it("rejects with typed errors", async () => {
    await expect(parseXlsx(new Uint8Array([1, 2, 3, 4]), { useWorker: false })).rejects.toMatchObject({ code: "INVALID_FILE" });
  });
});
