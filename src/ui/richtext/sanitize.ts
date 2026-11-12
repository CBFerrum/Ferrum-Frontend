// Rich text as data: the one allow-list every rich-text value passes through on its way in (a paste, a value loaded into the
// editor, a value shown by `RichText`) and on its way out (a caller saving or sending it), the plain-text form a reader without
// HTML gets, pasted HTML from Word and Google Docs tidied before it is read, and merge-field tokens. The browser's own parser
// does the work (DOMParser): nothing here runs or loads what it reads. Strictest of what Mail (lib/compose.ts) and Docs
// (format.ts, paste.ts) did: no classes, no ids, no event handlers, styles only as validated values of seven properties, links
// only to http, https and mailto. docs/design/PATTERNS.md, "Rich text"; the server's own allow-list is crates/kernel/src/richtext.rs.

/** Elements kept; anything else is unwrapped (its text kept) or, when in `DROP`, removed whole. */
const TAGS = new Set("a b blockquote br code col colgroup del div em h1 h2 h3 h4 hr i img li mark ol p pre s span strike strong sub sup table tbody td tfoot th thead tr u ul".split(" "));
const DROP = new Set("applet audio base button canvas dialog embed form frame frameset head iframe input link math meta noscript object option portal script select source style svg template textarea title track video xml".split(" "));
const FONT_NAME = /^[\p{L}\p{N} _-]{1,40}$/u;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(\d*\.?\d+%?)\s*)?\)$/i;
// The basic names Word and web pages write; anything else a name could be is refused rather than guessed.
// ui-lint-allow raw-color: colours a pasted document names, mapped to the values written into the content
const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", silver: "#c0c0c0", gray: "#808080", grey: "#808080", maroon: "#800000", red: "#ff0000", purple: "#800080", fuchsia: "#ff00ff", green: "#008000", lime: "#00ff00", olive: "#808000", yellow: "#ffff00", navy: "#000080", blue: "#0000ff", teal: "#008080", aqua: "#00ffff", orange: "#ffa500" };
const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");

/** A colour as `#rrggbb`, or null: not a colour, fully transparent, or a keyword such as `inherit` or `windowtext`. */
export function cleanColor(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const v = value.trim().toLowerCase();
  if (HEX.test(v)) {
    const h = v.slice(1);
    if (h.length === 8 && parseInt(h.slice(6), 16) === 0) return null;
    return h.length === 3 ? `#${[...h].map((c) => c + c).join("")}` : `#${h.slice(0, 6)}`;
  }
  const m = RGB.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(a > 0) || [m[1], m[2], m[3]].some((c) => +c! > 255)) return null;
    return `#${hex2(+m[1]!)}${hex2(+m[2]!)}${hex2(+m[3]!)}`;
  }
  return NAMED[v] ?? null;
}

/** A font size as whole pixels from `16px`, `12pt` or a number of pixels; null outside 8 to 96. */
export function cleanFontSize(value: unknown): number | null {
  const m = typeof value === "number" ? [String(value), String(value), "px"] : typeof value === "string" ? /^\s*(\d{1,3}(?:\.\d+)?)\s*(px|pt)\s*$/i.exec(value) : null;
  if (!m) return null;
  const px = Math.round(parseFloat(m[1]!) * (m[2]!.toLowerCase() === "pt" ? 4 / 3 : 1));
  return px >= 8 && px <= 96 ? px : null;
}

