// The shared outbox (gapclose/design/S13-mobile.md §2.3, slice C1): work done on a device waits here until the server has it. Each
// step is sent with its own idempotency key on every try, in order within its group; a refusal blocks only its group; an unreachable
// server stops the run; an interface older than the installed release sends nothing (`ui_outdated`, the version check); one sender
// at a time across tabs.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, resetBootstrap, type Bootstrap, type RequestOptions } from "./index";
import { memoryStore, outbox, type OutboxStore, type Step } from "./outbox";

type Call = { path: string; init: RequestOptions };
type Answer = (c: Call) => unknown;

const BOOT = { workspace: { id: "w", slug: "acme", name: "Acme", host: "acme.test" }, app: { id: "crm", version: "1.2.0", release: "r1", routes: {}, entry: "crm", title: "CRM", compact: false }, offline: { allowed: true, until: "2099-01-01T00:00:00Z", hours: 72, key: "k1", person: "p1" }, locale: { language: "en" } };
beforeEach(() => {
  (globalThis as { __FERRUM_BOOTSTRAP__?: unknown }).__FERRUM_BOOTSTRAP__ = BOOT as unknown as Bootstrap;
  resetBootstrap();
});
afterEach(() => {
  delete (globalThis as { __FERRUM_BOOTSTRAP__?: unknown }).__FERRUM_BOOTSTRAP__;
  resetBootstrap();
});

/** A server: the version route answers `release`; every other call is kept and answered by `answer` (a thrown ApiError is a refusal). */
function server(answer: Answer = () => ({}), release: string | null = "r1") {
  const calls: Call[] = [];
  let inFlight = 0;
  let most = 0;
  const request = async <T,>(path: string, init: RequestOptions = {}): Promise<T> => {
    if (path === "/api/shell/version") return { app: "crm", version: "1.2.0", release } as T;
    calls.push({ path, init });
    inFlight++;
    most = Math.max(most, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 2));
      return answer({ path, init }) as T;
    } finally {
      inFlight--;
    }
  };
  return { request, calls, most: () => most };
}

const refuse = (status: number, code: string, message = "No", extra: Record<string, unknown> = {}) => {
  throw Object.assign(new ApiError(status, code, message), extra);
};
const step = (group: string, path: string, body: unknown = {}): Omit<Step, "key" | "app"> => ({ group, label: `${group} ${path}`, at: "2026-11-19T10:00:00Z", request: { method: "POST", path, body } });

