// A rule's hidden fields: the body a rule is sent back with (hide and shared kept), the choices, the sentence, and the dialog.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { followsPackage, hideChoices, hideSentence, permissionBody, type Rule } from "../lib/ruleHide";
import { HideDialog } from "./RuleHide";

const rule: Rule = {
  entity: "Project", can_read: true, can_write: true, can_create: false, can_delete: false, can_submit: false, can_cancel: false, can_export: false, can_import: false,
  if_owner: true, read_groups: [], write_groups: [], match_rule: null, via: "customer_email", actions: [], shared: "read", hide: ["notes", "team"], packaged: true,
};
const meta = { name: "Project", label: "Project", fields: [
  { name: "name", label: "Name", type: "text" }, { name: "notes", label: "Notes", type: "text" }, { name: "team", label: "Team", type: "table" }, { name: "sec", label: "Sec", type: "section" }], children: { team: {} } };

describe("a rule's body", () => {
  it("carries hide and shared back, so another checkbox in the row does not take them away", () => {
    const body = permissionBody({ ...rule, can_delete: true });
    expect(body).toMatchObject({ entity: "Project", read: true, delete: true, via: "customer_email", shared: "read", hide: ["notes", "team"] });
    expect(permissionBody({ ...rule, shared: null, hide: undefined }).hide).toEqual([]);
    expect("shared" in permissionBody({ ...rule, shared: null })).toBe(false);
  });
  it("sends the hidden fields chosen, not those it had", () => {
    expect(permissionBody(rule, { hide: [] }).hide).toEqual([]);
  });
});

describe("what can be hidden", () => {
  it("is the entity's fields and its child tables, not its layout", () => {
    expect(hideChoices(meta)).toEqual([{ name: "name", label: "Name", kind: "field" }, { name: "notes", label: "Notes", kind: "field" }, { name: "team", label: "Team", kind: "table" }]);
  });
  it("is said plainly", () => {
    const s = hideSentence("Client", "Project", ["notes", "team"], (n) => ({ notes: "Notes", team: "Team" })[n] ?? n);
    expect(s).toContain("Holders of Client will not see Notes, Team on the Project records");
    expect(hideSentence("Client", "Project", [], (n) => n)).toBe("Nothing is hidden by this rule.");
    expect(followsPackage(rule)).toBe(true);
    expect(followsPackage({ packaged: false })).toBe(false);
  });
});

describe("the dialog", () => {
  it("shows the choices ticked as the rule has them, the sentence, and that a packaged rule becomes the workspace's own", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["meta", "Project"], meta);
    const html = renderToString(<QueryClientProvider client={qc}><HideDialog role="Client" rule={rule} entityLabel="Project" onClose={() => {}} onSaved={() => {}} /></QueryClientProvider>);
    expect(html).toMatch(/checked[^>]*>\s*Notes/);
    expect(html).not.toMatch(/checked[^>]*>\s*Name\b/);
    expect(html).toContain("follows its package");
    expect(html).toContain("Holders of Client will not see");
    expect(await violations(html)).toEqual([]);
  });
});
