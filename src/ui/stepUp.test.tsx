// @vitest-environment jsdom
// Asking again, everywhere: a 403 `step_up` (crates/kernel/src/controls.rs `needed()`) opens one "confirm it is you" dialog, which
// offers the ways the refusal lists (or `GET /api/auth/step-up/ways` gives a page that opens it itself): a passkey, the password (and
// the code when the server asks for it), signing in again with the identity provider in a small window (server/src/controllers/auth.rs
// `step_up`, `step_up_passkey`, `step_up_provider`, `step_up_provider_finish`); then the refused request goes on once. Request and
// answer shapes from server/tests/controls_it.rs and the bar's own dialog (server/shell/runtime.js).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setUnauthorizedHandler } from "../lib/api";
import { violations } from "../test/axe";
import { ConfirmHost, ConfirmItsYou } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  // jsdom has no showModal: it only has to set `open`.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Channel.all = [];
  delete (navigator as { credentials?: unknown }).credentials;
  setUnauthorizedHandler(() => {});
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const asked = { error: "step_up", message: "confirm it is you: enter your password again to do this" };
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));
const type = async (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const field = (kind: "password" | "code") => host.querySelector<HTMLInputElement>(kind === "password" ? "input[type=password]" : "input[autocomplete=one-time-code]");
const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === name);
const click = async (name: string) => {
  await act(async () => button(name)!.click());
  await flush();
};
const confirm = () => click("Confirm");
const said = () => host.querySelector("[role=alert]")?.textContent;

type Body = Record<string, unknown> | undefined;
const PROOFS = ["/api/auth/step-up", "/api/auth/step-up/passkey", "/api/auth/step-up/provider/finish"];
/** The platform's side: the step-up routes answered by `routes` (by path, given the body sent); every other request is refused with
 *  `refusal` until a proof is accepted. Each request is logged, and each body kept by path. */
function server(refusal: unknown, routes: Record<string, (body: Body) => Response | Promise<Response>>) {
  const log: string[] = [];
  const bodies: Record<string, Body[]> = {};
  let proved = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    log.push(`${init.method ?? "GET"} ${url}`);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Body) : undefined;
    (bodies[url] ??= []).push(body);
    if (!routes[url]) return proved ? json(200, { rows: [] }) : json(403, refusal);
    const res = await routes[url](body);
    if (res.ok && PROOFS.includes(url)) proved = true;
    return res;
  });
  return { log, bodies };
}
/** Reads of Employee are refused until the password post is accepted. */
const platform = (check: (body: { password: string; code?: string }) => Response) => server(asked, { "/api/auth/step-up": (b) => check(b as { password: string; code?: string }) }).log;
const ways = (...listed: unknown[]) => ({ error: "step_up", message: "confirm it is you to do this", ways: listed });

/** A browser that can use passkeys; `get` is the device's answer. */
function webauthn(get: (o: CredentialRequestOptions) => Promise<unknown>) {
  vi.stubGlobal("PublicKeyCredential", class {});
  vi.stubGlobal("isSecureContext", true);
  const device = vi.fn(get);
  Object.defineProperty(navigator, "credentials", { value: { get: device }, configurable: true });
  return device;
}
const bytes = (...b: number[]) => Uint8Array.from(b).buffer;
const offer = { request: "0195b6d8-7c2e-7000-8000-00000000c0de", publicKey: { challenge: "AAEC", rpId: "localhost", userVerification: "required", timeout: 120000, allowCredentials: [{ type: "public-key", id: "AwQF", transports: ["internal"] }] } };
const credential = { id: "BgcI", rawId: bytes(6, 7, 8), type: "public-key", response: { clientDataJSON: bytes(9, 10, 11), authenticatorData: bytes(12, 13, 14), signature: bytes(15, 16, 17), userHandle: bytes(18, 19, 20) } };

