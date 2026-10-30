import { describe, expect, it } from "vitest";
import { newHome } from "./shellv2";

describe("today's addresses in a workspace on the shell", () => {
  it("go to their new homes", () => {
    expect(newHome("/")).toBe("/");
    expect(newHome("")).toBe("/");
    expect(newHome("/e/SalesInvoice/0190-a")).toBe("/open/SalesInvoice/0190-a");
    expect(newHome("/e/Customer", "?view=x")).toBe("/open/Customer?view=x");
    expect(newHome("/r/trial_balance")).toBe("/erp/r/trial_balance");
    expect(newHome("/apps")).toBe("/store/");
    expect(newHome("/apps/board/settings")).toBe("/store/apps/board/settings");
    expect(newHome("/admin")).toBe("/admin/");
    expect(newHome("/customize/Customer/form")).toBe("/erp/customize/Customer/form");
    expect(newHome("/x/board/home")).toBe("/erp/x/board/home");
    expect(newHome("/e/A%20B/1")).toBe("/open/A%20B/1");
  });

  it("stay where they have no other home yet", () => {
    for (const p of ["/mail", "/drive/f1", "/doc/1", "/docs", "/chat/c", "/calendar", "/meet", "/pos", "/edit/1", "/s/t/l", "/login", "/e/A/1/x"]) {
      expect(newHome(p), p).toBeNull();
    }
  });
});