/** A font family list kept as written when each name is plain (letters, digits, spaces, quotes around it), at most four; null otherwise. */
export function cleanFontFamily(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const names = value.split(",").map((n) => n.trim().replace(/^(["'])(.*)\1$/, "$2").trim());
  if (!names.length || names.length > 4 || !names.every((n) => FONT_NAME.test(n) && !/^(url|expression|import|inherit|initial)$/i.test(n))) return null;
  return names.map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(", ");
}

const STYLE: Record<string, (v: string) => string | null> = {
  color: (v) => cleanColor(v),
  "background-color": (v) => cleanColor(v),
  "font-size": (v) => {
    const px = cleanFontSize(v);
    return px === null ? null : `${px}px`;
  },
  "font-family": cleanFontFamily,
  "text-align": (v) => (/^(left|right|center|justify|start|end)$/i.test(v) ? v.toLowerCase() : null),
  // Read by the editor as bold, italic, underline and strikethrough (Google Docs writes them so); never kept as styles past it.
  "font-weight": (v) => (/^(normal|bold|[1-9]00)$/i.test(v) ? v.toLowerCase() : null),
  "font-style": (v) => (/^(normal|italic)$/i.test(v) ? v.toLowerCase() : null),
  "text-decoration": (v) => (/^(none|underline|line-through)$/i.test(v) ? v.toLowerCase() : null),
  // A table column's and an image's width.
  width: (v) => (/^\d{1,4}(\.\d+)?(px|%)$/.test(v) ? v : null),
  "min-width": (v) => (/^\d{1,4}(\.\d+)?px$/.test(v) ? v : null),
};

/** A style attribute as only the declarations above, each value validated (nothing that loads, nothing that escapes). */
export function cleanStyle(style: string): string {
  return style
    .split(";")
    .map((d) => {
      const i = d.indexOf(":");
      if (i < 1) return "";
      const name = d.slice(0, i).trim().toLowerCase();
      const raw = d.slice(i + 1).trim().replace(/\s*!important$/i, "");
      if (/[\\<>@]|\/\*|url\(|expression/i.test(raw)) return "";
      const value = STYLE[name]?.(raw);
      return value ? `${name}: ${value}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

/** A link's address when it is http, https or mailto (a bare e-mail address becomes mailto, a bare host https); null otherwise. */
export function safeHref(href: string): string | null {
  const raw = href.trim();
  if (!raw || /[\s<>"]/.test(raw.replace(/ /g, "%20"))) return null;
  const url = /^(https?:|mailto:)/i.test(raw) ? raw : /^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(raw) ? `mailto:${raw}` : /^[a-z][\w+.-]*:/i.test(raw) ? null : /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(raw) ? `https://${raw}` : null;
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? url : null;
  } catch {
    return null;
  }
}

export interface SanitizeOptions {
  /** Keep `data:` images (png, jpeg, gif, webp): only for an editor whose caller asked for `inline` images. */
  inlineImages?: boolean;
  /** Address prefixes an image may come from besides `https:` (the caller's own files: "/api/files/"). */
  imageSources?: string[];
  /** `data-*` attributes (names such as `data-cid`) an image may keep besides its own: a host's part reference, say. Others are never kept. */
  imageAttributes?: string[];
  /** For a message going out: links lose `target`, a check list becomes lines that start with ☐ or ☑ (mail programs draw no boxes), each paragraph says `dir="auto"`. */
  mail?: boolean;
}

/** The only extra attribute names an image may carry: `data-` and a lower-case word, so a host cannot let `onerror` or `src` through. */
export const IMAGE_DATA = /^data-[a-z][a-z0-9-]*$/;
const int = (v: string, min: number, max: number) => (/^\d{1,5}$/.test(v) && +v >= min && +v <= max ? String(+v) : null);

/** What an attribute keeps on a tag: its cleaned value, or null to drop it. */
function attribute(tag: string, name: string, value: string, o: SanitizeOptions): string | null {
  const v = value.trim();
  switch (name) {
    case "dir":
      return /^(ltr|rtl|auto)$/i.test(v) ? v.toLowerCase() : null;
    case "style":
      return cleanStyle(v) || null;
    case "href":
      return tag === "a" ? safeHref(v) : null;
    case "target":
      return tag === "a" && v === "_blank" && !o.mail ? "_blank" : null;
    case "title":
      return tag === "a" || tag === "img" ? v.slice(0, 300) : null;
    case "src": {
      if (tag !== "img") return null;
      if (/^https:\/\//i.test(v) || (o.imageSources ?? []).some((p) => p && v.startsWith(p) && !/^(javascript|data|vbscript):/i.test(v))) return v;
      return o.inlineImages && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v) ? v : null;
    }
    case "alt":
      return tag === "img" ? v.slice(0, 300) : null;
    case "width":
    case "height":
      return tag === "img" ? int(v, 1, 4000) : null;
    case "start":
      return tag === "ol" ? int(v, 1, 99999) : null;
    case "type":
      return tag === "ol" && /^[1aAiI]$/.test(v) ? v : null;
    case "colspan":
    case "rowspan":
      return tag === "td" || tag === "th" ? int(v, 1, 100) : null;
    case "colwidth":
      return (tag === "td" || tag === "th") && /^\d{1,4}(,\d{1,4}){0,99}$/.test(v) ? v : null;
    case "data-type":
      return (tag === "ul" && v === "taskList") || (tag === "li" && v === "taskItem") ? v : null;
    case "data-checked":
      return tag === "li" && /^(true|false)$/.test(v) ? v : null;
    case "data-color":
      return tag === "mark" ? cleanColor(v) : null;
    default:
      return tag === "img" && IMAGE_DATA.test(name) && o.imageAttributes?.includes(name) ? v.slice(0, 500) : null;
  }
}

function clean(el: Element, o: SanitizeOptions): void {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 8 || child.nodeType === 7 || child.nodeType === 4) {
      child.remove(); // comments (Word's conditional ones too), processing instructions, CDATA
      continue;
    }
    if (child.nodeType !== 1) continue;
    const c = child as Element;
    const tag = c.localName.toLowerCase();
    if (DROP.has(tag) || c.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      c.remove();
      continue;
    }
    clean(c, o);
    if (!TAGS.has(tag)) {
      c.replaceWith(...Array.from(c.childNodes));
      continue;
    }
    for (const a of Array.from(c.attributes)) {
      const kept = attribute(tag, a.name.toLowerCase(), a.value, o);
      if (kept === null) c.removeAttribute(a.name);
      else if (kept !== a.value) c.setAttribute(a.name, kept);
    }
    if (tag === "a") {
      if (c.hasAttribute("href")) c.setAttribute("rel", "noopener noreferrer nofollow");
      else c.replaceWith(...Array.from(c.childNodes));
    } else if (tag === "img" && !c.hasAttribute("src")) c.remove();
  }
}

function parse(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html").body;
}

/** For a mail: a check list as lines starting with ☐ or ☑, which every mail program draws. */
function mailChecks(body: HTMLElement): void {
  for (const ul of Array.from(body.querySelectorAll('ul[data-type="taskList"]'))) {
    ul.removeAttribute("data-type");
    ul.setAttribute("style", "list-style: none; padding-inline-start: 0");
    for (const li of Array.from(ul.children).filter((x) => x.getAttribute("data-type") === "taskItem")) {
      const box = li.ownerDocument.createTextNode(li.getAttribute("data-checked") === "true" ? "☑ " : "☐ ");
      const first = li.querySelector("p") ?? li;
      first.insertBefore(box, first.firstChild);
      li.removeAttribute("data-type");
      li.removeAttribute("data-checked");
    }
  }
}

/**
 * HTML from anywhere as rich text may hold it: the allowed elements (paragraphs, headings 1-4, quote, code, the inline marks,
 * lists and check lists, links, images, tables, rules), the allowed attributes on each (see `attribute` above), styles as
 * validated colour, size, family, alignment and width only. Everything else is unwrapped, keeping its text, or removed whole
 * (scripts, styles, frames, forms, media, SVG and MathML). Idempotent: cleaning clean HTML gives it back.
 */
export function sanitizeRichText(html: string, options: SanitizeOptions = {}): string {
  if (!html) return "";
  const body = parse(html);
  clean(body, options);
  if (options.mail) {
    mailChecks(body);
    // Each paragraph finds its own direction in the reader's mail program too.
    // (Not inside a list or quote: those say `dir="auto"` themselves, which an inner `dir` would hide their words from.)
    for (const el of Array.from(body.querySelectorAll("p, h1, h2, h3, h4"))) if (!el.hasAttribute("dir") && !el.closest("li, blockquote, td, th")) el.setAttribute("dir", "auto");
  }
  return body.innerHTML;
}

/** Whether rich text says nothing: no words, no image, no rule, no table. */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const body = parse(html);
  return !(body.textContent ?? "").trim() && !body.querySelector("img, hr, table");
}

const BLOCKS = new Set("blockquote div h1 h2 h3 h4 h5 h6 hr li ol p pre table tbody tfoot thead tr ul".split(" "));
const EDGE = "\u0001";
const PARA = "\u0002";

/** Runs of block edges and breaks as lines: one more line than the breaks in the run, two at least around a paragraph. */
function settle(s: string): string {
  return s
    .replace(/[\n\u0001\u0002]+/g, (run) => (/[\u0001\u0002]/.test(run) ? "\n".repeat(run.includes(PARA) ? Math.max(2, (run.match(/\n/g)?.length ?? 0) + 1) : (run.match(/\n/g)?.length ?? 0) + 1) : run))
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, "").replace(/^ (?=\S)/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** The plain-text form of rich text, as a mail's text part or a notification shows it: paragraphs kept, lists as "- " and "1. "
 *  lines (a check list as "[x] " and "[ ] "), links as their words and address, quotes with "> ", images by their description. */
export function richTextToPlain(html: string): string {
  const root = parse(html);
  const walk = (n: Node, pre: boolean, depth: number): string => {
    if (n.nodeType === 3) return pre ? (n.textContent ?? "") : (n.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ");
    if (n.nodeType !== 1) return "";
    const el = n as Element;
    const tag = el.localName;
    if (DROP.has(tag)) return "";
    if (tag === "br") return "\n";
    if (tag === "img") return el.getAttribute("alt") ? `[${el.getAttribute("alt")}]` : "";
    if (tag === "hr") return `${EDGE}----------${EDGE}`;
    const kids = Array.from(el.childNodes);
    if (kids.length > 1 && kids.at(-1)?.nodeName === "BR") kids.pop();
    const inner = () => kids.map((c) => walk(c, pre || tag === "pre", depth)).join("");
    if (tag === "a") {
      const words = inner();
      const href = (el.getAttribute("href") ?? "").replace(/^mailto:/i, "");
      return !href || words.trim() === href ? words : `${words} <${href}>`;
    }
    if (tag === "ul" || tag === "ol") {
      let i = Number(el.getAttribute("start") ?? "1") || 1;
      const pad = "  ".repeat(depth);
      const lines = Array.from(el.children)
        .filter((c) => c.localName === "li")
        .map((li) => {
          const mark = li.getAttribute("data-type") === "taskItem" ? (li.getAttribute("data-checked") === "true" ? "[x] " : "[ ] ") : tag === "ol" ? `${i++}. ` : "- ";
          const body = settle(Array.from(li.childNodes).map((c) => walk(c, pre, depth + 1)).join(""));
          return body.split("\n").map((l, k) => (k === 0 ? `${pad}${mark}${l}` : l)).join("\n");
        });
      return `${EDGE}${lines.join("\n")}${EDGE}`;
    }
    if (tag === "blockquote") return `${PARA}${settle(inner()).split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n")}${PARA}`;
    if (tag === "td" || tag === "th") return `${inner()}\t`;
    const text = inner();
    if (tag === "p" || /^h[1-6]$/.test(tag)) return `${PARA}${text}${PARA}`;
    return BLOCKS.has(tag) ? `${EDGE}${text}${EDGE}` : text;
  };
  return settle(walk(root, false, 0)).replace(/\t+$/gm, "");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text as rich text: a paragraph per run of lines, lines kept with breaks. */
export function plainToRichText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ── merge fields ──

/** A merge field's token as stored: `{{ customer_name }}`. Names are letters, digits, underscores and dots. */
export const MERGE_TOKEN = /\{\{\s*([A-Za-z_][\w.]{0,99})\s*\}\}/g;
export const mergeToken = (name: string) => `{{ ${name} }}`;

/** Each `{{ name }}` replaced by its value, escaped (a value is text, never markup); a name with no value is left as written. */
export function resolveMergeFields(html: string, values: Record<string, string | number | null | undefined>): string {
  return html.replace(MERGE_TOKEN, (token, name: string) => {
    const v = values[name];
    return v === null || v === undefined ? token : escapeHtml(String(v));
  });
}

/** The tokens of `html` that name one of `fields`, as chips: `<span data-merge-field="name">` for the editor to read, or (`view`)
 *  a `merge-chip` span with the field's label for `RichText`. Text only: a token inside an attribute (an address) is left alone. */
export function mergeChips(html: string, fields: { name: string; label: string }[], view = false): string {
  if (!fields.length || !html.includes("{{")) return html;
  const body = parse(html);
  const label = new Map(fields.map((f) => [f.name, f.label]));
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    const s = text.data;
    const out: (string | HTMLElement)[] = [];
    let at = 0;
    for (const m of s.matchAll(MERGE_TOKEN)) {
      if (!label.has(m[1]!)) continue;
      out.push(s.slice(at, m.index));
      const span = body.ownerDocument.createElement("span");
      if (view) {
        span.className = "merge-chip";
        span.title = m[0];
        span.textContent = label.get(m[1]!)!;
      } else span.setAttribute("data-merge-field", m[1]!);
      out.push(span);
      at = m.index! + m[0].length;
    }
    if (!at) continue;
    out.push(s.slice(at));
    text.replaceWith(...out);
  }
  return body.innerHTML;
}

// ── paste ──

const LIST_STYLE = /mso-list:\s*(?!Ignore)[^;]*?level(\d+)/i;

/** Word writes a list as paragraphs with `mso-list: l0 level2 lfo1` and the number in a span marked `mso-list: Ignore`: made the nested lists they are. */
function wordLists(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const parent of [root, ...root.querySelectorAll<HTMLElement>("div, td, th, blockquote")]) {
    let run: HTMLElement[] = [];
    const flush = () => {
      const stack: { level: number; list: HTMLElement; ordered: boolean }[] = [];
      let top: HTMLElement | null = null;
      for (const p of run) {
        const level = Number(LIST_STYLE.exec(p.getAttribute("style") ?? "")![1]);
        const mark = p.querySelector<HTMLElement>('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
        const ordered = /^\(?\s*([0-9]+|[a-z]{1,4})\s*[.)]/i.test((mark?.textContent ?? "").trim());
        mark?.remove();
        while (stack.length && (stack.at(-1)!.level > level || (stack.at(-1)!.level === level && stack.at(-1)!.ordered !== ordered))) stack.pop();
        if (!stack.length || stack.at(-1)!.level < level) {
          const list = doc.createElement(ordered ? "ol" : "ul");
          const outer = stack.at(-1);
          if (outer) (outer.list.lastElementChild ?? outer.list.appendChild(doc.createElement("li"))).append(list);
          else if (top) top.after(list);
          else p.before(list);
          if (!outer) top = list;
          stack.push({ level, list, ordered });
        }
        const li = doc.createElement("li");
        const para = doc.createElement("p");
        para.append(...Array.from(p.childNodes));
        li.append(para);
        stack.at(-1)!.list.append(li);
        p.remove();
      }
      run = [];
    };
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child.tagName === "P" && LIST_STYLE.test(child.getAttribute("style") ?? "")) run.push(child);
      else if (run.length) flush();
    }
    if (run.length) flush();
  }
}

/** Google Docs sends links through its own redirect (`google.com/url?q=…`): the page they go to is the link. */
function unredirect(href: string): string {
  try {
    const u = new URL(href);
    const q = /^(www\.)?google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url" ? u.searchParams.get("q") : null;
    return q && /^https?:\/\//i.test(q) ? q : href;
  } catch {
    return href;
  }
}

/** Pasted HTML tidied before the editor reads it: Word's list paragraphs as lists and its namespaced tags gone, Google's wrapper
 *  and link redirects gone, old `<font>` as a styled span, a heading without the size and family its source gave it, black (the
 *  colour every Word and Google paragraph names) left automatic, then the allow-list. */
export function tidyPastedHtml(html: string, options: SanitizeOptions = {}): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  for (const el of Array.from(body.querySelectorAll('[id^="docs-internal-guid"]'))) el.replaceWith(...Array.from(el.childNodes));
  for (const f of Array.from(body.querySelectorAll("font"))) {
    const span = body.ownerDocument.createElement("span");
    span.setAttribute("style", [f.getAttribute("color") ? `color:${f.getAttribute("color")}` : "", f.getAttribute("face") ? `font-family:${f.getAttribute("face")}` : ""].filter(Boolean).join(";"));
    span.append(...Array.from(f.childNodes));
    f.replaceWith(span);
  }
  wordLists(body);
  for (const h of Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))) {
    for (const s of [h, ...h.querySelectorAll<HTMLElement>("[style]")]) for (const p of ["font-size", "font-family", "font-weight"]) s.style?.removeProperty(p);
  }
  for (const s of Array.from(body.querySelectorAll<HTMLElement>("[style]"))) {
    // ui-lint-allow raw-color: the automatic colours a pasted document names (black text, white paper), compared, not drawn
    if (cleanColor(s.style.color) === "#000000") s.style.removeProperty("color");
    // ui-lint-allow raw-color: the automatic colours a pasted document names (black text, white paper), compared, not drawn
    if (["#ffffff", null].includes(cleanColor(s.style.backgroundColor))) s.style.removeProperty("background-color");
  }
  for (const a of Array.from(body.querySelectorAll("a[href]"))) a.setAttribute("href", unredirect(a.getAttribute("href") ?? ""));
  return sanitizeRichText(body.innerHTML, options);
}
