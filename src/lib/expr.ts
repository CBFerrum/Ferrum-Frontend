// A small evaluator for the common subset of CEL used by `visible_if` / `required_if` /
// `read_only_if` and action/workflow conditions:
//   literals (numbers, 'strings', true, false, null, [lists]), `doc.x`, `parent.x`, `user.x`,
//   `today`, `now`, member/index access, == != < <= > >= in, && || !, unary minus, parentheses.
// Anything else (function calls, arithmetic, ternaries) is "unknown": callers then fall back to
// the permissive choice (show the field / allow the action) because the server is the authority.

import { compareDecimal, isDecimalString, todayIso } from "./format";

/** Number literal kept as source text so comparisons with decimal strings stay exact. */
class Num {
  constructor(readonly text: string) {}
}

type Node =
  | { k: "lit"; v: unknown }
  | { k: "var"; name: string }
  | { k: "get"; obj: Node; key: Node }
  | { k: "not"; e: Node }
  | { k: "neg"; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "list"; items: Node[] };

export interface Scope {
  doc: Record<string, unknown>;
  parent?: Record<string, unknown> | null;
  user?: unknown;
  old?: unknown;
}

type Tok = { t: "num" | "str" | "id" | "sym"; v: string };

const SYMBOLS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "!", "(", ")", ".", "[", "]", ",", "-"];
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };
const RELATIONAL = new Set(["==", "!=", "<", "<=", ">", ">="]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m = /^\d+(\.\d+)?/.exec(rest);
    if (m) {
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    m = /^[A-Za-z_]\w*/.exec(rest);
    if (m) {
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          j++;
          s += ESCAPES[src[j]] ?? src[j];
        } else s += src[j];
        j++;
      }
      if (j >= src.length) throw new SyntaxError("unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const sym = SYMBOLS.find((s) => src.startsWith(s, i));
    if (!sym) throw new SyntaxError(`unexpected character '${c}'`);
    out.push({ t: "sym", v: sym });
    i += sym.length;
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const isSym = (v: string) => toks[p]?.t === "sym" && toks[p].v === v;
  const eat = (v: string) => (isSym(v) ? (p++, true) : false);
  const expect = (v: string) => {
    if (!eat(v)) throw new SyntaxError(`expected '${v}'`);
  };

  const or = (): Node => {
    let l = and();
    while (eat("||")) l = { k: "bin", op: "||", l, r: and() };
    return l;
  };
  const and = (): Node => {
    let l = rel();
    while (eat("&&")) l = { k: "bin", op: "&&", l, r: rel() };
    return l;
  };
  const rel = (): Node => {
    const l = unary();
    const t = toks[p];
    if (t && ((t.t === "sym" && RELATIONAL.has(t.v)) || (t.t === "id" && t.v === "in"))) {
      p++;
      return { k: "bin", op: t.v, l, r: unary() };
    }
    return l;
  };
  const unary = (): Node => {
    if (eat("!")) return { k: "not", e: unary() };
    if (eat("-")) return { k: "neg", e: unary() };
    return postfix();
  };
  const postfix = (): Node => {
    let n = primary();
    for (;;) {
      if (eat(".")) {
        const t = toks[p++];
        if (t?.t !== "id") throw new SyntaxError("expected a field name");
        n = { k: "get", obj: n, key: { k: "lit", v: t.v } };
      } else if (eat("[")) {
        const key = or();
        expect("]");
        n = { k: "get", obj: n, key };
      } else return n;
    }
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new SyntaxError("unexpected end of expression");
    if (t.t === "num") return { k: "lit", v: new Num(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "lit", v: t.v === "true" };
      if (t.v === "null") return { k: "lit", v: null };
      return { k: "var", name: t.v };
    }
    if (t.v === "(") {
      const e = or();
      expect(")");
      return e;
    }
    if (t.v === "[") {
      const items: Node[] = [];
      if (!eat("]")) {
        do items.push(or());
        while (eat(","));
        expect("]");
      }
      return { k: "list", items };
    }
    throw new SyntaxError(`unexpected '${t.v}'`);
  };

  const node = or();
  if (p < toks.length) throw new SyntaxError(`unexpected '${toks[p].v}'`);
  return node;
}

class EvalError extends Error {}

function toDecimal(v: unknown): string | null {
  if (v instanceof Num) return v.text;
  if (typeof v === "number" && Number.isFinite(v)) {
    const s = String(v);
    return isDecimalString(s) ? s : null;
  }
  if (isDecimalString(v)) return v.trim();
  return null;
}

function isNumeric(v: unknown): boolean {
  return v instanceof Num || typeof v === "number";
}

/** Decimal strings (how money arrives) compare numerically with numbers and with each other. */
function compareValues(a: unknown, b: unknown): number | null {
  const numeric = isNumeric(a) || isNumeric(b) || (isDecimalString(a) && isDecimalString(b));
  if (numeric) {
    const da = toDecimal(a);
    const db = toDecimal(b);
    return da === null || db === null ? null : compareDecimal(da, db);
  }
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function equals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a == null && b == null;
  const c = compareValues(a, b);
  if (c !== null) return c === 0;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function truthy(v: unknown): boolean {
  if (v instanceof Num) return compareDecimal(v.text, "0") !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function evalNode(n: Node, s: Scope): unknown {
  switch (n.k) {
    case "lit":
      return n.v;
    case "var":
      switch (n.name) {
        case "doc":
          return s.doc;
        case "parent":
          return s.parent ?? null;
        case "user":
          return s.user ?? null;
        case "old":
          return s.old ?? null;
        case "today":
          return todayIso();
        case "now":
          return new Date().toISOString();
      }
      throw new EvalError(`unknown name '${n.name}'`);
    case "get": {
      const obj = evalNode(n.obj, s);
      const keyVal = evalNode(n.key, s);
      const key = keyVal instanceof Num ? keyVal.text : String(keyVal);
      if (obj === null || obj === undefined) return null;
      if (typeof obj !== "object") throw new EvalError("not an object");
      const v = (obj as Record<string, unknown>)[key];
      return v === undefined ? null : v;
    }
    case "not":
      return !truthy(evalNode(n.e, s));
    case "neg": {
      const d = toDecimal(evalNode(n.e, s));
      if (d === null) throw new EvalError("not a number");
      return new Num(d.startsWith("-") ? d.slice(1) : `-${d.replace(/^\+/, "")}`);
    }
    case "list":
      return n.items.map((i) => evalNode(i, s));
    case "bin": {
      if (n.op === "&&") return truthy(evalNode(n.l, s)) && truthy(evalNode(n.r, s));
      if (n.op === "||") return truthy(evalNode(n.l, s)) || truthy(evalNode(n.r, s));
      const l = evalNode(n.l, s);
      const r = evalNode(n.r, s);
      switch (n.op) {
        case "==":
          return equals(l, r);
        case "!=":
          return !equals(l, r);
        case "in":
          if (Array.isArray(r)) return r.some((x) => equals(l, x));
          if (r && typeof r === "object") return String(l) in r;
          if (r === null) return false;
          throw new EvalError("'in' needs a list");
        default: {
          // Ordering against null is false (CEL would raise an error, which the server treats as failure).
          if (l === null || r === null) return false;
          const c = compareValues(l, r);
          if (c === null) throw new EvalError("values cannot be compared");
          return n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
        }
      }
    }
  }
}

const compiled = new Map<string, Node | null>();

function compile(src: string): Node | null {
  let node = compiled.get(src);
  if (node === undefined) {
    try {
      node = parse(src);
    } catch {
      node = null;
    }
    compiled.set(src, node);
  }
  return node;
}

/**
 * Evaluates `src` as a condition. Returns `undefined` when the expression is outside the
 * supported subset or cannot be evaluated; callers must then defer to the server.
 */
export function evaluate(src: string, scope: Scope): boolean | undefined {
  const node = compile(src);
  if (!node) return undefined;
  try {
    return truthy(evalNode(node, scope));
  } catch {
    return undefined;
  }
}

/** Evaluates `src` to a plain value (numbers as decimal strings), e.g. a `default_expr`; `undefined` if unsupported. */
export function evaluateValue(src: string, scope: Scope): unknown {
  const node = compile(src);
  if (!node) return undefined;
  try {
    const v = evalNode(node, scope);
    return v instanceof Num ? v.text : v;
  } catch {
    return undefined;
  }
}
