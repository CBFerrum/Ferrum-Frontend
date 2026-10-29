import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

describe("markdown", () => {
  it("reads blocks", () => {
    const doc = parseMarkdown("# Welcome\n\nFirst line\nsecond line\n\n- one\n- two\n\n3. three\n4. four\n\n> quoted\n\n---\n\n```\ncode *here*\n```");
    expect(doc.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "quote", "hr", "code"]);
    expect(doc[1]).toEqual({ t: "p", c: [{ t: "text", v: "First line" }, { t: "br" }, { t: "text", v: "second line" }] });
    expect(doc[3]).toMatchObject({ t: "ol", start: 3 });
    expect(doc[6]).toEqual({ t: "code", v: "code *here*" });
  });

  it("reads emphasis, code and links", () => {
    expect(parseInline("**bold** and *it* and ~~gone~~ and `x*y`")).toEqual([
      { t: "strong", c: [{ t: "text", v: "bold" }] },
      { t: "text", v: " and " },
      { t: "em", c: [{ t: "text", v: "it" }] },
      { t: "text", v: " and " },
      { t: "del", c: [{ t: "text", v: "gone" }] },
      { t: "text", v: " and " },
      { t: "code", v: "x*y" },
    ]);
    expect(parseInline("[Invoices](/app/e/SalesInvoice)")).toEqual([{ t: "link", href: "/app/e/SalesInvoice", c: [{ t: "text", v: "Invoices" }] }]);
    expect(parseInline("see https://docs.test/a.")).toEqual([
      { t: "text", v: "see " },
      { t: "link", href: "https://docs.test/a", c: [{ t: "text", v: "https://docs.test/a" }] },
      { t: "text", v: "." },
    ]);
  });

  it("leaves snake_case, lone stars and escapes alone", () => {
    expect(parseInline("customer_group and item_group")).toEqual([{ t: "text", v: "customer_group and item_group" }]);
    expect(parseInline("2 * 3 = 6")).toEqual([{ t: "text", v: "2 * 3 = 6" }]);
    expect(parseInline("\\*not em\\*")).toEqual([{ t: "text", v: "*not em*" }]);
  });

  it("drops unsafe link targets but keeps their text", () => {
    expect(parseInline("[click](javascript:alert(1))")).not.toContainEqual(expect.objectContaining({ t: "link" }));
    expect(parseInline("[x](javascript:void)")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("[x](//evil.test)")).toEqual([{ t: "text", v: "x" }]);
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("#top")).toBe("#top");
  });

  it("stays fast on text that never closes", () => {
    const t = performance.now();
    parseInline("*a ".repeat(7000));
    expect(performance.now() - t).toBeLessThan(500);
  });
});
