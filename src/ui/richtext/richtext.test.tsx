// @vitest-environment jsdom
// Rich text: the allow-list against hostile input, the plain-text form, merge-field tokens, the paste tidy-up, the editor's toolbar
// following the selection, merge fields round-tripping through the editor, and the editor's code staying out of what imports the kit.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { violations } from "../../test/axe";
import { RichText, RichTextEditor } from "./index";
import { cleanColor, cleanFontFamily, cleanFontSize, isRichTextEmpty, mergeChips, plainToRichText, resolveMergeFields, richTextToPlain, safeHref, sanitizeRichText, tidyPastedHtml } from "./sanitize";

describe("sanitizeRichText", () => {
  it("keeps what the editor writes, and gives clean HTML back unchanged", () => {
    const html =
      '<h2 dir="auto">Title</h2><p dir="auto" style="text-align: center">A <strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <span style="color: #c5221f; font-size: 18px; font-family: Georgia, serif">c</span> <mark data-color="#fff475" style="background-color: #fff475">m</mark> <code>x</code></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul><ol start="3"><li><p>n</p></li></ol><blockquote><p>q</p></blockquote><pre><code>code</code></pre><table><tbody><tr><th colspan="2"><p>h</p></th></tr></tbody></table><hr><p><a href="https://example.com/?a=1&amp;b=2" target="_blank">link</a> <img src="https://example.com/a.png" alt="Logo" width="120"></p>';
    const out = sanitizeRichText(html);
    for (const kept of ['<h2 dir="auto">', "text-align: center", "color: #c5221f; font-size: 18px; font-family: Georgia, serif", 'data-color="#fff475"', 'data-type="taskList"', 'data-checked="true"', 'start="3"', 'colspan="2"', "<hr>", 'target="_blank"', 'rel="noopener noreferrer nofollow"', 'src="https://example.com/a.png"', 'width="120"']) {
      expect(out, kept).toContain(kept);
    }
    expect(sanitizeRichText(out)).toBe(out);
  });

  it("refuses hostile input", () => {
    const hostile: [string, RegExp][] = [
      ["<p>a<script>alert(1)</script>b</p>", /script|alert/i],
      ['<img src=x onerror="alert(1)">', /onerror|<img/i],
      ['<a href="javascript:alert(1)">x</a>', /javascript|href/i],
      ['<a href=" JaVaScRiPt:alert(1)">x</a>', /alert/i],
      ['<a href="&#106;avascript:alert(1)">x</a>', /alert/i],
      ['<a href="vbscript:x">x</a>', /vbscript/i],
      ['<a href="data:text/html,<b>x</b>">x</a>', /data:/i],
      ['<img src="data:image/png;base64,AAAA">', /data:/i],
      ['<img src="http://tracker.example/p.gif">', /tracker/i],
      ['<img src="/api/admin/export">', /api\/admin/i],
      ['<p style="background-image: url(https://evil.example/x)">x</p>', /url\(|style/i],
      ['<p style="color: red; background: url(x)">x</p>', /background|url/i],
      ['<p style="color: expression(alert(1))">x</p>', /expression/i],
      ['<p style="position: fixed; inset: 0; z-index: 9999">x</p>', /position|z-index/i],
      ['<p style="font-family: x}</style><script>alert(1)</script>">x</p>', /<script/i],
      ['<span style="font-size: 900px">x</span>', /900/],
      ['<p class="hero" id="main" data-x="1" onclick="x()">x</p>', /class|id=|data-x|onclick/i],
      ["<style>p{color:red}</style><p>x</p>", /color:red|<style/i],
      ['<iframe src="https://evil.example"></iframe>', /iframe/i],
      ["<svg><script>alert(1)</script></svg>", /alert|svg/i],
      ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', /javascript/i],
      ['<form action="https://evil.example"><input name=p><button>go</button></form>', /form|input|button/i],
      ['<object data="x.swf"></object><embed src="x">', /object|embed/i],
      ['<base href="https://evil.example/"><meta http-equiv="refresh" content="0">', /base|refresh/i],
      ['<p dir="rtl;color:red">x</p>', /color/i],
      ['<ol type="disc" start="-1"><li>x</li></ol>', /disc|start/i],
      ['<td colspan="100000">x</td>', /100000/],
      ["<!-- <img src=x onerror=alert(1)> --><p>x</p>", /onerror|<!--/i],
      ['<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>', /onerror/i],
      ['<a href="https://ok.example" target="_top">x</a>', /_top/],
      ['<mark data-color="red;background:url(x)">x</mark>', /url/i],
      ['<li data-type="evil">x</li>', /evil/],
    ];
    for (const [input, banned] of hostile) expect(sanitizeRichText(input), input).not.toMatch(banned);
    expect(sanitizeRichText('<p style="color: red; background: url(x)">x</p>')).toBe('<p style="color: #ff0000">x</p>');
    expect(sanitizeRichText("<p>a<blink>b</blink>c</p>")).toBe("<p>abc</p>");
  });

  it("keeps data images only when asked, and the caller's own picture addresses", () => {
    const img = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    expect(sanitizeRichText(img)).toBe("");
    expect(sanitizeRichText(img, { inlineImages: true })).toContain("data:image/png");
    expect(sanitizeRichText('<img src="/files/abc">', { imageSources: ["/files/"] })).toContain('src="/files/abc"');
    expect(sanitizeRichText('<img src="//evil.example/files/abc">', { imageSources: ["/files/"] })).toBe("");
  });

  it("writes a check list for mail as ☑ and ☐ lines, and drops targets", () => {
    const out = sanitizeRichText('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>a</p></li><li data-type="taskItem" data-checked="false"><p>b</p></li></ul><p><a href="https://x.example" target="_blank">x</a></p>', { mail: true });
    expect(out).toContain("☑ a");
    expect(out).toContain("☐ b");
    expect(out).not.toMatch(/data-|target/);
    expect(sanitizeRichText("<p>a</p><ul><li><p>b</p></li></ul>", { mail: true })).toBe('<p dir="auto">a</p><ul><li><p>b</p></li></ul>');
  });

  it("validates values one by one", () => {
    expect([cleanColor("#FA0"), cleanColor("rgb(1, 2, 3)"), cleanColor("rgba(0,0,0,0)"), cleanColor("windowtext"), cleanColor("#00000000")]).toEqual(["#ffaa00", "#010203", null, null, null]);
    expect([cleanFontSize("12pt"), cleanFontSize("18px"), cleanFontSize("4px"), cleanFontSize("1em")]).toEqual([16, 18, null, null]);
    expect([cleanFontFamily("'Times New Roman', serif"), cleanFontFamily("x;}body{"), cleanFontFamily("a, b, c, d, e")]).toEqual(['"Times New Roman", serif', null, null]);
    expect([safeHref("example.com/a"), safeHref("ap@example.com"), safeHref("ftp://x"), safeHref("/relative"), safeHref("java\nscript:alert(1)")]).toEqual(["https://example.com/a", "mailto:ap@example.com", null, null, null]);
  });
});

describe("plain text and merge fields", () => {
  it("makes the plain-text part", () => {
    const html = '<p>Hello <strong>Priya</strong>,</p><ol><li><p>pay</p></li><li><p>reply</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul><blockquote><p>quoted</p></blockquote><p>See <a href="https://example.com">our terms</a>.</p><hr><p>Bye<br>Ana</p>';
    expect(richTextToPlain(html)).toBe("Hello Priya,\n\n1. pay\n2. reply\n[x] done\n\n> quoted\n\nSee our terms <https://example.com>.\n\n----------\n\nBye\nAna");
    expect(plainToRichText("a & b\nc\n\nd")).toBe("<p>a &amp; b<br>c</p><p>d</p>");
    expect([isRichTextEmpty("<p></p>"), isRichTextEmpty("<p> </p><p><br></p>"), isRichTextEmpty('<p><img src="https://x.example/a.png"></p>'), isRichTextEmpty("<p>x</p>")]).toEqual([true, true, false, false]);
  });

  it("fills merge fields with escaped values and leaves unknown ones as written", () => {
    expect(resolveMergeFields("<p>Dear {{ customer_name }}, {{customer_name}} owes {{ total }} {{ nope }}</p>", { customer_name: "<b>Acme</b> & Co", total: 12 })).toBe("<p>Dear &lt;b&gt;Acme&lt;/b&gt; &amp; Co, &lt;b&gt;Acme&lt;/b&gt; &amp; Co owes 12 {{ nope }}</p>");
  });

  it("makes chips of tokens in text only", () => {
    const fields = [{ name: "id", label: 'Id "x"' }];
    const out = mergeChips('<p>{{ id }} <a href="https://x.example/{{id}}">{{ id }}</a></p>', fields, true);
    expect(out).toContain('href="https://x.example/{{id}}"');
    expect(out.match(/merge-chip/g)).toHaveLength(2);
    expect(out).toContain("Id \"x\"</span>");
    expect(mergeChips("<p>{{ id }}</p>", fields)).toBe('<p><span data-merge-field="id"></span></p>');
  });
});

describe("pasting", () => {
  it("makes Word's list paragraphs lists and drops its noise", () => {
    const word = `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]--><p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span>First</p><p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span><b>Second</b></p><p class=MsoNormal><span style='color:black;font-family:"Calibri",sans-serif'>Body</span><o:p></o:p></p>`;
    const out = tidyPastedHtml(word);
    expect(out).toMatch(/^<ol><li><p>First<\/p><\/li><li><p><b>Second<\/b><\/p><\/li><\/ol>/);
    expect(out).toContain('<span style="font-family: Calibri, sans-serif">Body</span>');
    expect(out).not.toMatch(/mso|class|xml|o:p|color/i);
  });

  it("unwraps Google Docs and follows its link redirects", () => {
    const g = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;color:#000000">Bold</span> <a href="https://www.google.com/url?q=https://example.com/page&amp;sa=D">link</a></p></b>';
    const out = tidyPastedHtml(g);
    expect(out).toContain('<span style="font-weight: 700">Bold</span>');
    expect(out).toContain('href="https://example.com/page"');
    expect(out).not.toMatch(/docs-internal|<b /);
  });
});

async function mount(ui: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(ui));
  for (let i = 0; i < 50 && !host.querySelector(".ProseMirror"); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("RichTextEditor", () => {
  it("draws the frame while its code loads, then a toolbar whose pressed states follow the selection", async () => {
    let editor: Editor | null = null;
    const { host, unmount } = await mount(<RichTextEditor value="<p><strong>bold</strong> plain</p>" label="Message" onEditor={(e) => (editor = e)} />);
    expect(host.querySelector('[role="toolbar"][aria-label="Formatting"]')).not.toBeNull();
    const content = host.querySelector(".ProseMirror")!;
    expect(content.getAttribute("aria-label")).toBe("Message");
    expect(content.getAttribute("data-ferrum-keys")).toBe("mod+k");
    const bold = () => host.querySelector('button[aria-label="Bold"]')!.getAttribute("aria-pressed");
    await act(async () => void editor!.commands.setTextSelection(3));
    expect(bold()).toBe("true");
    await act(async () => void editor!.commands.setTextSelection(9));
    expect(bold()).toBe("false");
    await act(async () => void editor!.chain().setTextSelection({ from: 7, to: 12 }).toggleBold().run());
    expect(bold()).toBe("true");
    await unmount();
  });

  it("keeps merge fields as chips while written and as literal tokens in the value", async () => {
    let editor: Editor | null = null;
    let value = "";
    const { host, unmount } = await mount(<RichTextEditor value="<p>Dear {{ customer_name }},</p>" label="Message" mergeFields={[{ name: "customer_name", label: "Customer name" }]} onChange={(v) => (value = v)} onEditor={(e) => (editor = e)} />);
    expect(host.querySelector(".merge-chip")?.textContent).toBe("Customer name");
    await act(async () => void editor!.commands.insertContentAt(editor!.state.doc.content.size - 1, " hello"));
    expect(value).toBe("<p>Dear {{ customer_name }}, hello</p>");
    expect(value).not.toContain("data-merge-field");
    await unmount();
  });

  it("offers four tools when minimal", async () => {
    const { host, unmount } = await mount(<RichTextEditor toolbar="minimal" value="" label="Comment" />);
    const names = [...host.querySelectorAll('[role="toolbar"] > div:first-child button')].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Bold", "Italic", "Bulleted list", "Link"]);
    await unmount();
  });

  it("is reached by its name and passes axe while it loads and when shown", async () => {
    const { host, unmount } = await mount(<RichTextEditor value="<p>x</p>" label="Message" />);
    expect(await violations(host.innerHTML)).toEqual([]);
    await unmount();
    const { host: shown, unmount: done } = await mount(<RichText html="<p>x</p>" />);
    expect(await violations(shown.innerHTML)).toEqual([]);
    await done();
  });
});

describe("loading", () => {
  it("imports the editor's code only when an editor is drawn", () => {
    const index = readFileSync("src/ui/richtext/index.tsx", "utf8");
    const sanitize = readFileSync("src/ui/richtext/sanitize.ts", "utf8");
    expect(index).not.toMatch(/^import [^t].*(@tiptap|\.\/Editor)/m); // types only
    expect(index).toContain('import("./Editor")');
    expect(index).toContain("lazy(load)");
    expect(sanitize).not.toMatch(/@tiptap/);
  });
});
