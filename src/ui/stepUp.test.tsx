// @vitest-environment jsdom
// Asking again, everywhere: a 403 `step_up` (crates/kernel/src/controls.rs `needed()`) opens one "confirm it is you" dialog, which
// posts to /api/auth/step-up (password, and the code when the server asks for it: server/src/controllers/auth.rs `step_up`),
// and the refused request goes on once. Request and answer shapes from server/tests/controls_it.rs.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { violations } from "../test/axe";
import { ConfirmHost } from "./kit";

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
const confirm = async () => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Confirm")!;
  await act(async () => button.click());
  await flush();
};

/** The platform's side: reads of Employee are refused until the step-up post is accepted. */
function platform(check: (body: { password: string; code?: string }) => Response) {
  const log: string[] = [];
  let proved = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    log.push(`${init.method ?? "GET"} ${url}`);
    if (url === "/api/auth/step-up") {
      const res = check(JSON.parse(init.body as string));
      if (res.ok) proved = true;
      return res;
    }
    return proved ? json(200, { rows: [] }) : json(403, asked);
  });
  return log;
}

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
