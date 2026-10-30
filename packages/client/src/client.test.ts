import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeShell, removeFakeShell } from "@ferrum/testing";
import { ApiError, bootstrap, request, routeBase, shell } from "./index";

afterEach(() => {
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
});
