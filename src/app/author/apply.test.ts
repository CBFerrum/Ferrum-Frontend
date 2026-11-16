import { afterEach, describe, expect, it, vi } from "vitest";
import { postBatch, BatchRefused } from "./apply";

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
