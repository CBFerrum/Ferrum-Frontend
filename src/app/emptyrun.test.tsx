// @vitest-environment jsdom
// Three or more read-only empty fields fold into one line that opens, by click or Enter, to the fields as they are:
// no field is ever unreachable.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { EmptyRun } from "./EmptyRun";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EmptyRun", () => {
  const mount = async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<EmptyRun labels={["Web payment", "Contact email", "Ship to"]}><input aria-label="Web payment" readOnly /><input aria-label="Contact email" readOnly /><input aria-label="Ship to" readOnly /></EmptyRun>));
    return host;
  };

  it("lists the labels on one collapsed line and hides the fields", async () => {
    const host = await mount();
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("Not set: Web payment, Contact email, Ship to");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll("input")).toHaveLength(0);
  });

  it("opens to every field on click and closes again", async () => {
    const host = await mount();
    const button = host.querySelector("button")!;
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect([...host.querySelectorAll("input")].map((i) => i.getAttribute("aria-label"))).toEqual(["Web payment", "Contact email", "Ship to"]);
    await act(async () => button.click());
    expect(host.querySelectorAll("input")).toHaveLength(0);
  });

  it("is a native button, so Enter and Space open it", async () => {
    const host = await mount();
    expect(host.querySelector("button")!.getAttribute("type")).toBe("button");
  });
});
