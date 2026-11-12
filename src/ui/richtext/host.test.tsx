// @vitest-environment jsdom
// What a host surface may ask of the editor: to be part of it (frameless, with content before and after the text), to carry extra
// attributes on pictures, and to keep web pictures in the content without ever requesting them while writing.

import type { Editor } from "@tiptap/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { RichTextEditor } from "./index";
import { sanitizeRichText } from "./sanitize";
import { mount } from "./testMount";

describe("frameless, before and after", () => {
  it("puts the host's content inside the scrolling area around the text, and keeps it out of the value", async () => {
    let value = "<p>x</p>";
    let editor!: Editor;
    const { host, unmount } = await mount(
      <RichTextEditor frameless value={value} onChange={(v) => (value = v)} label="Message" before={<div data-testid="before">Re: plan</div>} after={<div data-testid="after">-- Ana</div>} onEditor={(e) => e && (editor = e)} />,
    );
    const rte = host.querySelector(".rte")!;
    expect(rte.classList.contains("rte-frameless")).toBe(true);
    const scroll = rte.querySelector(".rte-scroll")!;
    expect([...scroll.children].map((c) => (c.querySelector(".ProseMirror") ? "text" : c.className))).toEqual(["rte-before", "text", "rte-after"]);
    expect(scroll.querySelector(".rte-before [data-testid=before]")?.textContent).toBe("Re: plan");
    expect(scroll.querySelector(".rte-after [data-testid=after]")?.textContent).toBe("-- Ana");
    expect(rte.querySelector(".rte-bar")).not.toBeNull(); // the toolbar is still the editor's, above the scrolling area
    await act(async () => void editor.commands.insertContentAt(editor.state.doc.content.size - 1, "y"));
    expect(value).toBe("<p>xy</p>");
    await unmount();
  });

  it("is the same editor as before without them", async () => {
    const { host, unmount } = await mount(<RichTextEditor value="<p>x</p>" label="Message" />);
    expect(host.querySelector(".rte-frameless, .rte-before, .rte-after")).toBeNull();
    await unmount();
  });
});

describe("pictures", () => {
  const html = '<p>a <img src="https://cdn.example/logo.png" alt="Logo" width="120" height="40" data-cid="part-1" data-evil="x" onerror="alert(1)"> b <img src="/files/own.png" alt="Own" data-cid="part-2"></p>';

  it("carries the attributes the host declares through load, editing and getHTML, and no others", async () => {
    let editor!: Editor;
    let value = "";
    const { unmount } = await mount(<RichTextEditor value={html} imageAttributes={["data-cid", "onerror", "src"]} imageSources={["/files/"]} label="Message" onChange={(v) => (value = v)} onEditor={(e) => e && (editor = e)} />);
    const out = editor.getHTML();
    expect(out).toContain('data-cid="part-1"');
    expect(out).toContain('data-cid="part-2"');
    expect(out).not.toMatch(/data-evil|onerror|alert/);
    await act(async () => void editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!"));
    expect(value).toContain('data-cid="part-1"'); // what onChange gives back
    // cleaning at the host's boundary: dropped unless the same names are allowed there, and never a name that is not data-*
    expect(sanitizeRichText(value, { imageSources: ["/files/"] })).not.toContain("data-cid");
    expect(sanitizeRichText(value, { imageSources: ["/files/"], imageAttributes: ["data-cid"] })).toContain('data-cid="part-1"');
    expect(sanitizeRichText('<img src="https://x.example/a.png" onerror="x" title="t">', { imageAttributes: ["onerror", "src", "style", "data-Bad", "data-"] })).toBe('<img src="https://x.example/a.png" title="t">');
    await unmount();
  });

  it("drops them when the host declared none", async () => {
    let editor!: Editor;
    const { unmount } = await mount(<RichTextEditor value={html} imageSources={["/files/"]} label="Message" onEditor={(e) => e && (editor = e)} />);
    expect(editor.getHTML()).not.toContain("data-cid");
    await unmount();
  });

  it("shows web pictures by default", async () => {
    const { host, unmount } = await mount(<RichTextEditor value={html} imageSources={["/files/"]} label="Message" />);
    expect([...host.querySelectorAll(".ProseMirror img:not(.ProseMirror-separator)")].map((i) => i.getAttribute("src"))).toEqual(["https://cdn.example/logo.png", "/files/own.png"]);
    await unmount();
  });

  it("holds web pictures: kept in the content, never requested while writing, a placeholder with the description and size", async () => {
    const requested: string[] = [];
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", { configurable: true, get: desc.get, set(v: string) { requested.push(v); desc.set!.call(this, v); } });
    try {
      let editor!: Editor;
      const { host, unmount } = await mount(<RichTextEditor value={html + '<p><img src="https://other.example/p.png"></p><p><img src="data:image/png;base64,iVBORw0KGgo="></p>'} images="inline" remoteImages="hold" imageAttributes={["data-cid"]} imageSources={["/files/"]} label="Message" onEditor={(e) => e && (editor = e)} />);
      const shown = [...host.querySelectorAll(".ProseMirror img:not(.ProseMirror-separator)")].map((i) => i.getAttribute("src"));
      expect(shown).toEqual(["/files/own.png", "data:image/png;base64,iVBORw0KGgo="]); // only the caller's own and inline pictures are drawn as pictures
      expect(requested.filter((s) => /^(https?:)?\/\//.test(s))).toEqual([]);
      expect(host.innerHTML).not.toMatch(/cdn\.example|other\.example/); // the address is not in the page at all while writing
      const held = host.querySelectorAll(".rte-img-held");
      expect(held).toHaveLength(2);
      expect(held[0]!.getAttribute("aria-label")).toBe("Logo");
      expect(held[0]!.textContent).toContain("120 × 40");
      expect((held[0] as HTMLElement).style.width).toBe("120px");
      expect(held[1]!.getAttribute("aria-label")).toBe("Picture from the web");
      // in the content as it came
      expect(editor.getHTML()).toContain('src="https://cdn.example/logo.png"');
      expect(editor.getHTML()).toContain('src="https://other.example/p.png"');
      expect(editor.getHTML()).toContain('data-cid="part-1"');
      await unmount();
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "src", desc);
    }
  });
});
