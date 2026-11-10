import { describe, expect, it } from "vitest";
import { buildCheck, buildRow, checkable, checkProblems, newCheckRow, numberLiteral, openAs, opsForType, parseCheck, quote, type CheckDraft, type CheckOp } from "./checkBuilder";

const fields = [
  { name: "title", type: "data" },
  { name: "qty", type: "int" },
  { name: "total", type: "currency" },
  { name: "due", type: "date" },
  { name: "starts", type: "datetime" },
  { name: "status", type: "select" },
  { name: "paid", type: "check" },
  { name: "owner", type: "link" },
] as const;
const f = [...fields] as { name: string; type: never }[];

const row = (field: string, op: CheckOp, value = "") => ({ ...newCheckRow(field, op), value });
const one = (field: string, op: CheckOp, value = "") => buildRow(row(field, op, value), fields.find((x) => x.name === field)?.type);

describe("the expression a row comes to, by field type", () => {
  it("compares text with quotes", () => {
    expect(one("title", "eq", "Closed")).toBe("doc.title == 'Closed'");
    expect(one("title", "ne", "Closed")).toBe("doc.title != 'Closed'");
    expect(one("title", "contains", "rush")).toBe("doc.title != null && doc.title.contains('rush')");
    expect(one("status", "eq", "Open")).toBe("doc.status == 'Open'");
  });

  it("compares numbers by their type", () => {
    expect(one("qty", "gte", "5")).toBe("doc.qty >= 5");
    expect(one("qty", "gte", "5.5")).toBeNull();
    expect(one("total", "gt", "1000")).toBe("doc.total > 1000.0");
    expect(one("total", "lte", "-2.50")).toBe("doc.total <= -2.50");
    expect(one("total", "lt", "abc")).toBeNull();
    expect(numberLiteral("decimal", "007.5")).toBe("7.5");
  });

  it("compares dates as ISO text, guarded against an empty one", () => {
    expect(one("due", "lt", "2026-01-31")).toBe("doc.due != null && doc.due < '2026-01-31'");
    expect(one("due", "eq", "2026-01-31")).toBe("doc.due == '2026-01-31'");
    expect(one("due", "eq", "31/01/2026")).toBeNull();
    expect(one("starts", "gte", "2026-01-31T09:00")).toBe("doc.starts != null && doc.starts >= '2026-01-31T09:00'");
    expect(opsForType("datetime")).not.toContain("eq");
  });

  it("says filled in and empty, and yes and no", () => {
    expect(one("title", "filled")).toBe("doc.title != null && doc.title != ''");
    expect(one("owner", "empty")).toBe("doc.owner == null || doc.owner == ''");
    expect(one("paid", "eq", "true")).toBe("doc.paid == true");
    expect(one("paid", "eq", "false")).toBe("doc.paid == false");
  });

  it("offers no comparison a field cannot make", () => {
    expect(one("title", "gt", "a")).toBeNull();
    expect(one("owner", "eq", "x")).toBeNull();
    expect(one("qty", "filled")).toBeNull();
    expect(one("", "eq", "x")).toBeNull();
  });
});

describe("quoting", () => {
  it("escapes quotes, backslashes and line breaks", () => {
    expect(quote("it's")).toBe("'it\\'s'");
    expect(quote("a\\b")).toBe("'a\\\\b'");
    expect(quote("a\nb\t")).toBe("'a\\nb\\t'");
    expect(quote("\u0001")).toBe("'\\u0001'");
    expect(quote("' || true || '")).toBe("'\\' || true || \\''");
  });

  it("cannot be broken out of: the text comes back as it went in", () => {
    for (const v of ["it's", "a\\'b", "' || true || '", "line\nbreak", "\\", "\\\\'", "tab\t", "\u0007"]) {
      const draft: CheckDraft = { join: "all", rows: [row("title", "eq", v)] };
      expect(parseCheck(buildCheck(draft, f), f)?.rows[0].value).toBe(v);
    }
  });
});

describe("joining and reading back", () => {
  it("joins several rows in parentheses with all of or any of", () => {
    const d: CheckDraft = { join: "all", rows: [row("qty", "gt", "0"), row("title", "filled")] };
    expect(buildCheck(d, f)).toBe("(doc.qty > 0) && (doc.title != null && doc.title != '')");
    expect(buildCheck({ ...d, join: "any" }, f)).toBe("(doc.qty > 0) || (doc.title != null && doc.title != '')");
  });

  it("gives nothing until every row is finished", () => {
    const d: CheckDraft = { join: "all", rows: [row("qty", "gt", "0"), row("title", "eq", "")] };
    expect(buildCheck(d, f)).toBe("");
    expect(checkProblems(d, f)).toEqual(["Finish condition 2, or remove it."]);
    expect(checkProblems({ join: "all", rows: [] }, f)).toEqual(["Add at least one condition."]);
  });

  it("reads back every expression it writes, of every type and operator", () => {
    for (const x of fields) {
      for (const op of opsForType(x.type)) {
        const value = x.type === "int" ? "7" : ["decimal", "currency", "percent"].includes(x.type) ? "7.25" : x.type === "date" ? "2026-02-03" : x.type === "datetime" ? "2026-02-03T10:30" : x.type === "check" ? "false" : "it's \\ ok";
        const d: CheckDraft = { join: "any", rows: [row(x.name, op, value), row("qty", "lte", "3")] };
        const text = buildCheck(d, f);
        expect(text, `${x.name} ${op}`).not.toBe("");
        const back = parseCheck(text, f);
        expect(back?.join).toBe("any");
        expect(back?.rows.map(({ field, op, value }) => ({ field, op, value }))).toEqual(d.rows.map(({ field, op, value }) => ({ field, op, value: ["filled", "empty"].includes(op) ? "" : value })));
        expect(buildCheck(back as CheckDraft, f)).toBe(text);
        const single = buildCheck({ join: "all", rows: [d.rows[0]] }, f);
        expect(parseCheck(single, f)?.rows).toHaveLength(1);
      }
    }
  });

  it("calls an expression it did not write advanced", () => {
    for (const text of ["doc.qty > 0 || doc.title != ''", "doc.total < 1000000 || doc.po_no != ''", "size(doc.items) > 0", "doc.qty > 0.0", "doc.total > 5.0 && doc.qty > 1", "doc.nope == 'x'", "(doc.qty > 0) && (doc.qty < 5) || (doc.qty == 9)", "doc.title == 'a' && 'b'", "", "doc.paid == 'x'"]) {
      expect(parseCheck(text, f), text).toBeNull();
      expect(openAs(text, f).mode).toBe("advanced");
    }
    expect(openAs("doc.total > 5.0", f).mode).toBe("builder");
  });
});

describe("the fields a check can be about", () => {
  it("leaves out lines, secrets, what the viewer may not read and what is hidden", () => {
    const all = [{ name: "a", type: "data", can_read: true }, { name: "b", type: "table", can_read: true }, { name: "c", type: "secret", can_read: true }, { name: "d", type: "data" }, { name: "e", type: "data", can_read: true, hidden: true }, { name: "f", type: "check", can_read: true }];
    expect(checkable(all as never).map((x) => x.name)).toEqual(["a", "f"]);
  });
});
