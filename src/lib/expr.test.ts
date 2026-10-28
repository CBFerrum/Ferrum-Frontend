import { describe, expect, it } from "vitest";
import { evaluate, evaluateValue } from "./expr";

const doc = {
  payment_type: "Receive",
  is_return: false,
  update_stock: true,
  outstanding_amount: "1500.00",
  grand_total: "1500",
  credit_limit: "999.99",
  qty: 3,
  status: "Unpaid",
  return_against: null,
  posting_date: "2026-10-28",
  due_date: "2026-11-27",
};

describe("evaluate", () => {
  it("handles equality on strings", () => {
    expect(evaluate("doc.payment_type == 'Receive'", { doc })).toBe(true);
    expect(evaluate("doc.payment_type != 'Receive'", { doc })).toBe(false);
    expect(evaluate('doc.payment_type == "Pay"', { doc })).toBe(false);
  });

  it("handles booleans, negation and bare fields", () => {
    expect(evaluate("doc.update_stock", { doc })).toBe(true);
    expect(evaluate("doc.is_return", { doc })).toBe(false);
    expect(evaluate("!doc.is_return", { doc })).toBe(true);
    expect(evaluate("!!doc.update_stock", { doc })).toBe(true);
    expect(evaluate("doc.is_return == false", { doc })).toBe(true);
    expect(evaluate("true && !false", { doc })).toBe(true);
  });

  it("handles && || and parentheses with precedence", () => {
    expect(evaluate("doc.is_return || doc.update_stock && doc.status == 'Unpaid'", { doc })).toBe(true);
    expect(evaluate("(doc.is_return || doc.update_stock) && doc.status == 'Paid'", { doc })).toBe(false);
    expect(evaluate("!(doc.is_return && doc.update_stock)", { doc })).toBe(true);
  });

  it("handles null", () => {
    expect(evaluate("doc.return_against == null", { doc })).toBe(true);
    expect(evaluate("doc.return_against != null", { doc })).toBe(false);
    expect(evaluate("doc.missing == null", { doc })).toBe(true);
    expect(evaluate("!doc.return_against", { doc })).toBe(true);
    expect(evaluate("doc.return_against > 0", { doc })).toBe(false);
  });

  it("compares decimal strings and numbers exactly", () => {
    expect(evaluate("doc.outstanding_amount > 0.0", { doc })).toBe(true);
    expect(evaluate("doc.outstanding_amount == 1500", { doc })).toBe(true);
    expect(evaluate("doc.grand_total == doc.outstanding_amount", { doc })).toBe(true);
    expect(evaluate("doc.grand_total > doc.credit_limit", { doc })).toBe(true);
    expect(evaluate("doc.qty >= 3 && doc.qty < 3.5", { doc })).toBe(true);
    expect(evaluate("doc.qty > -1", { doc })).toBe(true);
    expect(evaluate("0.1 < 0.10000000000000000001", { doc })).toBe(true);
  });

  it("compares dates as strings", () => {
    expect(evaluate("doc.due_date >= doc.posting_date", { doc })).toBe(true);
    expect(evaluate("doc.due_date == null || doc.due_date >= doc.posting_date", { doc })).toBe(true);
  });

  it("supports parent in child rows, user and in-lists", () => {
    const row = { item: "x", qty: "2" };
    expect(evaluate("parent.update_stock && doc.qty > 1", { doc: row, parent: doc })).toBe(true);
    expect(evaluate("parent.status in ['Paid', 'Unpaid']", { doc: row, parent: doc })).toBe(true);
    expect(evaluate("'Accounts Manager' in user.roles", { doc, user: { roles: ["Accounts Manager"] } })).toBe(true);
    expect(evaluate("parent.status == 'Unpaid'", { doc: row })).toBe(false);
  });

  it("returns undefined for expressions outside the subset", () => {
    expect(evaluate("doc.code.matches('^[A-Z]{3}$')", { doc })).toBeUndefined();
    expect(evaluate("size(doc.items) > 0", { doc })).toBeUndefined();
    expect(evaluate("doc.a + 1 > 2", { doc })).toBeUndefined();
    expect(evaluate("doc.x ? 1 : 2", { doc })).toBeUndefined();
    expect(evaluate("doc.payment_type == ", { doc })).toBeUndefined();
    expect(evaluate("(doc.is_return", { doc })).toBeUndefined();
    expect(evaluate("'unterminated", { doc })).toBeUndefined();
    expect(evaluate("unknown_var == 1", { doc })).toBeUndefined();
    expect(evaluate("doc.status < 3", { doc })).toBeUndefined();
  });

  it("supports escapes and index access", () => {
    expect(evaluate("doc.name == 'O\\'Brien'", { doc: { name: "O'Brien" } })).toBe(true);
    expect(evaluate("doc['payment_type'] == 'Receive'", { doc })).toBe(true);
    expect(evaluate("doc.tags[1] == 'b'", { doc: { tags: ["a", "b"] } })).toBe(true);
  });
});

describe("evaluateValue", () => {
  it("evaluates simple default expressions to values", () => {
    expect(evaluateValue("today", { doc: {} })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(evaluateValue("user.default_company", { doc: {}, user: { default_company: "c1" } })).toBe("c1");
    expect(evaluateValue("user.default_company", { doc: {}, user: null })).toBeNull();
    expect(evaluateValue("1.50", { doc: {} })).toBe("1.50");
    expect(evaluateValue("'Draft'", { doc: {} })).toBe("Draft");
    expect(evaluateValue("now()", { doc: {} })).toBeUndefined();
  });
});
