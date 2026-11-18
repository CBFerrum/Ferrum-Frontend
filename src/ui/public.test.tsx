// @vitest-environment jsdom
// The kit's pieces for pages strangers see (gapclose/design/S4-public-side.md §2.4, §2.17): the frame with the workspace's brand,
// the language switch and the snippet that puts a page on another site.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicBrand } from "@ferrum/client";
import { violations } from "../test/axe";
import { embedSnippet, EmbedSnippet, LanguageSwitch, PublicFrame } from "./public";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});
function draw(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

const brand = (over: Partial<PublicBrand> = {}): PublicBrand => ({
  id: "b1", name: "Acme & Co", css: "/_brand/acme/b1.css?v=1", logo: "/_brand/acme/b1/logo?v=1", logo_dark: "/_brand/acme/b1/logo_dark?v=1", favicon: null,
  footer_text: "Acme Ltd, 1 High Street", links: [{ label: "Privacy", url: "/privacy" }, { label: "Write to us", url: "mailto:hi@acme.example" }, { label: "Bad", url: "javascript:alert(1)" }], ...over,
});

describe("PublicFrame", () => {
  it("frame_shows_logo_or_name_and_footer_links", async () => {
    let host = draw(<PublicFrame brand={brand()} workspace="Acme"><p>the form</p></PublicFrame>);
    const logo = host.querySelector<HTMLImageElement>("header img");
    expect(logo?.alt).toBe("Acme & Co");
    expect(logo?.getAttribute("src")).toBe("/_brand/acme/b1/logo?v=1");
    expect(host.querySelector("header source")?.getAttribute("srcset")).toBe("/_brand/acme/b1/logo_dark?v=1");
    expect(host.querySelector("main")?.textContent).toBe("the form");
    expect(host.querySelector("footer")?.textContent).toContain("Acme Ltd, 1 High Street");
    // Only links a public page may carry: a path of its own host, https or mailto; never a script.
    expect([...host.querySelectorAll("footer a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Privacy", "/privacy"], ["Write to us", "mailto:hi@acme.example"]]);
    // A skip link to the content, first on the page; landmarks.
    const skip = host.querySelector("a");
    expect(skip?.getAttribute("href")).toBe(`#${host.querySelector("main")?.id}`);
    expect(host.querySelectorAll("header, main, footer")).toHaveLength(3);

    // No logo: the brand's name; no brand at all: the workspace's name and no footer.
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    host = draw(<PublicFrame brand={brand({ logo: null, logo_dark: null, links: [], footer_text: "" })} workspace="Acme"><p>x</p></PublicFrame>);
    expect(host.querySelector("header img")).toBeNull();
    expect(host.querySelector("header")?.textContent).toContain("Acme & Co");
    expect(host.querySelector("footer")).toBeNull();
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    host = draw(<PublicFrame brand={null} workspace="Acme"><p>x</p></PublicFrame>);
    expect(host.querySelector("header")?.textContent).toContain("Acme");
  });
});

describe("LanguageSwitch", () => {
  it("language_switch_labelled_and_keyboard", async () => {
    // One language offered: nothing to switch.
    expect(draw(<LanguageSwitch languages={["en"]} current="en" />).innerHTML).toBe("");
    const host = draw(<LanguageSwitch languages={["en", "de", "ar"]} current="de" />);
    const select = host.querySelector("select")!;
    // A labelled native select, each language in its own words, the current one chosen.
    expect(select.labels?.[0]?.textContent).toBe("Language");
    expect([...select.options].map((o) => [o.value, o.lang])).toEqual([["en", "en"], ["de", "de"], ["ar", "ar"]]);
    expect(select.value).toBe("de");
    // A form that works by keyboard and without script: GET with `lang`, a button to apply it, other query parameters kept.
    const form = host.querySelector("form")!;
    expect(form.method).toBe("get");
    expect(select.name).toBe("lang");
    expect(form.querySelector("button[type=submit]")?.textContent).toBe("Change");
    expect(await violations(host.innerHTML)).toEqual([]);
  });
  it("keeps the page's other parameters, not its old language", () => {
    window.history.replaceState(null, "", "/forms/f/acme/survey?embed=1&lang=en");
    const host = draw(<LanguageSwitch languages={["en", "de"]} current="en" />);
    expect([...host.querySelectorAll<HTMLInputElement>("input[type=hidden]")].map((i) => [i.name, i.value])).toEqual([["embed", "1"]]);
    window.history.replaceState(null, "", "/");
  });
});

describe("EmbedSnippet", () => {
  it("snippet_escapes_title", () => {
    const text = embedSnippet("https://portal.acme.example/forms/f/acme/survey", `"><script>alert(1)</script> & more`);
    expect(text).toContain(`title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; more"`);
    expect(text).not.toContain("<script>alert");
    expect(text).toContain(`src="https://portal.acme.example/forms/f/acme/survey?embed=1"`);
    expect(text).toContain(`<script src="https://portal.acme.example/_shell/v1/embed.js" async></script>`);
    expect(text).toContain("data-ferrum-embed");
    // A page address that already has a query keeps it; one that is not a web address gives no snippet.
    expect(embedSnippet("https://a.example/bookings/book?lang=de", "Book")).toContain(`src="https://a.example/bookings/book?lang=de&amp;embed=1"`);
    expect(embedSnippet("javascript:alert(1)", "x")).toBe("");
  });
  it("shows the snippet read-only, with a button that copies it", async () => {
    const host = draw(<EmbedSnippet url="https://a.example/forms/f/acme/survey" title="Survey" />);
    const box = host.querySelector("textarea")!;
    expect(box.readOnly).toBe(true);
    expect(box.labels?.[0]?.textContent).toBe("Code to paste into your site");
    expect(box.value).toBe(embedSnippet("https://a.example/forms/f/acme/survey", "Survey"));
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Copy"]);
    expect(await violations(host.innerHTML)).toEqual([]);
  });
});
