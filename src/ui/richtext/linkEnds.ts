// A link ends where its words end. Two causes in @tiptap/extension-link 3.32, both fixed here without touching its code:
//
// 1. `Link.inclusive()` returns its `autolink` option, so with autolink on (ours) the mark is inclusive: whatever is typed at a
//    link's end, a full stop or a letter, joins the link (3.32's `unlinkTrailingWhitespace` only takes back a space). The mark's
//    schema spec is set to `inclusive: false` once the editor exists, which holds for links made by autolink, by paste (the
//    pasted range is marked, the caret after it is outside) and by the link dialog.
// 2. Autolink (helpers/autolink.ts) links the last word when a space is typed, but only if `tokenize(word)` is exactly one link
//    (`isValidLinkStructure`); "https://example.com." is a link and a full stop, two tokens, so a sentence ending in an address
//    was never linked. `linkBeforePunctuation` does that case: an address that starts with a scheme or `www.`, followed by closing
//    punctuation, then the space: the address is linked, the punctuation is not. (Bare "example.com." stays unlinked, as it was:
//    without a scheme nothing tells "Mr.Smith." from an address.)

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { safeHref } from "./sanitize";

const PUNCT = "[.,;:!?)\\]}'\"»”’…]";
const ADDRESS = new RegExp(`(?:^|[\\s(\\[])((?:https?://|www\\.)[^\\s]*?[^\\s.,;:!?)\\]}'"»”’…])(${PUNCT}+)\\s$`, "iu");

export const LinkEnds = Extension.create({
  name: "linkEnds",
  onCreate() {
    const link = this.editor.schema.marks.link;
    if (link) link.spec.inclusive = false;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkBeforePunctuation"),
        appendTransaction: (transactions, _old, state) => {
          const link = state.schema.marks.link;
          const { $from, empty } = state.selection;
          if (!link || !empty || transactions.some((t) => t.getMeta("preventAutolink") || !t.docChanged)) return null;
          // Only when a space (or any white space) was just typed.
          const typed = transactions.flatMap((t) => t.steps).some((s) => s instanceof ReplaceStep && /\s$/.test(s.slice.content.textBetween(0, s.slice.content.size, "\ufffc", "\ufffc")));
          if (!typed || !$from.parent.isTextblock) return null;
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
          const m = ADDRESS.exec(before);
          const href = m && safeHref(m[1]!);
          if (!m || !href) return null;
          const end = $from.pos - 1 - m[2]!.length;
          const start = end - m[1]!.length;
          if (state.doc.rangeHasMark(start, end, link) || (state.schema.marks.code && state.doc.rangeHasMark(start, end, state.schema.marks.code))) return null;
          return state.tr.addMark(start, end, link.create({ href }));
        },
      }),
    ];
  },
});
