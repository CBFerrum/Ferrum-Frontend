import { describe, expect, it } from "vitest";
import { postInOrder } from "./apply";

describe("posting several customizations", () => {
  it("posts them in order and reports all done", async () => {
    const seen: unknown[] = [];
    const out = await postInOrder(async (op) => void seen.push(op.op), [{ op: "a" }, { op: "b" }, { op: "c" }]);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(out).toEqual({ done: 3, failed: null });
  });

  it("stops at the first refusal, says which one, and posts nothing after it", async () => {
    const seen: unknown[] = [];
    const refusal = new Error("no");
    const out = await postInOrder(async (op) => {
      if (op.op === "b") throw refusal;
      seen.push(op.op);
    }, [{ op: "a" }, { op: "b" }, { op: "c" }]);
    expect(seen).toEqual(["a"]);
    expect(out).toEqual({ done: 1, failed: { index: 1, op: { op: "b" }, error: refusal } });
  });

  it("does nothing for no operations", async () => {
    expect(await postInOrder(async () => {}, [])).toEqual({ done: 0, failed: null });
  });
});
