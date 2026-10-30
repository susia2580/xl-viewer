/** Records 2D context calls so paint order and geometry can be asserted. */
export function fakeContext(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif", fillStyle: "#000", strokeStyle: "#000" };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "calls") return calls;
        if (prop === "measureText") {
          return (text: string) => ({ width: text.length * 7, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 });
        }
        if (prop === "createLinearGradient") return () => ({ addColorStop() {} });
        if (prop in state) return state[prop];
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.map((a) => (typeof a === "number" ? Math.round(a * 100) / 100 : JSON.stringify(a))).join(",")})`);
        };
      },
      set(_t, prop: string, value) {
        state[prop] = value;
        if (prop === "fillStyle" || prop === "font") calls.push(`${prop}=${value}`);
        return true;
      },
    },
  );
  return ctx as CanvasRenderingContext2D & { calls: string[] };
}
