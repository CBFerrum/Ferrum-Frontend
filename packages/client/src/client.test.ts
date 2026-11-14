import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBootstrap, installFakeShell, removeFakeShell } from "@ferrum/testing";
import { ApiError, bootstrap, request, resetBootstrap, routeBase, setStepUpHandler, shell, shownTimeZone } from "./index";

afterEach(() => {
  setStepUpHandler(null);
  vi.unstubAllGlobals();
  removeFakeShell();
});

describe("@ferrum/client", () => {
  it("reads the bootstrap and the app's routes", () => {
    expect(bootstrap()).toBeNull();
    expect(routeBase("crm")).toBe("/crm/");
    installFakeShell();
    expect(bootstrap()?.workspace.slug).toBe("test");
    expect(routeBase("app")).toBe("/app/");
  });

  it("shows times on the workspace's clock from the page", () => {
    installFakeShell();
    bootstrap();
    expect(shownTimeZone()).toBe("UTC");
    resetBootstrap();
    expect(shownTimeZone()).toBeUndefined();
  });

  it("shows times on the person's own clock when the page names one", () => {
    const boot = fakeBootstrap();
    installFakeShell({ bootstrap: { ...boot, locale: { ...boot.locale, display_timezone: "Asia/Kolkata" } } });
    bootstrap();
    expect(shownTimeZone()).toBe("Asia/Kolkata");
  });

  it("falls back when no shell runs", () => {
    expect(shell().supports("intent")).toBe(false);
    return expect(shell().intent({ action: "pick", type: "file" })).rejects.toMatchObject({ code: "no_handler" });
  });

  it("uses the host's shell", async () => {
    const calls = installFakeShell({ intents: { "pick file": { id: "f1" } } });
    shell().ready();
    shell().title("Deals");
    expect(await shell().intent({ action: "pick", type: "file" })).toEqual({ status: "done", result: { id: "f1" }, app: "fake" });
    expect(await shell().canIntent("compose", "email")).toBe(false);
    expect([calls.ready, calls.titles]).toEqual([1, ["Deals"]]);
  });

  describe("uploads.track", () => {
    const install = (uploads?: unknown) => vi.stubGlobal("ferrum", { shell: { uploads } });
    const bar = () => {
      const calls: string[] = [];
      const handle = { id: "u1", progress: (b: number) => calls.push(`progress ${b}`), retrying: () => calls.push("retrying"), sending: () => calls.push("sending"), done: () => calls.push("done"), fail: (m?: string) => calls.push(`fail ${m}`) };
      return { calls, uploads: { track: vi.fn(async () => handle) } };
    };

    it("is a handle that does nothing where no shell runs", async () => {
      expect(shell().uploads.canTrack).toBe(false);
      const h = await shell().uploads.track({ label: "a.zip", size: 10 });
      expect(() => [h.progress(1), h.retrying(), h.sending(), h.done(), h.fail("x")]).not.toThrow();
    });

    it("does nothing, and says so, on a bar that has no track", async () => {
      install({ start: vi.fn() });
      expect(shell().uploads.canTrack).toBe(false);
      expect((await shell().uploads.track({ label: "a.zip", size: 10 })).id).toBe("");
      expect(typeof shell().uploads.start).toBe("function");
    });

    it("passes the transfer to the bar's tray", async () => {
      const b = bar();
      install(b.uploads);
      expect(shell().uploads.canTrack).toBe(true);
      const cancel = () => {};
      const h = await shell().uploads.track({ label: "a.zip", size: 10, cancel });
      h.progress(5);
      h.sending();
      h.done();
      expect(b.uploads.track).toHaveBeenCalledWith({ label: "a.zip", size: 10, cancel });
      expect(b.calls).toEqual(["progress 5", "sending", "done"]);
    });

    it("ignores calls after done or fail", async () => {
      const b = bar();
      install(b.uploads);
      const h = await shell().uploads.track({ label: "a.zip", size: 10 });
      h.fail("no room");
      h.progress(9);
      h.done();
      h.fail("again");
      expect(b.calls).toEqual(["fail no room"]);
    });
  });

  it("sends the session cookie and the interface's version, and turns errors into ApiError", async () => {
    installFakeShell();
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify({ error: "forbidden", message: "Not yours" }), { status: 403, headers: { "content-type": "application/json" } });
    });
    const e = (await request("/api/v1/Deal").catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.code, e.message]).toEqual([403, "forbidden", "Not yours"]);
    expect(seen[0].credentials).toBe("same-origin");
    expect((seen[0].headers as Record<string, string>)["x-ferrum-ui"]).toBe("app@1.0.0");
  });

  it("sends a write again with its key and digest when the answer was lost (FEO-003)", async () => {
    vi.useFakeTimers();
    const seen: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return seen.length === 1
        ? new Response(JSON.stringify({ error: "retry" }), { status: 503, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ id: "wo-1" }), { status: 200, headers: { "content-type": "application/json", "idempotent-replayed": "true" } });
    });
    const p = request<{ id: string }>("/api/v1/WorkOrder/wo-1", { method: "PATCH", body: { parts: [] }, idempotencyKey: "wo-1.save.1", idempotencyDigest: "add Filter x1" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ id: "wo-1" });
    expect(seen.map((h) => [h["idempotency-key"], h["idempotency-digest"]])).toEqual([["wo-1.save.1", "add Filter x1"], ["wo-1.save.1", "add Filter x1"]]);
    vi.useRealTimers();
  });

  it("does not send a write again without a key", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response(JSON.stringify({ error: "retry" }), { status: 503, headers: { "content-type": "application/json" } });
    });
    await request("/api/v1/WorkOrder/wo-1", { method: "PATCH", body: {}, idempotencyDigest: "ignored without a key" }).catch(() => undefined);
    expect(n).toBe(1);
  });

  it("waits while the app is upgraded, then goes on", async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal("fetch", async () =>
      n++ === 0
        ? new Response(JSON.stringify({ error: "app_upgrading" }), { status: 503, headers: { "retry-after": "1", "content-type": "application/json" } })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const p = request<{ ok: boolean }>("/api/ext/crm/x", { method: "POST" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ ok: true });
    vi.useRealTimers();
  });

  describe("403 step_up (a marked entity needs a fresh proof)", () => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const asked = { error: "step_up", message: "confirm it is you: enter your password again to do this" };
    /** A server that refuses every call until `proved`, as the platform does until POST /api/auth/step-up. */
    const server = () => {
      const state = { proved: false, calls: 0 };
      vi.stubGlobal("fetch", async () => {
        state.calls++;
        return state.proved ? json(200, { ok: true }) : json(403, asked);
      });
      return state;
    };

    it("asks, then sends a write without a key again once", async () => {
      const state = server();
      const handler = vi.fn(async () => ((state.proved = true), true));
      setStepUpHandler(handler);
      expect(await request("/api/v1/Employee/e1", { method: "PATCH", body: { a: 1 } })).toEqual({ ok: true });
      expect([handler.mock.calls.length, state.calls]).toEqual([1, 2]);
    });

    it("shows one dialog for requests refused together, asked with the refusal (its ways), and all go on after it", async () => {
      const state = server();
      let answer: (ok: boolean) => void = () => {};
      const handler = vi.fn((_refusal: unknown) => new Promise<boolean>((r) => (answer = r)));
      setStepUpHandler(handler);
      const all = Promise.all([request("/api/v1/Employee"), request("/api/v1/Payslip"), request("/api/v1/Employee/e1", { method: "DELETE" })]);
      await new Promise((r) => setTimeout(r, 20));
      expect(handler.mock.calls).toEqual([[asked]]);
      state.proved = true;
      answer(true);
      expect(await all).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
      expect(state.calls).toBe(6);
    });

    it("fails with the server's own message when the person cancels, and does not send again", async () => {
      const state = server();
      setStepUpHandler(async () => false);
      const e = (await request("/api/v1/Employee").catch((x: unknown) => x)) as ApiError;
      expect([e.status, e.code, e.message]).toEqual([403, "step_up", asked.message]);
      expect(state.calls).toBe(1);
    });

    it("asks only once for a request: a second refusal after proving is the answer", async () => {
      const state = server();
      const handler = vi.fn(async () => true);
      setStepUpHandler(handler);
      const e = (await request("/api/v1/Employee").catch((x: unknown) => x)) as ApiError;
      expect(e.code).toBe("step_up");
      expect([handler.mock.calls.length, state.calls]).toEqual([1, 2]);
    });

    it("is the server's refusal where the page has no way to ask", async () => {
      const state = server();
      const e = (await request("/api/v1/Employee").catch((x: unknown) => x)) as ApiError;
      expect([e.code, state.calls]).toEqual(["step_up", 1]);
    });
  });
});
