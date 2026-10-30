import { describe, expect, it } from "vitest";
import { defaultEditor, editorsFor } from "./Drive";
import { docTitle, snippetParts } from "../../lib/livedocs";
import { initials } from "../../lib/format";
import { cleanHref, statusText } from "./LiveDoc";

describe("live documents", () => {
  it("open in the document editor, on phones too", () => {
    const choices = editorsFor({ id: "d1", name: "Plan.FDOC", size: 0 }, { online: true, browser: [] });
    expect(choices).toEqual([{ key: "live", label: "Document editor", to: "/doc/d1" }]);
    expect(defaultEditor(choices, true)?.to).toBe("/doc/d1");
  });

  it("are named without their extension", () => {
    expect([docTitle("Q4 plan.fdoc"), docTitle("notes.FDOC"), docTitle("a.fdoc.txt")]).toEqual(["Q4 plan", "notes", "a.fdoc.txt"]);
    expect([initials("Ana Rao"), initials("  raj  "), initials("Mary Ann de la Cruz"), initials("")]).toEqual(["AR", "R", "MC", "?"]);
  });

  it("show where search found their words", () => {
    expect(snippetParts("Risks · The «venue» may «move»")).toEqual([
      { text: "Risks · The ", hit: false },
      { text: "venue", hit: true },
      { text: " may ", hit: false },
      { text: "move", hit: true },
    ]);
    expect(snippetParts("no markers")).toEqual([{ text: "no markers", hit: false }]);
  });

  it("say whether everything typed is saved", () => {
    const s = { online: true, loaded: true, unsaved: false, closed: false };
    expect(statusText(s)).toBe("Saved");
    expect(statusText({ ...s, unsaved: true })).toBe("Saving…");
    expect(statusText({ ...s, online: false })).toBe("Reconnecting…");
    expect(statusText({ ...s, online: false, unsaved: true })).toMatch(/^Offline: your changes are kept in this tab/);
    expect(statusText({ ...s, loaded: false })).toBe("Opening…");
    expect(statusText({ ...s, closed: true })).toBe("Not connected");
  });

  it("link only to the web and to mail", () => {
    expect(cleanHref("example.com/a")).toBe("https://example.com/a");
    expect(cleanHref(" https://x.test ")).toBe("https://x.test");
    expect(cleanHref("ana@acme.test")).toBe("mailto:ana@acme.test");
    expect(cleanHref("mailto:ana@acme.test")).toBe("mailto:ana@acme.test");
    expect(cleanHref("javascript:alert(1)")).toBeNull();
    expect(cleanHref("data:text/html,x")).toBeNull();
    expect(cleanHref("  ")).toBeNull();
  });
});
