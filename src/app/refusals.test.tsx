// What a refused save and an empty list say: the error summary names fields, and a list has one state per reason.

import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { ErrorSummary } from "./FormView";
import { ListNothing } from "./ListView";

const kind = (html: string) => /data-state-kind="([^"]+)"/.exec(html)?.[1];
const list = (props: Parameters<typeof ListNothing>[0]) => renderToString(<MemoryRouter><ListNothing {...props} /></MemoryRouter>);

describe("the error summary", () => {
  it("lists the fields and table rows by their labels, each as a button", () => {
    const html = renderToString(
      <ErrorSummary
        onGo={() => {}}
        items={[
          { text: "Customer", field: "customer" },
          { text: "Items row 2, Qty", message: "must be more than 0", field: "qty", row: ["items", 1] },
          { text: "Items", message: "add at least one row", field: "items" },
        ]}
      />,
    );
    expect(html.match(/<button type="button"/g)).toHaveLength(3);
    expect(html).toContain(">Customer</button>");
    expect(html.replace(/<!-- -->/g, "")).toContain(">Items row 2, Qty</button>: must be more than 0");
    expect(html).toContain("Fields to fix");
    expect(html).not.toContain("role=");
  });
  it("is nothing when no field was named", () => {
    expect(renderToString(<ErrorSummary items={[]} onGo={() => {}} />)).toBe("");
  });
});

describe("a list with nothing to show", () => {
  it("says no matches, with one clear action, when a search or filter hid the rows", () => {
    const html = list({ filtered: true, onClear: () => {}, label: "Invoice", labelPlural: "Invoices", newHref: "/e/Invoice/new" });
    expect(kind(html)).toBe("no-matches");
    expect(html.match(/Clear filters/g)).toHaveLength(1);
    expect(html).not.toContain("No matching records");
    expect(html).not.toContain("New Invoice");
  });
  it("offers the first record when there are none and the person may create one", () => {
    const html = list({ label: "Invoice", labelPlural: "Invoices", newHref: "/e/Invoice/new" });
    expect(kind(html)).toBe("empty");
    expect(html).toContain("No invoices yet");
    expect(html).toContain("New Invoice");
    expect(kind(list({ label: "Invoice", labelPlural: "Invoices" }))).toBe("empty");
    expect(list({ label: "Invoice", labelPlural: "Invoices" })).not.toContain("New Invoice");
  });
  it("is denied on a 403, without saying what exists, and failed with a retry otherwise", () => {
    const denied = list({ error: new ApiError(403, "forbidden", "No access") });
    expect(kind(denied)).toBe("denied");
    expect(denied).not.toContain("Try again");
    const failed = list({ error: new Error("Gateway timeout"), onRetry: () => {} });
    expect(kind(failed)).toBe("failed");
    expect(failed).toContain("Try again");
  });
});
