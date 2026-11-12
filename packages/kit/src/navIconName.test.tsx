// The menu's icon rule: a declared name wins, then the concept dictionary by whole words (longest run first), then the row's kind; never empty.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import entities from "./navIconName.entities.json";
import { NavIcon, navIconsReady } from "./NavIcon";
import { NAV_ICONS } from "./NavIconTable";
import { CONCEPTS, conceptIcon, DICTIONARY, nameWords, NAV_ICON_NAMES, navIcon, REPORT_CONCEPTS, reportIcon } from "./navIconName";

describe("navIcon", () => {
  it("takes the declared icon first, including the shell's older names", () => {
    expect(navIcon({ icon: "receipt", entity: "Customer" })).toBe("receipt");
    expect(navIcon({ icon: "dashboard", kind: "page" })).toBe("layout-dashboard");
    expect(navIcon({ icon: "chart", to: "/r/x" })).toBe("chart-column");
  });
  it("falls from an unknown declared name to the concept, then the kind", () => {
    expect(navIcon({ icon: "no-such-icon", entity: "SalesInvoice" })).toBe("receipt");
    expect(navIcon({ icon: "no-such-icon", kind: "master" })).toBe("list");
  });
  it("matches whole words of a stable name, CamelCase or snake_case, plurals included", () => {
    expect(nameWords("PosInvoice")).toEqual(["pos", "invoice"]);
    expect(nameWords("pos_invoice")).toEqual(["pos", "invoice"]);
    expect(conceptIcon("Invoices")).toBe("receipt");
    expect(conceptIcon("Warehouse")).toBe("warehouse");
    // a substring is not a word: "Bin" is not in "Binder", "Tax" not in "Taxi"
    expect(conceptIcon("Binder")).toBeNull();
    expect(conceptIcon("Taxi")).toBeNull();
  });
  it("takes the longest run of words, the last when equal", () => {
    expect(conceptIcon("JournalEntry")).toBe("notebook"); // not history (entry)
    expect(conceptIcon("PriceList")).toBe("tag");
    expect(conceptIcon("PosClosingEntry")).toBe("lock");
    expect(conceptIcon("PosOpeningEntry")).toBe("store");
    expect(conceptIcon("ItemPrice")).toBe("tag"); // item (package) then price: the head noun
    expect(conceptIcon("TaxRate")).toBe("percent");
  });
  it("falls to the kind and is never empty", () => {
    expect(navIcon({ kind: "report" })).toBe("chart-column");
    expect(navIcon({ to: "/r/zzz" })).toBe("chart-column");
    expect(navIcon({ to: "/r/aging" })).toBe("hourglass"); // a report is known by what it is about
    expect(navIcon({ to: "/x/app/page" })).toBe("app-window");
    expect(navIcon({ to: "/" })).toBe("house");
    expect(navIcon({ entity: "Zzz", kind: "settings" })).toBe("settings");
    expect(navIcon({ entity: "Zzz", kind: "document" })).toBe("file-text");
    expect(navIcon({ entity: "Zzz", kind: "master", submittable: true })).toBe("file-text");
    expect(navIcon({ entity: "Zzz", kind: "master" })).toBe("list");
    expect(navIcon({})).toBe("list");
  });
  it("reads the entity from a /e/ address", () => {
    expect(navIcon({ to: "/e/Patient" })).toBe("heart-pulse");
  });
  it("lets a qualifier (type, group, category) take the icon of the thing it qualifies", () => {
    expect(conceptIcon("CustomerGroup")).toBe(conceptIcon("Customer"));
    expect(conceptIcon("ItemGroup")).toBe(conceptIcon("Item"));
    expect(conceptIcon("LeaveType")).toBe(conceptIcon("Leave"));
    expect(conceptIcon("Zzz Type")).toBe("tags"); // nothing to inherit
  });
  it("tells time and the second word of a family apart", () => {
    expect(conceptIcon("FiscalYear")).toBe("calendar-range");
    expect(conceptIcon("PeriodClosingVoucher")).toBe("lock");
    expect(conceptIcon("Stay")).not.toBe(conceptIcon("Folio"));
    expect(conceptIcon("Lead")).not.toBe(conceptIcon("Opportunity"));
    expect(conceptIcon("SalarySlip")).not.toBe(conceptIcon("ExpenseClaim"));
  });
  it("lists every concept once", () => {
    const all = CONCEPTS.flatMap(([, l]) => l.split(",").map((c) => c.trim()));
    expect(all.filter((c, i) => all.indexOf(c) !== i)).toEqual([]);
  });
});

