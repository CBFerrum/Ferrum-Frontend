// A small Markdown reader for text blocks. Spaces are written by one person and read by many, so
// the text becomes a tree that React renders as elements (escaped), never HTML, and only links to
// app paths, anchors, http(s) and mail addresses survive. Covers what notes need: headings,
// paragraphs (line breaks kept), lists, quotes, code, rules, bold, italic, strikethrough, links, URLs.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "quote"; c: MdBlock[] }
  | { t: "code"; v: string }
  | { t: "hr" };

/** A link target that is safe to follow: an app path, `#anchor`, http(s) or mailto; null otherwise. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (!u || /[\s\u0000-\u001f\u007f]/.test(u)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if ((u.startsWith("/") && !u.startsWith("//")) || u.startsWith("#")) return u;
  return null;
}

const PUNCT = "\\`*_{}[]()#+-.!~>|";
const WORD = /[\p{L}\p{N}]/u;

function pushText(out: Inline[], v: string) {
  const last = out[out.length - 1];
  if (last?.t === "text") last.v += v;
  else if (v) out.push({ t: "text", v });
}

/** Where the emphasis run opened before `from` closes, or -1. */
function closer(s: string, delim: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > 0) i = end;
      continue;
    }
    if (!s.startsWith(delim, i) || /\s/.test(s[i - 1] ?? " ")) continue;
    // `*` closes on a lone star (not on `**`); `_` never closes inside a word (snake_case).
    if (delim.length === 1 && s[i + 1] === delim) {
      i++;
      continue;
    }
    if (delim[0] === "_" && WORD.test(s[i + delim.length] ?? "")) continue;
    return i;
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  // Delimiters known not to close anywhere further on: each is searched for once (linear time).
  const unclosed = new Set<string>();
  const close = (delim: string, from: number) => {
    if (unclosed.has(delim)) return -1;
    const end = closer(s, delim, from);
    if (end < 0) unclosed.add(delim);
    return end;
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const prev = s[i - 1] ?? "";
    if (ch === "\\" && PUNCT.includes(s[i + 1] ?? "")) {
      pushText(out, s[i + 1]);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) {
        out.push({ t: "code", v: s.slice(i + run.length, end).replace(/^ (.+) $/, "$1") });
        i = end + run.length;
      } else {
        pushText(out, run);
        i += run.length;
      }
      continue;
    }
    const pair = s.startsWith("**", i) ? "**" : s.startsWith("__", i) ? "__" : s.startsWith("~~", i) ? "~~" : null;
    if (pair && !/\s/.test(s[i + 2] ?? " ") && !(pair === "__" && WORD.test(prev))) {
      const end = close(pair, i + 2);
      if (end > 0) {
        out.push({ t: pair === "~~" ? "del" : "strong", c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && !/\s/.test(s[i + 1] ?? " ") && !(ch === "_" && WORD.test(prev))) {
      const end = close(ch, i + 1);
      if (end > 0) {
        out.push({ t: "em", c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[((?:\\.|[^\]\\])+)\]\(\s*<?([^\s<>()]+)>?(?:\s+"[^"]*")?\s*\)/.exec(s.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        // Links never nest: a URL inside the link text is plain text.
        const c = parseInline(m[1]).flatMap((x) => (x.t === "link" ? x.c : [x]));
        if (href) out.push({ t: "link", href, c });
        else {
          // An unsafe target (javascript:, data:, //host): the text stays, the link goes.
          for (const x of c) {
            if (x.t === "text") pushText(out, x.v);
            else out.push(x);
          }
        }
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && !WORD.test(prev)) {
      const m = /^https?:\/\/[^\s<>"]+/i.exec(s.slice(i));
      if (m) {
        const url = m[0].replace(/[.,:;!?'")\]]+$/, "");
        out.push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>/;
const ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // the closing fence, or the end
      out.push({ t: "code", v: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ t: "h", level: Math.min(h[1].length, 3) as 1 | 2 | 3, c: parseInline(h[2] ?? "") });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push({ t: "quote", c: parseMarkdown(body.join("\n")) });
      continue;
    }
    const first = ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (m && /\d/.test(m[1]) === ordered) items.push(m[2]);
        else if (!m && items.length && lines[i].trim() && /^\s+/.test(lines[i])) items[items.length - 1] += `\n${lines[i].trim()}`;
        else break;
        i++;
      }
      const parsed = items.map(parseInline);
      out.push(ordered ? { t: "ol", start: parseInt(first[1], 10), items: parsed } : { t: "ul", items: parsed });
      continue;
    }
    const body = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) body.push(lines[i++].trim());
    out.push({ t: "p", c: parseInline(body.join("\n")) });
  }
  return out;
}