describe("the shared outbox", () => {
  let store: OutboxStore;
  beforeEach(() => {
    store = memoryStore();
  });

  it("a_step_is_sent_once_with_its_key_however_often_send_runs", async () => {
    const s = server();
    const box = outbox("crm", { store, request: s.request });
    expect(await box.hold(step("lead-1", "/api/v1/Call"))).toBe(true);
    const [held] = await box.list();
    expect(held.key).toMatch(/^crm\.lead-1\./);
    expect(held.key.length).toBeGreaterThanOrEqual(8);
    await Promise.all([box.send(), box.send(), box.send()]);
    await box.send();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].init).toMatchObject({ method: "POST", idempotencyKey: held.key, once: false });
    expect(await box.list()).toEqual([]);
  });

  it("keeps the key it was given: a step tried before keeps the key the server knows", async () => {
    const s = server();
    const box = outbox("crm", { store, request: s.request });
    await box.hold({ ...step("g", "/api/v1/Call"), key: "crm.call.c1.2026-11-19.abcdefgh" });
    await box.send();
    expect(s.calls[0].init.idempotencyKey).toBe("crm.call.c1.2026-11-19.abcdefgh");
  });

  it("steps_of_one_group_keep_their_order", async () => {
    const s = server();
    const box = outbox("crm", { store, request: s.request });
    for (const p of ["/a", "/b", "/c"]) await box.hold(step("lead-1", p));
    await box.send();
    expect(s.calls.map((c) => c.path)).toEqual(["/a", "/b", "/c"]);
  });

  it("a_refused_step_blocks_only_its_group", async () => {
    const s = server(({ path }) => (path === "/a1" ? refuse(422, "invalid", "Call date is in the future") : {}));
    const box = outbox("crm", { store, request: s.request });
    await box.hold(step("A", "/a1"));
    await box.hold(step("B", "/b1"));
    await box.hold(step("A", "/a2"));
    const r = await box.send();
    expect(s.calls.map((c) => c.path)).toEqual(["/a1", "/b1"]);
    expect(r.sent.map((x) => x.request.path)).toEqual(["/b1"]);
    expect((await box.refused()).map((x) => [x.step.request.path, x.reason, x.status])).toEqual([["/a1", "Call date is in the future", 422]]);
    expect((await box.list()).map((x) => x.request.path)).toEqual(["/a2"]);
    // Tried again, it goes back in its place and is sent with the same key; the group follows.
    const key = (await box.refused())[0].step.key;
    expect(await box.retry(key)).toBe(true);
    const ok = server();
    await outbox("crm", { store, request: ok.request }).send();
    expect(ok.calls.map((c) => [c.path, c.init.idempotencyKey === key || c.path !== "/a1"])).toEqual([["/a1", true], ["/a2", true]]);
  });

  it("discarding a refused step can leave a note in its place", async () => {
    const s = server(({ path }) => (path === "/a1" ? refuse(403, "forbidden") : {}));
    const box = outbox("crm", { store, request: s.request });
    await box.hold(step("A", "/a1"));
    await box.send();
    const key = (await box.refused())[0].step.key;
    expect(await box.discard(key, (r) => ({ ...r.step, request: { method: "POST", path: "/note", body: { text: r.reason } } }))).toBe(true);
    expect(await box.refused()).toEqual([]);
    expect((await box.list()).map((x) => x.request.path)).toEqual(["/note"]);
  });

  it("unreachable_stops_the_run_and_keeps_the_order", async () => {
    for (const status of [0, 401, 408, 429, 500, 503]) {
      store = memoryStore();
      const s = server(({ path }) => (path === "/b" ? refuse(status, "x") : {}));
      const box = outbox("crm", { store, request: s.request });
      for (const [g, p] of [["A", "/a"], ["B", "/b"], ["C", "/c"]]) await box.hold(step(g, p));
      const r = await box.send();
      expect(r.stopped, String(status)).toBe(true);
      expect(s.calls.map((c) => c.path), String(status)).toEqual(["/a", "/b"]);
      expect((await box.list()).map((x) => x.request.path), String(status)).toEqual(["/b", "/c"]);
      expect(await box.refused()).toEqual([]);
    }
  });

  it("ui_outdated_stops_and_reports_outdated", async () => {
    const s = server(({ path }) => (path === "/b" ? refuse(409, "ui_outdated", "This page is from an older version of crm. Reload it.") : {}));
    const box = outbox("crm", { store, request: s.request });
    for (const p of ["/a", "/b", "/c"]) await box.hold(step(p, p));
    const r = await box.send();
    expect(r.outdated).toBe(true);
    expect(s.calls.map((c) => c.path)).toEqual(["/a", "/b"]);
    expect((await box.list()).map((x) => x.request.path)).toEqual(["/b", "/c"]);
    expect(await box.refused()).toEqual([]);
  });

  it("a_stale_release_sends_nothing", async () => {
    const s = server(() => ({}), "r2");
    const box = outbox("crm", { store, request: s.request });
    await box.hold(step("A", "/a"));
    const r = await box.send();
    expect(r.outdated).toBe(true);
    expect(s.calls).toEqual([]);
    expect(await box.list()).toHaveLength(1);
  });

  it("two_senders_never_send_together", async () => {
    const s = server();
    // Two tabs: two outboxes over the same steps, sending at once.
    const a = outbox("crm", { store, request: s.request });
    const b = outbox("crm", { store, request: s.request });
    for (const p of ["/1", "/2", "/3", "/4"]) await a.hold(step(p, p));
    await Promise.all([a.send(), b.send(), a.send(), b.send()]);
    expect(s.most()).toBe(1);
    expect(s.calls.map((c) => c.path)).toEqual(["/1", "/2", "/3", "/4"]);
  });

  it("takes the browser's Web Lock named for the workspace, so tabs of the origin take turns", async () => {
    const names: string[] = [];
    let chain: Promise<unknown> = Promise.resolve();
    const locks = {
      request: (name: string, a: unknown, b?: unknown) => {
        names.push(name);
        const fn = (typeof a === "function" ? a : b) as () => Promise<unknown>;
        const run = chain.then(fn);
        chain = run.catch(() => {});
        return run;
      },
    };
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
    try {
      const s = server();
      const a = outbox("crm", { store, request: s.request });
      for (const p of ["/1", "/2"]) await a.hold(step(p, p));
      await Promise.all([a.send(), outbox("crm", { store, request: s.request }).send()]);
      expect(names).toEqual(["ferrum-outbox-acme", "ferrum-outbox-acme"]);
      expect(s.most()).toBe(1);
      expect(s.calls.map((c) => c.path)).toEqual(["/1", "/2"]);
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it("a_conflict_on_client_ref_counts_as_sent", async () => {
    const s = server(({ path }) =>
      path === "/dup" ? refuse(409, "conflict", "A record with this Client Ref exists", { fields: [{ field: "client_ref", message: "already exists" }] })
      : path === "/other" ? refuse(409, "conflict", "Name taken", { fields: [{ field: "name", message: "taken" }] })
      : {},
    );
    const box = outbox("crm", { store, request: s.request });
    await box.hold(step("A", "/dup", { client_ref: "c-1" }));
    await box.hold(step("B", "/other", { client_ref: "c-2" }));
    const r = await box.send();
    expect(r.sent.map((x) => x.request.path)).toEqual(["/dup"]);
    expect((await box.refused()).map((x) => x.step.request.path)).toEqual(["/other"]);
    expect(await box.list()).toEqual([]);
  });

  it("an input_changed refusal is kept as refused", async () => {
    const s = server(() => refuse(409, "input_changed", "This key was used for another request"));
    const box = outbox("crm", { store, request: s.request });
    await box.hold(step("A", "/a"));
    await box.send();
    expect((await box.refused()).map((x) => x.status)).toEqual([409]);
  });

  it("hold_returns_false_when_storage_refuses", async () => {
    const full: OutboxStore = { ...memoryStore(), add: async () => Promise.reject(new DOMException("full", "QuotaExceededError")) };
    expect(await outbox("crm", { store: full, request: server().request }).hold(step("A", "/a"))).toBe(false);
    // No person on the page (signed out, a public page): nothing is held.
    expect(await outbox("crm", { store: null, request: server().request }).hold(step("A", "/a"))).toBe(false);
  });

  it("sends a step's files first, each with its own key, and puts their ids in its body", async () => {
    const s = server(({ path, init }) => (path === "/api/files" ? { id: `file-${String(init.idempotencyKey).slice(-5)}` } : {}));
    const box = outbox("crm", { store, request: s.request });
    await box.hold({ ...step("A", "/api/v1/Call"), files: ["photo"] });
    const { key } = (await box.list())[0];
    await box.putFile(`${key}.photo`, new Blob(["x"], { type: "image/png" }));
    await box.send({ prepare: (st, ids) => ({ ...st, request: { ...st.request, body: { picture: ids.photo } } }) });
    expect(s.calls.map((c) => [c.path, c.init.idempotencyKey])).toEqual([["/api/files", `${key}.photo`], ["/api/v1/Call", key]]);
    expect(s.calls[1].init.body).toEqual({ picture: "file-photo" });
    expect(await store.file(`${key}.photo`)).toBeUndefined();
  });

  it("sends only its own app's steps", async () => {
    const s = server();
    await outbox("hr", { store, request: s.request }).hold(step("A", "/hr"));
    await outbox("crm", { store, request: s.request }).hold(step("A", "/crm"));
    await outbox("crm", { store, request: s.request }).send();
    expect(s.calls.map((c) => c.path)).toEqual(["/crm"]);
    expect((await outbox("hr", { store, request: s.request }).list()).map((x) => x.request.path)).toEqual(["/hr"]);
  });
});