// Entity names are the menu's rows, listed by app (scripts/nav-icon-entities.py regenerates the file). Reports are not entities.
const byApp = entities as Record<string, string[]>;
/** An app may use one icon on more rows than the limit only when the rows are the same kind of thing. Declare it here: app, icon, why. */
const MAX_PER_ICON = 3;
const EXCEPTIONS: Record<string, Record<string, number>> = {};

describe("every entity of every app", () => {
  it("resolves through a concept, never the fallback", () => {
    const names = Object.values(byApp).flat();
    expect(names.filter((n) => !conceptIcon(n))).toEqual([]);
    expect(names.length).toBeGreaterThan(400);
    expect(Object.keys(byApp).length).toBeGreaterThan(35);
  });
  for (const [app, names] of Object.entries(byApp))
    it(`${app}: no icon on more than ${MAX_PER_ICON} rows unless declared`, () => {
      const rows: Record<string, string[]> = {};
      for (const n of names) (rows[conceptIcon(n) ?? "?"] ??= []).push(n);
      const tooMany = Object.entries(rows).filter(([icon, r]) => r.length > (EXCEPTIONS[app]?.[icon] ?? MAX_PER_ICON));
      expect(tooMany).toEqual([]);
    });
});

// The ERP's reports (the stable names its modules list as `report:`), and five more an accounting menu has; Learn's four. Reports are
// menu rows too, and a row that is only a bar chart says nothing: they take the icon of what they are about (reportIcon).
const ERP_REPORTS = [
  "balance_sheet", "bank_reconciliation", "bank_reconciliation_statement", "budget_variance", "capacity_planning", "cash_flow", "cash_flow_forecast", "consolidated_trial_balance", "deferred_revenue_and_expense",
  "dunning_summary", "finance_overview", "general_ledger", "job_card_summary", "landed_cost_allocation", "material_request_status", "payables", "pick_list_status", "procurement_tracker", "production_plan_status",
  "profit_and_loss", "purchase_analytics", "purchase_register", "quality_inspection_summary", "receivables", "receivables_by_due_date", "sales_register", "statement_of_account", "stock_ageing", "stock_balance",
  "stock_ledger", "stock_reconciliation_variance", "subcontracting_status", "subscription_metrics", "supplier_quotation_comparison", "supplier_scorecard_ranking", "tax_summary", "trial_balance", "variant_stock_matrix",
  "withholding", "work_order_operations",
];
/** More of the kind an accounting or sales menu has. */
const MORE_REPORTS = ["sales_analytics", "gross_profit", "customer_ledger", "expense_claim_summary", "asset_depreciation_schedule"];
const REPORTS = [...ERP_REPORTS, ...MORE_REPORTS];
const LEARN_REPORTS = ["lms_course_completion", "lms_quiz_scores", "lms_learner_progress", "lms_overdue_assignments"];
/** The most rows one icon may have among a group of reports. Forty-five reports cannot all have an icon of their own that means something. */
const MAX_PER_REPORT_ICON = 3;

