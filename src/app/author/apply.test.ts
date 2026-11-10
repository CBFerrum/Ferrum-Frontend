import { afterEach, describe, expect, it, vi } from "vitest";
import { postBatch, BatchRefused, postInOrder } from "./apply";

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

describe("posting a batch", () => {
  const refuse = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
  afterEach(() => vi.unstubAllGlobals());
  const ops = [{ entity: "A", op: {} }];

  it("shows the server's message, not its code, and keeps the index", async () => {
    refuse(422, { error: "invalid", index: 1, message: "Field 'x' already exists" });
    const e = await postBatch(ops, false).catch((x) => x);
    expect(e).toBeInstanceOf(BatchRefused);
    expect(e.message).toBe("Field 'x' already exists");
    expect(e.index).toBe(1);
  });

  it("falls back to the general words when there is no message", async () => {
    refuse(409, { error: "conflict", index: 0 });
    const e = await postBatch(ops, true).catch((x) => x);
    expect(e.message).not.toBe("conflict");
    expect(e.message).toBeTruthy();
    expect(e.index).toBe(0);
  });
});
