import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBootstrap } from "@ferrum/testing";
import { ApiError, type PartsApi, resetBootstrap, uploadInParts } from "./index";

const lease = { allowed: true, until: "2999-01-01T00:00:00Z", hours: 72, key: "k1", person: "p1" };

function as(offline: unknown) {
  (globalThis as { __FERRUM_BOOTSTRAP__?: unknown }).__FERRUM_BOOTSTRAP__ = fakeBootstrap({ offline } as never);
  resetBootstrap();
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    /** The uploads kept, not the lease the page also keeps. */
    uploads: () => [...map.keys()].filter((k) => k.includes(".files.")).length,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __FERRUM_BOOTSTRAP__?: unknown }).__FERRUM_BOOTSTRAP__;
  resetBootstrap();
});

const lost = () => new ApiError(0, "network", "Cannot reach the server.");

/** One upload in parts kept as Ferrum's server keeps it: a part must start where it stands. `say`
 *  tells what happens to the nth part sent: it lands but its answer is lost (and so is the next
 *  read of where the upload stands, with "and the read"), it is dropped before it lands, or it is
 *  refused. */
function server(say: (n: number) => "answer lost" | "answer and the read lost" | "dropped" | "refused" | undefined = () => undefined) {
  let got = new Uint8Array(0);
  let size = 0;
  let gone = false;
  let offline = false;
  let sent = 0;
  const calls: string[] = [];
  const stands = () => ({ upload_id: "u1", parts: true, size, offset: got.length, part_bytes: 4, expires_at: "2999-01-01T00:00:00Z" });
  const client = {
    get: async (path: string) => {
      calls.push(`GET ${path}`);
      if (offline) {
        offline = false;
        throw lost();
      }
      if (gone) throw new ApiError(404, "not_found", "upload not found");
      return stands();
    },
    post: async (path: string, body?: { size: number }) => {
      calls.push(`POST ${path}`);
      if (path.endsWith("/complete")) return { id: "u1", url: "/files/u1", file_name: "a.bin", size, sha256: "x" };
      [got, size, gone] = [new Uint8Array(0), body?.size ?? 0, false];
      return stands();
    },
    put: async (path: string, part: Blob) => {
      const offset = Number(path.split("/").pop());
      calls.push(`PUT ${offset}`);
      const what = say(++sent);
      if (what === "dropped") throw lost();
      if (what === "refused") throw new ApiError(422, "invalid", "part: goes past the size announced");
      if (offset !== got.length) throw new ApiError(409, "conflict", `${got.length} of ${size} bytes have arrived`);
      const next = new Uint8Array(got.length + part.size);
      next.set(got);
      next.set(new Uint8Array(await part.arrayBuffer()), got.length);
      got = next;
      if (what === "answer lost" || what === "answer and the read lost") {
        offline = what === "answer and the read lost";
        throw lost();
      }
      return stands();
    },
  };
  return { client: client as unknown as PartsApi, calls, got: () => [...got], lose: () => void (gone = true) };
}

const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], "a.bin", { lastModified: 1 });
const creates = (calls: string[]) => calls.filter((c) => c === "POST /api/files/uploads").length;

describe("uploads in parts", () => {
  it("goes on from where the server stands when a part's answer is lost or the part is dropped", async () => {
    const s = server((n) => (n === 2 ? "answer and the read lost" : n === 5 ? "dropped" : undefined));
    const waits: number[] = [];
    const stored = await uploadInParts(file, undefined, s.client, async (ms) => void waits.push(ms));
    expect(stored.id).toBe("u1");
    expect(s.got()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // The second part landed: sent again it is refused, and once the upload can be read again it
    // goes on from byte 8; the dropped one is sent again.
    expect(s.calls.filter((c) => c.startsWith("PUT"))).toEqual(["PUT 0", "PUT 4", "PUT 4", "PUT 4", "PUT 8", "PUT 8"]);
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(s.calls.at(-1)).toBe("POST /api/files/uploads/u1/complete");
  });

  it("goes on at once when only the answer was lost", async () => {
    const s = server((n) => (n === 1 ? "answer lost" : undefined));
    const waits: number[] = [];
    await uploadInParts(file, undefined, s.client, async (ms) => void waits.push(ms));
    expect([s.calls.filter((c) => c.startsWith("PUT")), waits]).toEqual([["PUT 0", "PUT 0", "PUT 4", "PUT 8"], [1000]]);
  });

  it("stops after many tries, and the same file chosen again goes on from where it stood", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    as(lease);
    const s = server((n) => (n >= 2 && n <= 10 ? "dropped" : undefined));
    await expect(uploadInParts(file, undefined, s.client, async () => {})).rejects.toMatchObject({ status: 0 });
    expect([s.got().length, storage.uploads()]).toEqual([4, 1]);
    // After a reload: no new upload, on from byte 4, and nothing kept once it is stored.
    await uploadInParts(file, undefined, s.client, async () => {});
    expect([creates(s.calls), s.got().length, storage.uploads()]).toEqual([1, 10, 0]);
  });

  it("starts again when the upload it stood on is gone, or the server refuses a part", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    as(lease);
    const s = server((n) => (n === 2 ? "dropped" : n === 3 ? "refused" : undefined));
    await expect(uploadInParts(file, undefined, s.client, async () => {})).rejects.toMatchObject({ status: 422 });
    expect(storage.uploads()).toBe(0);
    const again = server((n) => (n >= 2 && n <= 10 ? "dropped" : undefined));
    await expect(uploadInParts(file, undefined, again.client, async () => {})).rejects.toMatchObject({ status: 0 });
    again.lose();
    await uploadInParts(file, undefined, again.client, async () => {});
    expect([creates(again.calls), again.got().length, storage.uploads()]).toEqual([2, 10, 0]);
  });

  it("keeps where it stood for the page without a lease to keep it on the device", async () => {
    const s = server((n) => (n >= 2 && n <= 10 ? "dropped" : undefined));
    await expect(uploadInParts(file, { entity: "Note", id: "n1" }, s.client, async () => {})).rejects.toMatchObject({ status: 0 });
    await uploadInParts(file, { entity: "Note", id: "n1" }, s.client, async () => {});
    expect([creates(s.calls), s.got().length]).toEqual([1, 10]);
  });
});