describe("reports", () => {
  const tally = (names: string[], icon: (n: string) => string) => {
    const rows: Record<string, string[]> = {};
    for (const n of names) (rows[icon(n)] ??= []).push(n);
    return Object.entries(rows).sort((a, b) => b[1].length - a[1].length);
  };
  it("takes the icon of what the report is about, by the report's stable name, from a /r/ address too", () => {
    const at = (n: string) => reportIcon(n);
    expect([at("stock_ageing"), at("receivables_by_due_date"), at("lms_overdue_assignments")]).toEqual(["hourglass", "hourglass", "hourglass"]);
    expect([at("general_ledger"), at("StockLedger")]).toEqual(["book-open", "book-open"]);
    expect([at("tax_summary"), at("withholding")]).toEqual(["percent", "percent"]);
    expect([at("balance_sheet"), at("trial_balance"), at("profit_and_loss"), at("cash_flow"), at("budget_variance")]).toEqual(["scale", "scale", "trending-up", "banknote", "piggy-bank"]);
    expect([at("stock_balance"), at("variant_stock_matrix"), at("purchase_register"), at("sales_register")]).toEqual(["boxes", "table-2", "list", "list"]);
    expect([at("statement_of_account"), at("bank_reconciliation_statement"), at("receivables"), at("payables")]).toEqual(["file-spreadsheet", "diff", "banknote-arrow-down", "banknote-arrow-up"]);
    // a longer run of the entity dictionary beats a shorter report word: a pick list's status is the pick list
    expect([at("pick_list_status"), at("work_order_operations"), at("landed_cost_allocation")]).toEqual(["list-checks", "hammer", "ship"]);
    expect(navIcon({ to: "/r/stock_ageing", kind: "report" })).toBe("hourglass");
    expect(navIcon({ to: "/r/StockAgeing" })).toBe("hourglass");
    expect(navIcon({ entity: "tax_summary", kind: "report" })).toBe("percent");
  });
  it("keeps the bar chart for a report that says nothing about itself, and for rows with no name", () => {
    expect(reportIcon("zzz")).toBe("chart-column");
    expect(reportIcon("monthly_overview")).toBe("chart-pie");
    expect(navIcon({ kind: "report" })).toBe("chart-column");
    expect(navIcon({ to: "/studio/reports", kind: "report" })).toBe("chart-column");
    expect(navIcon({ icon: "receipt", to: "/r/stock_ageing" })).toBe("receipt"); // a declared icon still wins
  });
  it(`gives no icon more than ${MAX_PER_REPORT_ICON} of ${REPORTS.length} reports, and none the bar chart`, () => {
    const rows = tally(REPORTS, (n) => navIcon({ to: `/r/${n}`, kind: "report" }));
    expect(REPORTS).toHaveLength(45);
    expect(rows[0]![1].length).toBeLessThanOrEqual(MAX_PER_REPORT_ICON);
    expect(rows.filter(([, r]) => r.length > MAX_PER_REPORT_ICON)).toEqual([]);
    expect(rows.find(([icon]) => icon === "chart-column")).toBeUndefined();
    console.info(`reports: ${REPORTS.length} rows on ${rows.length} icons, worst ${rows[0]![0]} x${rows[0]![1].length}: ${rows.map(([i, r]) => `${i}:${r.length}`).join(" ")}`);
    expect(rows.length).toBeGreaterThanOrEqual(25); // the number of different icons used (it was one: the bar chart, 45 times)
  });
  it("gives Learn's reports and rows the marks of what they are, the open book only on the course", () => {
    expect(tally(LEARN_REPORTS, (n) => reportIcon(n)).map(([i]) => i).sort()).toEqual(["check-check", "circle-help", "gauge", "hourglass"]);
    const rows: Record<string, string[]> = {};
    for (const n of byApp.lms!) (rows[conceptIcon(n) ?? "?"] ??= []).push(n);
    expect(rows["book-open"]).toEqual(["LmsCourse"]);
    expect(conceptIcon("LmsChapter")).toBe("bookmark");
    expect(conceptIcon("LmsCategory")).toBe("tags");
    for (const n of LEARN_REPORTS) rows[reportIcon(n)] = [...(rows[reportIcon(n)] ?? []), n];
    expect(Object.entries(rows).filter(([, r]) => r.length > MAX_PER_ICON)).toEqual([]);
  });
  it("keeps the whole ERP menu, entities and reports together, to three rows an icon but for two declared kinds of one thing", () => {
    const rows: Record<string, string[]> = {};
    for (const n of byApp.erp!) (rows[conceptIcon(n) ?? "?"] ??= []).push(n);
    for (const n of ERP_REPORTS) (rows[reportIcon(n)] ??= []).push(n);
    // percent: the tax rate of three countries and two tax reports; diff: a stock reconciliation and the three reconciliation reports
    const declared: Record<string, number> = { percent: 5, diff: 4 };
    expect(Object.entries(rows).filter(([icon, r]) => r.length > (declared[icon] ?? MAX_PER_ICON))).toEqual([]);
  });
  it("lists every report word once, and the drawing has every icon they name", () => {
    const all = REPORT_CONCEPTS.flatMap(([, l]) => l.split(",").map((c) => c.trim()));
    expect(all.filter((c, i) => all.indexOf(c) !== i)).toEqual([]);
    for (const [icon] of REPORT_CONCEPTS) expect(NAV_ICONS[icon], icon).toBeTruthy();
  });
});

describe("the drawing", () => {
  it("has exactly the names the resolver can return", () => {
    expect(Object.keys(NAV_ICONS).sort()).toEqual([...NAV_ICON_NAMES].sort());
    for (const icon of DICTIONARY.values()) expect(NAV_ICONS[icon], icon).toBeTruthy();
  });
  it("holds a 16px slot until the table arrives, then draws a decorative 16px stroke", async () => {
    const slot = renderToStaticMarkup(<NavIcon entity="Customer" />);
    expect(slot).toContain('aria-hidden="true"');
    expect(slot).toContain("width:16px");
    expect(slot).not.toContain("<svg");
    await navIconsReady();
    const html = renderToStaticMarkup(<NavIcon entity="Customer" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="16"');
    expect(html).toContain("<svg");
    expect(html).toContain("nav-icon");
    expect(await navIconsReady()).toBeUndefined(); // one promise, asked again at no cost
  });
});
