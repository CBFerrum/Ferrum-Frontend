// @vitest-environment jsdom
// Setting up two-factor sign-in from the cookie the sign-in left (API-K2): begin and enable go with the browser's cookie only,
// never a bearer or a token kept by the page; a setup session that has ended sends the person back to sign in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwoFactorSetup } from "./TwoFactor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const reauthenticate = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));
const begun = { secret: "ABCDEFGHIJKLMNOP", uri: "otpauth://totp/x", qr_svg: "<svg xmlns='http://www.w3.org/2000/svg'/>" };

function stub(answers: Record<string, Response>) {
  const calls: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      calls.push({ path, init });
      return answers[path] ?? json(404, { error: "not_found" });
    }),
  );
  return calls;
}
const type = async (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const press = async (name: string) => {
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === name)!.click());
  await flush();
};

beforeEach(() => {
  reauthenticate.mockReset();
  (globalThis as { ferrum?: unknown }).ferrum = { shell: { session: { reauthenticate, signOut: () => {}, on: () => {} } } };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (globalThis as { ferrum?: unknown }).ferrum;
});

describe("setting up two-factor sign-in with the sign-in's cookie", () => {
  it("begins and enables with the cookie alone, keeps nothing, and goes on after the recovery codes", async () => {
    const calls = stub({
      "/api/auth/2fa/begin": json(200, begun),
      "/api/auth/2fa/enable": json(200, { recovery_codes: ["aaaa-bbbb", "cccc-dddd"] }),
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const onEnabled = vi.fn();
    await act(async () => root.render(<TwoFactorSetup onEnabled={onEnabled} />));
    await flush();
    await type("tf-setup-code", "123456");
    await press("Turn on");
    expect(host.textContent).toContain("aaaa-bbbb");
    await act(async () => host.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await press("Continue");
    expect(onEnabled).toHaveBeenCalledWith({ recovery_codes: ["aaaa-bbbb", "cccc-dddd"] });
    expect(calls.map((c) => c.path)).toEqual(["/api/auth/2fa/begin", "/api/auth/2fa/enable"]);
    for (const c of calls) {
      expect(c.init?.credentials).toBe("same-origin");
      expect(new Headers(c.init?.headers).has("authorization")).toBe(false);
    }
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it("sends the person back to sign in, in plain words, when the setup session has ended", async () => {
    stub({ "/api/auth/2fa/begin": json(401, { error: "unauthorized" }) });
    await act(async () => root.render(<TwoFactorSetup onEnabled={() => {}} />));
    await flush();
    expect(reauthenticate).toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Your session has ended. Please sign in again.");
  });
});
