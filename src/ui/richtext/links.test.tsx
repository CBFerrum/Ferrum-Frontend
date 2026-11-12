// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { RichTextEditor } from "./index";

async function mount(ui: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(ui));
  for (let i = 0; i < 400 && !host.querySelector(".ProseMirror"); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
  await act(() => new Promise((r) => setTimeout(r, 20)));
  return { host, unmount: () => act(() => root.unmount()) };
}

/** Typing as the browser delivers it: each character goes to the text-input handlers first (input rules, ours), else is inserted at the caret. */
async function type(editor: Editor, text: string) {
  for (const ch of text) {
    await act(async () => {
      const { view } = editor;
      const { from, to } = view.state.selection;
      if (!view.someProp("handleTextInput", (f) => f(view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to));
    });
  }
}

const html = (e: Editor) => e.getHTML();
const linked = (e: Editor) => [...new DOMParser().parseFromString(e.getHTML(), "text/html").querySelectorAll("a")].map((a) => a.textContent);

// jsdom draws nothing: ProseMirror asks for rectangles when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

async function written(text: string, start = "") {
  let editor!: Editor;
  const { unmount } = await mount(<RichTextEditor value={start} label="Message" onEditor={(e) => (editor = e)} />);
  await act(async () => void editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  await type(editor, text);
  return { editor, unmount };
}

describe("links end where their words end", () => {
  it("leaves a full stop, a space and a word after an address out of the link", async () => {
    const a = await written("see https://example.com. Next");
    expect(linked(a.editor)).toEqual(["https://example.com"]);
    expect(html(a.editor)).toContain("</a>. Next");
    await a.unmount();
    const b = await written("see https://example.com Next");
    expect(linked(b.editor)).toEqual(["https://example.com"]);
    expect(html(b.editor)).toContain("</a> Next");
    await b.unmount();
    const c = await written("(see www.example.com/a?b=1, then) ok");
    expect(linked(c.editor)).toEqual(["www.example.com/a?b=1"]);
    await c.unmount();
  });

  it("does not take what is typed at the end of a link made by autolink, paste or the dialog into the link", async () => {
    // autolink, then the space taken back: the caret is at the link's end
    const a = await written("go https://example.com ");
    await act(async () => void a.editor.commands.deleteRange({ from: a.editor.state.selection.from - 1, to: a.editor.state.selection.from }));
    await type(a.editor, ".x");
    expect(linked(a.editor)).toEqual(["https://example.com"]);
    await a.unmount();
    // the link dialog's way: text inserted with the mark, then typing
    const b = await written("", "<p>hi </p>");
    await act(async () => void b.editor.chain().insertContent({ type: "text", text: "plan", marks: [{ type: "link", attrs: { href: "https://example.com/plan" } }] }).run());
    await type(b.editor, "ning.");
    expect(linked(b.editor)).toEqual(["plan"]);
    await b.unmount();
    // paste: pasted HTML holding a link goes in as content with the mark (jsdom has no ClipboardEvent to paste with), then typing after it
    const c = await written("", "<p>x</p>");
    await act(async () => void c.editor.commands.insertContent('<a href="https://example.com/p">p</a>'));
    await type(c.editor, ".");
    expect(linked(c.editor)).toEqual(["p"]);
    await c.unmount();
  });

  it("still takes typing inside a link's words into the link", async () => {
    const a = await written("", '<p><a href="https://example.com">plan</a></p>');
    await act(async () => void a.editor.commands.setTextSelection(3));
    await type(a.editor, "Z");
    expect(linked(a.editor)).toEqual(["plZan"]);
    await a.unmount();
  });
});
