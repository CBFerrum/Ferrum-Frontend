// @vitest-environment jsdom
// An app's entry file ends in one call: its routes are drawn at its address, under the platform's toasts and
// confirmations, and not before its own words are in.

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t, wordsReady } from "@ferrum/client";
import { setLanguage } from "../lib/i18n";
import { mountApp } from "./mountApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe("mountApp", () => {
  afterEach(() => {
    setLanguage("en");
    document.body.innerHTML = "";
  });

  it("draws the app's routes at its address once its own words are in, with the toaster", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "/things/list");
    setLanguage("hi");
    let give!: (m: { default: Record<string, string> }) => void;
    const words = new Promise<{ default: Record<string, string> }>((r) => (give = r));
    mountApp({ route: "things", routes: [{ path: "/list", Component: () => <h1>{t("Things")}</h1> }], catalogs: { hi: () => words } });
    await flush();
    const root = document.getElementById("root")!;
    expect(root.innerHTML).toBe("");
    give({ default: { Things: "चीज़ें" } });
    await act(() => wordsReady());
    await flush();
    expect(root.querySelector("h1")?.textContent).toBe("चीज़ें");
    expect(root.querySelector(".toaster[aria-live=polite]")).not.toBeNull();
  });
});