/** The "ferrum-step-up" channels the page opened; `post` delivers a message as the window's last page (or anyone) would send it. */
class Channel {
  static all: Channel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    Channel.all.push(this);
  }
  close() {
    this.closed = true;
  }
  post(data: unknown, origin = location.origin) {
    act(() => this.onmessage?.({ data, origin } as MessageEvent));
  }
}
/** The small window the provider's way opens, and what is done to it; `log` gets its opening in order with the requests. */
function popup(log: string[]) {
  vi.stubGlobal("BroadcastChannel", Channel);
  const win = { closed: false, opener: {} as unknown, location: { replace: vi.fn() }, close: vi.fn(() => void (win.closed = true)) };
  vi.spyOn(window, "open").mockImplementation((...args) => (log.push(`open ${args.join(" ")}`), win as unknown as Window));
  return win;
}
const proof = { state: "su.AbCdEf0123456789-_xyz", code: "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5" };

describe("the confirm-it-is-you dialog", () => {
  it("asks once for requests refused together, takes the password, and they go on", async () => {
    const log = platform((b) => (b.password === "right" ? new Response(null, { status: 204 }) : json(401, { error: "unauthorized", message: "wrong password" })));
    await act(async () => root.render(<ConfirmHost />));
    const both = Promise.all([api.get("/api/v1/Employee"), api.get("/api/v1/Payslip")]);
    await flush();
    expect(host.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(host.textContent).toContain("To continue, confirm it is you.");
    expect(await violations(host.innerHTML)).toEqual([]);
    await type(field("password")!.id, "right");
    await confirm();
    expect(await both).toEqual([{ rows: [] }, { rows: [] }]);
    expect(log.filter((l) => l === "POST /api/auth/step-up")).toHaveLength(1);
    expect(host.querySelector("dialog[open]")).toBeNull();
  });

  it("shows the server's refusal in place, keeps the request waiting, and asks for the code when the server does", async () => {
    platform((b) =>
      !b.password.startsWith("right") ? json(401, { error: "unauthorized", message: "wrong password" })
      : !b.code ? json(422, { error: "invalid", message: "Please check your input.", fields: [{ field: "code", message: "the code from your authenticator app is needed" }] })
      : new Response(null, { status: 204 }),
    );
    await act(async () => root.render(<ConfirmHost />));
    const read = api.get("/api/v1/Employee");
    await flush();
    await type(field("password")!.id, "wrong");
    await confirm();
    expect(host.textContent).toContain("wrong password");
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    await type(field("password")!.id, "right");
    await confirm();
    expect(field("code")).not.toBeNull();
    expect(host.textContent).toContain("the code from your authenticator app is needed");
    await type(field("code")!.id, "123456");
    await confirm();
    expect(await read).toEqual({ rows: [] });
  });

  it("fails the request with the server's message when the person cancels", async () => {
    const log = platform(() => new Response(null, { status: 204 }));
    await act(async () => root.render(<ConfirmHost />));
    const read = api.get("/api/v1/Employee").catch((e: Error) => e.message);
    await flush();
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click());
    expect(await read).toBe(asked.message);
    expect(log).toEqual(["GET /api/v1/Employee"]);
  });
});

