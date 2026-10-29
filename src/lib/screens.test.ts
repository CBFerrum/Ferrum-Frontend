import { describe, expect, it, vi } from "vitest";
import { screenMayCall, screenUrl, serveScreen, type ScreenHost } from "./screens";

describe("screens", () => {
  it("are served under the workspace, app and version", () => {
    expect(screenUrl("acme corp", { app: "board", version: "1.0.0", entry: "ui/pages/board view.html" })).toBe("/api/ext-ui/acme%20corp/board/1.0.0/pages/board%20view.html");
  });

  it("call records, metadata and their own endpoints only", () => {
    for (const p of ["/api/v1/Customer", "/api/meta/Customer", "/api/meta/contributions/ui.page", "/api/ext/board/cards"]) expect(screenMayCall("board", p), p).toBe(true);
    for (const p of [
      "/api/admin/users",
      "/api/auth/me",
      "/api/ext/other/x",
      "/api/ext/boardx/x",
      "/api/v1/../admin/users",
      "/api/v1/Customer?limit=1",
      "/api/v1//x",
      "/api/v1/",
      "https://evil.example/api/v1/x",
      "//evil.example/api/v1/x",
    ])
      expect(screenMayCall("board", p), p).toBe(false);
  });

  it("answer requests over their port", async () => {
    const calls: unknown[] = [];
    const host: ScreenHost = {
      app: "board",
      context: () => ({ app: "board", slot: "ui.page", user: { email: "ann@acme.test", name: "Ann" }, locale: "en", theme: { mode: "light", tokens: {} } }),
      call: async (r) => {
        calls.push(r);
        return { rows: [] };
      },
      navigate: vi.fn(),
      toast: vi.fn(),
      confirm: async () => true,
      resize: vi.fn(),
    };
    const { port1, port2 } = new MessageChannel();
    const bridge = serveScreen(port1, host);
    const replies = new Map<number, { result?: unknown; error?: { status: number; message: string } }>();
    const events: unknown[] = [];
    port2.onmessage = (e: MessageEvent) => (typeof e.data.id === "number" ? replies.set(e.data.id, e.data) : events.push(e.data));
    const ask = (id: number, method: string, params?: unknown) => port2.postMessage({ id, method, params });
    ask(1, "context");
    ask(2, "api", { path: "/api/v1/Customer", query: { limit: 5, nested: { x: 1 } } });
    ask(3, "api", { path: "/api/admin/users" });
    ask(4, "api", { path: "/api/v1/Customer", method: "TRACE" });
    ask(5, "navigate", { to: "https://evil.example" });
    ask(6, "openRecord", { entity: "Customer", id: "a/b" });
    ask(7, "resize", { height: 99999 });
    ask(8, "confirm", { title: "Sure?" });
    ask(9, "toast", { message: "Saved", tone: "nonsense" });
    ask(10, "nope");
    port2.postMessage("not a request");
    bridge.emit("theme", { mode: "dark" });
    await vi.waitFor(() => expect(replies.size).toBe(10));
    expect((replies.get(1)?.result as { user: { email: string } }).user.email).toBe("ann@acme.test");
    expect(calls).toEqual([{ method: "GET", path: "/api/v1/Customer", query: { limit: "5" }, body: undefined }]);
    expect(replies.get(2)?.result).toEqual({ rows: [] });
    expect(replies.get(3)?.error).toEqual({ status: 403, message: "screens of board may not call /api/admin/users" });
    expect(replies.get(4)?.error?.status).toBe(400);
    expect(replies.get(5)?.error?.status).toBe(400);
    expect(host.navigate).toHaveBeenCalledTimes(1);
    expect(host.navigate).toHaveBeenCalledWith("/e/Customer/a%2Fb");
    expect(host.resize).toHaveBeenCalledWith(4000);
    expect(replies.get(8)?.result).toBe(true);
    expect(host.toast).toHaveBeenCalledWith("Saved", "success");
    expect(replies.get(10)?.error?.message).toBe("unknown method nope");
    expect(events).toEqual([{ event: "theme", data: { mode: "dark" } }]);
    bridge.close();
    port2.close();
  });
});
