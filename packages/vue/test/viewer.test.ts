// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const instances: {
  open: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  handlers: Record<string, (p: unknown) => void>;
}[] = [];

vi.mock("@xl-viewer/core", () => ({
  createViewer: vi.fn(() => {
    const v = {
      open: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
      setTheme: vi.fn(),
      handlers: {} as Record<string, (p: unknown) => void>,
      on(event: string, cb: (p: unknown) => void) {
        v.handlers[event] = cb;
        return () => undefined;
      },
    };
    instances.push(v);
    return v;
  }),
}));

const { XlViewer } = await import("../src/index");

describe("XlViewer", () => {
  it("opens src, reopens on change and destroys on unmount", async () => {
    const a = new ArrayBuffer(1);
    const b = new ArrayBuffer(2);
    const w = mount(XlViewer, { props: { src: a } });
    const v = instances.at(-1)!;
    expect(v.open).toHaveBeenCalledWith(a);
    await w.setProps({ src: b });
    expect(v.open).toHaveBeenLastCalledWith(b);
    w.unmount();
    expect(v.destroy).toHaveBeenCalled();
  });

  it("forwards events", async () => {
    const w = mount(XlViewer);
    const v = instances.at(-1)!;
    v.handlers.load!({ sheetNames: ["A"], activeSheet: 0, warnings: [] });
    v.handlers.sheetchange!(1);
    await nextTick();
    expect(w.emitted("load")?.[0]).toEqual([{ sheetNames: ["A"], activeSheet: 0, warnings: [] }]);
    expect(w.emitted("sheetchange")?.[0]).toEqual([1]);
  });

  it("recreates the viewer when options change and applies theme updates", async () => {
    const w = mount(XlViewer, { props: { showHeaders: true } });
    const first = instances.at(-1)!;
    await w.setProps({ showHeaders: false });
    expect(first.destroy).toHaveBeenCalled();
    const second = instances.at(-1)!;
    expect(second).not.toBe(first);
    await w.setProps({ theme: { headerBg: "#000" } });
    expect(second.setTheme).toHaveBeenCalledWith({ headerBg: "#000" });
  });
});