describe("the ways to confirm it is you", () => {
  const open = async () => {
    await act(async () => root.render(<ConfirmHost />));
    const read = api.get("/api/v1/Employee").catch((e: Error) => e.message);
    await flush();
    return { read };
  };
  const controls = () => [...host.querySelectorAll("form :is(button, input), form > p")].map((el) => (el instanceof HTMLInputElement ? `${el.type} field` : el.textContent));

  it("are offered in the server's order, the first to hand, and a passkey only where the browser can use one", async () => {
    webauthn(async () => null);
    server(ways({ way: "provider", name: " Okta " }, { way: "password", code: false }, { way: "passkey" }, { way: "telepathy" }, { way: "password", code: true }), {});
    await open();
    expect(controls()).toEqual(["Sign in again with Okta", "Or", "password field", "Or", "Use a passkey"]);
    expect(document.activeElement).toBe(button("Sign in again with Okta"));
    expect([button("Sign in again with Okta")!.className.includes("btn-primary"), button("Confirm")!.className.includes("btn-primary")]).toEqual([true, false]);
    expect(await violations(host.innerHTML)).toEqual([]);
    act(() => root.unmount());
    vi.unstubAllGlobals();
    root = createRoot(host);
    server(ways({ way: "passkey" }, { way: "password", code: false }), {});
    await open();
    expect(controls()).toEqual(["password field"]);
  });

  it("offer just the one the person has", async () => {
    server(ways({ way: "provider", name: "Okta" }), {});
    await open();
    expect(controls()).toEqual(["Sign in again with Okta"]);
    expect([...host.querySelectorAll("footer button")].map((b) => b.textContent)).toEqual(["Cancel"]);
  });

  it("are none: the server's message, no form, and the request gets the refusal", async () => {
    const none = { error: "step_up", message: "you have no way to confirm it is you here: ask an administrator to set up a password, a passkey or single sign-on for you", ways: [] };
    const { log } = server(none, {});
    const { read } = await open();
    expect(controls()).toEqual([]);
    expect(host.querySelector(".dialog-description")?.textContent).toBe(none.message);
    expect([...host.querySelectorAll("footer button")].map((b) => b.textContent)).toEqual(["Close"]);
    expect(document.activeElement).toBe(button("Close"));
    await click("Close");
    expect(await read).toBe(none.message);
    expect(log).toEqual(["GET /api/v1/Employee"]);
  });

  it("are none where the only one is a passkey this browser cannot use, and the dialog says so", async () => {
    server(ways({ way: "passkey" }), {});
    const { read } = await open();
    expect(controls()).toEqual([]);
    expect(host.textContent).toContain("This browser cannot use a passkey, your only way to confirm it is you here.");
    await click("Close");
    expect(await read).toBe("confirm it is you to do this");
  });

  it("ask for the authenticator's code at once when the server lists the password with it", async () => {
    const { bodies } = server(ways({ way: "password", code: true }), { "/api/auth/step-up": () => new Response(null, { status: 204 }) });
    const { read } = await open();
    await type(field("password")!.id, "right");
    await type(field("code")!.id, " 123456 ");
    await confirm();
    expect(await read).toEqual({ rows: [] });
    expect(bodies["/api/auth/step-up"]).toEqual([{ password: "right", code: "123456" }]);
  });

  it("with a passkey: the server's challenge goes to the device decoded, and its answer back encoded", async () => {
    const device = webauthn(async () => credential);
    const { log, bodies } = server(ways({ way: "passkey" }, { way: "password", code: false }), {
      "/api/auth/step-up/passkey/options": () => json(200, offer),
      "/api/auth/step-up/passkey": () => new Response(null, { status: 204 }),
    });
    const { read } = await open();
    expect(document.activeElement).toBe(button("Use a passkey"));
    await click("Use a passkey");
    expect(await read).toEqual({ rows: [] });
    expect(log).toEqual(["GET /api/v1/Employee", "POST /api/auth/step-up/passkey/options", "POST /api/auth/step-up/passkey", "GET /api/v1/Employee"]);
    expect(bodies["/api/auth/step-up/passkey/options"]).toEqual([undefined]);
    const asked = device.mock.calls[0][0];
    const pk = asked.publicKey!;
    expect([[...(pk.challenge as Uint8Array)], [...(pk.allowCredentials![0].id as Uint8Array)], pk.rpId, pk.userVerification, pk.timeout, pk.allowCredentials![0].transports]).toEqual([[0, 1, 2], [3, 4, 5], "localhost", "required", 120000, ["internal"]]);
    expect(asked.signal).toBeInstanceOf(AbortSignal);
    expect(bodies["/api/auth/step-up/passkey"]).toEqual([
      { request: offer.request, credential: { id: "BgcI", rawId: "BgcI", type: "public-key", response: { clientDataJSON: "CQoL", authenticatorData: "DA0O", signature: "DxAR", userHandle: "EhMU" } } },
    ]);
    expect(host.querySelector("dialog[open]")).toBeNull();
  });

  it("with a passkey the person cancels: the others wait meanwhile, then it says so and every way is usable again", async () => {
    let refuse: (e: unknown) => void = () => {};
    const device = webauthn(() => new Promise((_, no) => (refuse = no)));
    const { log } = server(ways({ way: "passkey" }, { way: "password", code: false }), { "/api/auth/step-up/passkey/options": () => json(200, offer) });
    await open();
    await act(async () => {
      button("Use a passkey")!.click();
      button("Use a passkey")!.click();
    });
    await flush();
    expect(device).toHaveBeenCalledTimes(1);
    expect([field("password")!.disabled, button("Confirm")!.disabled, button("Use a passkey")!.getAttribute("aria-busy")]).toEqual([true, true, "true"]);
    await act(async () => refuse(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError")));
    await flush();
    expect(said()).toBe("No passkey was used.");
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    expect([field("password")!.disabled, button("Confirm")!.disabled, button("Use a passkey")!.disabled]).toEqual([false, false, false]);
    expect(document.activeElement).toBe(button("Use a passkey"));
    expect(log).toEqual(["GET /api/v1/Employee", "POST /api/auth/step-up/passkey/options"]);
  });

  it("signing in again: a window the click opens, a proof taken only for this dialog, then the request goes on", async () => {
    const { log, bodies } = server(ways({ way: "provider", name: "Okta" }), {
      "/api/auth/step-up/provider": () => json(200, { url: "https://idp.example/authorize?state=su.x" }),
      "/api/auth/step-up/provider/finish": () => new Response(null, { status: 204 }),
    });
    const win = popup(log);
    const { read } = await open();
    await act(async () => {
      button("Sign in again with Okta")!.click();
      button("Sign in again with Okta")!.click();
    });
    await flush();
    // The window first, before anything is awaited (the click is what lets a page open one), cut off from this page.
    expect(log).toEqual(["GET /api/v1/Employee", "open about:blank ferrum-step-up popup,width=520,height=680", "POST /api/auth/step-up/provider"]);
    expect(win.opener).toBeNull();
    const dialog = bodies["/api/auth/step-up/provider"][0]!.dialog as string;
    expect(dialog).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(win.location.replace).toHaveBeenCalledWith("https://idp.example/authorize?state=su.x");
    expect(host.textContent).toContain("Finish signing in again in the window that opened.");
    const [channel] = Channel.all;
    expect([Channel.all.length, channel.name]).toEqual([1, "ferrum-step-up"]);
    channel.post({ ...proof, dialog: "another-dialogs-value-0123" });
    channel.post({ ...proof, dialog }, "https://evil.example");
    channel.post({ ...proof, dialog, code: "<script>alert(1)</script>" });
    channel.post({ ...proof });
    await flush();
    expect(log.filter((l) => l.endsWith("/finish"))).toEqual([]);
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    channel.post({ ...proof, dialog });
    await flush();
    expect(await read).toEqual({ rows: [] });
    expect(bodies["/api/auth/step-up/provider/finish"]).toEqual([proof]);
    expect([channel.closed, host.querySelector("dialog[open]")]).toEqual([true, null]);
  });

  it("signing in again: a blocked window is said, and the dialog stays", async () => {
    const { log } = server(ways({ way: "provider", name: "Okta" }), {});
    vi.stubGlobal("BroadcastChannel", Channel);
    vi.spyOn(window, "open").mockReturnValue(null);
    await open();
    await click("Sign in again with Okta");
    expect(said()).toBe("The window was blocked. Allow pop-ups for this site, then try again.");
    expect([log, Channel.all, button("Sign in again with Okta")!.disabled]).toEqual([["GET /api/v1/Employee"], [], false]);
    expect(host.querySelector("dialog[open]")).not.toBeNull();
  });

  const signingIn = () =>
    server(ways({ way: "provider", name: "Okta" }), {
      "/api/auth/step-up/provider": () => json(200, { url: "https://idp.example/authorize" }),
      "/api/auth/step-up/provider/finish": () => new Response(null, { status: 204 }),
    });

  it("signing in again: a closed window is said, never taken for a proof, and a proof that still comes is taken", async () => {
    const { log, bodies } = signingIn();
    const win = popup(log);
    const { read } = await open();
    await click("Sign in again with Okta");
    win.closed = true;
    await act(() => new Promise((r) => setTimeout(r, 800)));
    expect(said()).toBe("If you closed the window before signing in again, try again.");
    expect([host.querySelector("dialog[open]") !== null, log.filter((l) => l.endsWith("/finish"))]).toEqual([true, []]);
    Channel.all[0].post({ ...proof, dialog: bodies["/api/auth/step-up/provider"][0]!.dialog });
    await flush();
    expect(await read).toEqual({ rows: [] });
  });

  it("signing in again: closing the dialog closes the channel and the window, and nothing comes through after", async () => {
    const { log, bodies } = signingIn();
    const win = popup(log);
    const { read } = await open();
    await click("Sign in again with Okta");
    const [channel] = Channel.all;
    await click("Cancel");
    expect(await read).toBe("confirm it is you to do this");
    expect([channel.closed, win.close.mock.calls.length]).toEqual([true, 1]);
    channel.post({ ...proof, dialog: bodies["/api/auth/step-up/provider"][0]!.dialog });
    await flush();
    expect(log.filter((l) => l.endsWith("/finish"))).toEqual([]);
  });

  it("sends one proof however often it is asked to, and the other ways wait meanwhile", async () => {
    let answer: (r: Response) => void = () => {};
    const { log } = server(ways({ way: "password", code: false }, { way: "provider", name: "Okta" }), { "/api/auth/step-up": () => new Promise<Response>((r) => (answer = r)) });
    const { read } = await open();
    await type(field("password")!.id, "right");
    const form = host.querySelector("dialog[open] form")!;
    await act(async () => {
      button("Confirm")!.click();
      button("Confirm")!.click();
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(log.filter((l) => l === "POST /api/auth/step-up")).toHaveLength(1);
    expect([button("Confirm")!.disabled, button("Sign in again with Okta")!.disabled]).toEqual([true, true]);
    await act(async () => answer(new Response(null, { status: 204 })));
    expect(await read).toEqual({ rows: [] });
    expect(log.filter((l) => l === "POST /api/auth/step-up")).toHaveLength(1);
  });

  it("are asked of the server by a page that opens the dialog itself, and a 401 there is the dialog's answer, not an ended session", async () => {
    const ended = vi.fn();
    setUnauthorizedHandler(ended);
    const { log } = server(null, {
      "/api/auth/step-up/ways": () => json(200, { ways: [{ way: "password", code: false }, { way: "provider", name: "Okta" }] }),
      "/api/auth/step-up": () => json(401, { error: "unauthorized", message: "wrong password" }),
    });
    const onDone = vi.fn();
    await act(async () => root.render(<ConfirmItsYou open onClose={() => {}} onDone={onDone} message="Changing how you sign in needs you to confirm it is you." />));
    await flush();
    expect(log).toEqual(["GET /api/auth/step-up/ways"]);
    expect(controls()).toEqual(["password field", "Or", "Sign in again with Okta"]);
    expect(host.textContent).toContain("Changing how you sign in needs you to confirm it is you.");
    expect(document.activeElement).toBe(field("password"));
    await type(field("password")!.id, "wrong");
    await confirm();
    expect(said()).toBe("wrong password");
    expect([ended.mock.calls.length, onDone.mock.calls.length]).toEqual([0, 0]);
    expect(document.activeElement).toBe(field("password"));
  });

  it("are the password, as before, where the server cannot say (an older one without the route)", async () => {
    const { log } = server(null, { "/api/auth/step-up/ways": () => json(404, { error: "not_found", message: "no such address" }) });
    await act(async () => root.render(<ConfirmItsYou open onClose={() => {}} onDone={() => {}} />));
    await flush();
    expect([log, controls()]).toEqual([["GET /api/auth/step-up/ways"], ["password field"]]);
  });
});
