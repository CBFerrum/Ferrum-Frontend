// Renders the Rules tab to HTML (no DOM needed) for a draft with a check over a lookup, a check over an
// aggregate, a derivation and a rule the editor cannot show, then runs axe over it.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../../../test/axe";
import type { EntityMeta } from "@/lib/meta";
import type { Diagnostic, Source } from "@/lib/solutions";
import { RulesEditor, type RuleSelection } from "./RulesEditor";

const field = (name: string, type: string, extra = {}) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()).replace("_", " "), type, can_read: true, can_write: true, ...extra });
const meta = (name: string, fields: unknown[], extra = {}) => ({ name, label: name, label_plural: `${name}s`, kind: "document", submittable: false, fields, children: {}, ...extra }) as unknown as EntityMeta;
const entities = ["Visit", "Charge", "Member"].map((name) => ({ name, label: name, label_plural: `${name}s`, kind: "document", submittable: false }));

function page(source: Source, selected: RuleSelection | null = null, diagnostics: Diagnostic[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["meta"], { version: 1, packages: [], modules: [], entities, warnings: [] });
  qc.setQueryData(["meta", "Visit"], meta("Visit", [field("member", "link", { to: "Member" }), field("x_flag", "check"), field("notes", "text")], { custom: false }));
  qc.setQueryData(["meta", "Charge"], meta("Charge", [field("member", "link", { to: "Member" }), field("amount", "currency"), field("status", "select", { options: ["Unpaid", "Paid"], in_filter: true })]));
  qc.setQueryData(["meta", "Member"], meta("Member", [field("name", "data"), field("credit_limit", "currency")]));
  return renderToString(
    <QueryClientProvider client={qc}>
      <RulesEditor source={source} onChange={() => {}} selected={selected} onSelect={() => {}} diagnostics={diagnostics} onSource={() => {}} />
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

const visit = {
  id: "no_visit_while_unpaid",
  entity: "Visit",
  phase: "validate",
  field: "member",
  audit_refusals: true,
  aggregates: [{ name: "unpaid", entity: "Charge", link: "member", to: "member", filter: [["status", "=", "Unpaid"]], op: "count" }],
  lookups: [{ name: "who", link: "member", fields: ["credit_limit", "name"] }],
  check: "aggregates.unpaid == 0",
  message: "This member has unpaid charges",
};
const fill = { id: "band", entity: "Visit", phase: "derive", writes: { x_flag: "true" } };
const odd = { id: "odd", entity: "Visit", phase: "validate", check: "true", message: "m", lookups: [{ name: "l", link: "member", fields: ["name"], note: "x" }] };
const source: Source = { id: "acme.rules", rules: [visit, fill, odd] };

describe("the Rules tab", () => {
  it("lists the rules and shows the selected one's parts", async () => {
    const html = page(source, { rule: 0, part: "" });
    const t = text(html);
    expect(t).toContain("no_visit_while_unpaid");
    expect(t).toContain("Checks");
    expect(t).toContain("Fills in");
    expect(t).toContain("A rule the editor cannot show");
    for (const word of ["Refuse a save unless…", "Only when", "Linked records it reads", "Counts and totals", "Record every refusal", "rights of the person who saves", "whatever the person saving may see", "do not see each other's records", "lookups.who.credit_limit", "aggregates.unpaid", "A whole number: compare it with 0."]) expect(t, word).toContain(word);
    expect(html).toContain('value="This member has unpaid charges"');
    expect(await violations(html)).toEqual([]);
  });

  it("offers only the combinations whose links fit, and the saved record or one of its links", () => {
    const html = page(source, { rule: 0, part: "" });
    expect(html).toContain("the Member of this record");
    expect(html).toContain("this record");
  });

  it("shows a derivation as rows of field and value", async () => {
    const html = page(source, { rule: 1, part: "" });
    expect(html).toContain('aria-label="Value of row 1"');
    expect(html).toContain('value="true"');
    expect(await violations(html)).toEqual([]);
  });

  it("shows a rule it cannot represent read-only, with a way to the Source tab", async () => {
    const html = page(source, { rule: 2, part: "" });
    const t = text(html);
    expect(t).toContain("Change it in the Source tab");
    expect(t).toContain("Open the Source tab");
    expect(html).toContain("&quot;note&quot;: &quot;x&quot;");
    expect(await violations(html)).toEqual([]);
  });

  it("puts a diagnostic's words on the part its pointer names", async () => {
    const d: Diagnostic[] = [
      { code: "TYPE", message: "aggregates.unpaid is a whole number, not a text", pointer: "/rules/0/check", fault: true },
      { code: "FIELD", message: "Charge has no field state", pointer: "/rules/0/aggregates/0/filter/0", fault: true },
      { code: "X", message: "Something about the whole rule", pointer: "/rules/0", fault: true },
    ];
    const html = page(source, { rule: 0, part: "check" }, d);
    const t = text(html);
    expect(t).toContain("aggregates.unpaid is a whole number, not a text");
    expect(html.indexOf("aria-invalid")).toBeGreaterThan(-1);
    expect(t).toContain("Charge has no field state");
    expect(t).toContain("Something about the whole rule");
    expect(await violations(html)).toEqual([]);
  });

  it("says what a draft with no rules is for", async () => {
    const html = page({ id: "x" });
    expect(text(html)).toContain("This draft has no rules yet");
    expect(await violations(html)).toEqual([]);
  });

  it("leaves rules that are not a list to the Source tab", () => {
    expect(text(page({ rules: {} } as unknown as Source))).toContain("not a list");
  });
});
