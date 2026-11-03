import { describe, expect, it } from "vitest";
import type { EntitySummary, MetaIndex } from "./meta";
import { search, topics } from "./help";

const perms = (read: "all" | "none") =>
  ({ read, write: "none", create: "none", delete: "none", submit: "none", cancel: "none", export: "none", import: "none" }) as EntitySummary["permissions"];
const entity = (name: string, label: string, description: string, read: "all" | "none" = "all", kind: EntitySummary["kind"] = "document"): EntitySummary => ({
  name, label, label_plural: `${label}s`, kind, submittable: kind === "document", permissions: perms(read), description,
});

const meta: MetaIndex = {
  version: 1,
  packages: [],
  modules: [
    { name: "selling", label: "Selling", order: 20, items: ["SalesInvoice", "Customer"] },
    { name: "accounting", label: "Accounting", order: 10, items: ["JournalEntry"] },
  ],
  entities: [
    entity("SalesInvoice", "Sales Invoice", "Bills a customer for what was sold"),
    entity("Customer", "Customer", "Someone you sell to", "all", "master"),
    entity("JournalEntry", "Journal Entry", "Moves amounts between accounts"),
    entity("Payroll", "Payroll", "Pays people", "none"),
    entity("SalesInvoiceItem", "Sales Invoice Item", "A line", "all", "child"),
  ],
  warnings: [],
};

describe("the help center", () => {
  it("explains what the viewer may read, by module", () => {
    expect(topics(meta).map((t) => t.entity.name)).toEqual(["JournalEntry", "Customer", "SalesInvoice"]);
  });

  it("finds a record type by every word, its names first", () => {
    const all = topics(meta);
    expect(search(all, "customer").map((t) => t.entity.name)).toEqual(["Customer", "SalesInvoice"]);
    expect(search(all, "bills customer").map((t) => t.entity.name)).toEqual(["SalesInvoice"]);
    expect(search(all, "selling").map((t) => t.entity.name)).toEqual(["Customer", "SalesInvoice"]);
    expect(search(all, "payroll")).toEqual([]);
    expect(search(all, "  ")).toHaveLength(3);
  });
});
