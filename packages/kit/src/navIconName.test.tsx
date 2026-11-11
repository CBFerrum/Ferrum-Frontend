// The menu's icon rule: a declared name wins, then the concept dictionary by whole words (longest run first), then the row's kind; never empty.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import entities from "./navIconName.entities.json";
import { NavIcon, navIconsReady } from "./NavIcon";
import { NAV_ICONS } from "./NavIconTable";
import { CONCEPTS, conceptIcon, DICTIONARY, nameWords, NAV_ICON_NAMES, navIcon } from "./navIconName";

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
    expect(navIcon({ to: "/r/aging" })).toBe("chart-column");
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
