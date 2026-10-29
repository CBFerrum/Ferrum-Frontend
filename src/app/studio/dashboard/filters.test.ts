import { describe, expect, it } from "vitest";
import type { FilterDef } from "@/lib/studio";
import { asRange, choosesValues, cleanFilterDef, filterDefIssues, filterName, readValues, writeValues } from "./filters";

const defs: FilterDef[] = [
  { name: "company", type: "link", to: "Company" },
  { name: "period", type: "date_range", default: { from: "start_of_year", to: "today" } },
  { name: "returns", type: "check" },
  { name: "status", type: "select", options: ["Paid", "Unpaid"] },
];

describe("filter values in the URL", () => {
  it("reads typed values and skips blanks and unknown names", () => {
    const sp = new URLSearchParams("f.company=c1&f.period=2026-01-01..&f.returns=0&f.status=&f.nope=1&tab=x");
    expect(readValues(sp, defs)).toEqual({ company: "c1", period: { from: "2026-01-01" }, returns: false });
    expect(readValues(new URLSearchParams("f.period=..&f.returns=maybe"), defs)).toEqual({});
  });

  it("writes them back, keeping other parameters", () => {
    const sp = writeValues(new URLSearchParams("edit=1&f.company=old"), defs, { company: "c2", period: { from: "today-29d", to: "today" }, returns: true, status: " " });
    expect(sp.toString()).toBe("edit=1&f.company=c2&f.period=today-29d..today&f.returns=1");
    expect(readValues(sp, defs)).toEqual({ company: "c2", period: { from: "today-29d", to: "today" }, returns: true });
    expect(choosesValues(new URLSearchParams("edit=1"), defs)).toBe(false);
  });

  it("reads ranges from anything", () => {
    expect(asRange({ from: " ", to: "today" })).toEqual({ to: "today" });
    expect(asRange("2026")).toBeNull();
    expect(asRange([1, 2])).toBeNull();
  });
});

describe("filter definitions", () => {
  it("names filters after their labels", () => {
    expect(filterName("Customer Group", [])).toBe("customer_group");
    expect(filterName("Company", ["company"])).toBe("company_2");
    expect(filterName("2026 Budget", [])).toBe("f_2026_budget");
    expect(filterName("!!!", [])).toBe("filter");
    expect(filterName("Équipe", [])).toBe("equipe");
  });

  it("finds what the server would refuse", () => {
    const issues = filterDefIssues([
      { name: "Company", type: "link" },
      { name: "status", type: "select", options: [] },
      { name: "status", type: "data" },
    ]);
    expect(issues.map((i) => i.path)).toEqual(["filters[0].name", "filters[0].to", "filters[1].options", "filters[2].name"]);
  });

  it("stores only what applies", () => {
    expect(cleanFilterDef({ name: "status", label: " ", type: "select", options: [" Paid ", ""], to: "X", field: "", default: "Paid" })).toEqual({
      name: "status",
      type: "select",
      options: ["Paid"],
      default: "Paid",
    });
    expect(cleanFilterDef({ name: "period", type: "date_range", default: { from: "", to: "" } })).toEqual({ name: "period", type: "date_range" });
  });
});
