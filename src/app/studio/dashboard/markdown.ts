// The markdown of dashboard notes, parsed into a small tree that renders as React elements (never
// as HTML): headings, paragraphs, lists, quotes, rules, bold, italics, code and links to safe
// addresses only.

export type Inline =
  | { t: "text"; v: string }
  | { t: "b" | "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Inline[] };

export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "quote"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "hr" };

/** App paths (`/app/...`, `/...`), http(s) and mailto addresses; anything else (javascript:, data:) is refused. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s]+$/i.test(h) || /^mailto:[^\s]+$/i.test(h)) return h;
  if (h.startsWith("/") && !h.startsWith("//") && !/\s/.test(h)) return h;
  return null;
}

const TOKEN = /(`+)([\s\S]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])|\[([^\]]+)\]\(([^)\s]+)\)/gu;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  let at = 0;
  for (const m of s.matchAll(TOKEN)) {
    text(s.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1]) out.push({ t: "code", v: m[2] });
    else if (m[3] ?? m[4]) out.push({ t: "b", c: parseInline(m[3] ?? m[4]) });
    else if (m[5] ?? m[6]) out.push({ t: "i", c: parseInline(m[5] ?? m[6]) });
    else {
      const href = safeHref(m[8]);
      if (href) out.push({ t: "a", href, c: parseInline(m[7]) });
      else text(m[7]);
    }
  }
  text(s.slice(at));
  return out;
}

export function parseMarkdown(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ t: "p", c: parseInline(para.join(" ")) });
    if (quote.length) out.push({ t: "quote", c: parseInline(quote.join(" ")) });
    if (list) out.push({ t: list.t, items: list.items.map(parseInline) });
    para = [];
    quote = [];
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) flush();
    else if ((m = /^(#{1,3})\s+(.+)$/.exec(line.trim()))) {
      flush();
      out.push({ t: "h", level: m[1].length as 1 | 2 | 3, c: parseInline(m[2].replace(/\s+#+$/, "")) });
    } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flush();
      out.push({ t: "hr" });
    } else if ((m = /^\s*(?:([-*+])|\d{1,9}[.)])\s+(.*)$/.exec(line))) {
      const t = m[1] ? "ul" : "ol";
      if (!list || list.t !== t || para.length || quote.length) {
        flush();
        list = { t, items: [] };
      }
      list.items.push(m[2]);
    } else if ((m = /^>\s?(.*)$/.exec(line.trim()))) {
      if (para.length || list) flush();
      quote.push(m[1]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // An indented line continues the last list item.
      const items = (list as { items: string[] }).items;
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list || quote.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out;
}
