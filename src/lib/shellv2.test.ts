import { describe, expect, it } from "vitest";
import { movedApp, newHome } from "./shellv2";

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
    for (const p of ["/pos", "/login", "/e/A/1/x"]) {
      expect(newHome(p), p).toBeNull();
    }
  });
});

describe("the pages of apps that left the web app", () => {
  it("are those apps' pages, for every workspace", () => {
    expect(movedApp("/mail")).toBe("/mail/");
    expect(movedApp("/mail/inbox/M1")).toBe("/mail/inbox/M1");
    expect(movedApp("/chat/c1")).toBe("/chat/c1");
    expect(movedApp("/calendar")).toBe("/calendar/");
    expect(movedApp("/meet/channel/c1")).toBe("/meet/channel/c1");
    expect(movedApp("/drive", "?item=f1")).toBe("/drive/?item=f1");
    expect(movedApp("/drive/d1")).toBe("/drive/d1");
    expect(movedApp("/edit/f1")).toBe("/drive/edit/f1");
    expect(movedApp("/edit/f1/sheets")).toBe("/drive/edit/f1/sheets");
    expect(movedApp("/doc/f1")).toBe("/docs/d/f1");
    expect(movedApp("/docs", "?view=shared")).toBe("/docs/?view=shared");
    expect(newHome("/drive/d1"), "on the shell too").toBe("/drive/d1");
  });

  it("include the pages people open by link, signed in or not", () => {
    expect(movedApp("/s/acme/tok-1")).toBe("/drive/s/acme/tok-1");
    expect(movedApp("/meet/guest/acme/e.x.y.z")).toBe("/meet/guest/acme/e.x.y.z");
    // Odd characters stay encoded once; a bad escape is kept as text.
    expect(movedApp("/s/acme/a%2Fb")).toBe("/drive/s/acme/a%2Fb");
    expect(movedApp("/drive/%E0%A4")).toBe("/drive/%25E0%25A4");
  });

  it("leave the rest of the web app alone", () => {
    for (const p of ["/", "/e/Customer", "/r/x", "/apps", "/admin", "/pos", "/login", "/studio/reports", "/x/a/b"]) expect(movedApp(p), p).toBeNull();
  });
});
