// Renders the designer's parts to HTML (no DOM needed) to check what they show for a layout.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LayoutSection } from "../../lib/formLayout";
import type { EntityMeta } from "../../lib/meta";
import { Canvas } from "./Canvas";
import { LayoutHistory } from "./History";
import { SectionInspector } from "./Inspector";
import type { Customization } from "./logic";

const field = (name: string, type: string, extra = {}) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()), type, can_read: true, can_write: true, ...extra });
const meta = {
  name: "Ticket",
  label: "Ticket",
  label_plural: "Tickets",
  kind: "document",
  submittable: false,
  list: { columns: [] },
  form: [],
  search_fields: [],
  rules: [],
  actions: [],
  fields: [field("title", "data", { required: true }), field("status", "select"), field("notes", "text"), field("customer", "link", { to: "Customer" }), field("extra", "data")],
  children: {},
  permissions: { read: "all", write: "all", create: "all", delete: "all", submit: "none", cancel: "none", export: "all", import: "all" },
} as unknown as EntityMeta;
const layout: LayoutSection[] = [
  { key: "s0", label: "Main", fields: ["title", "status", "notes"], columns: 3, collapsible: false, tab: null, visible_if: null },
  { key: "s1", label: null, fields: ["customer"], columns: 1, collapsible: true, tab: "More", visible_if: "doc.status == 'Open'" },
];
const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("designer rendering", () => {
  it("shows the current tab's sections and fields, the tabs and the unplaced fields", () => {
    const html = renderToString(
      <Canvas meta={meta} layout={layout} onChange={noop} tab={null} onTab={noop} selected="s0" onSelect={noop} flagged={new Set(["s0"])} wide aside={<p>inspector here</p>} />,
    );
    const t = text(html);
    expect(t).toContain("Details");
    expect(t).toContain("More");
    expect(t).toContain("Main");
    expect(t).toContain("Title");
    expect(t).toContain(", required");
    expect(t).toContain("notes · text");
    expect(t).not.toContain("customer · link → Customer"); // in the other tab
    expect(t).toContain("Unplaced fields");
    expect(t).toContain("extra · data");
    expect(t).toContain("has a problem");
    expect(t).toContain("inspector here");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("--cols:3");
  });

  it("opens another tab's sections", () => {
    const t = text(renderToString(<Canvas meta={meta} layout={layout} onChange={noop} tab="More" onTab={noop} selected={null} onSelect={noop} flagged={new Set()} wide={false} />));
    expect(t).toContain("Untitled section");
    expect(t).toContain("customer · link → Customer");
    expect(t).toContain("Conditional");
    expect(t).not.toContain("title · data");
  });

  it("inspects a section with its condition hint and the server's message", () => {
    const props = { meta, layout, onChange: noop, onTab: noop, problems: [], framed: true };
    const t = text(renderToString(<SectionInspector {...props} sectionKey="s1" saveError={null} />));
    expect(t).toContain("Section settings");
    expect(t).toContain("The section shows while this condition is true.");
    const rejected = text(renderToString(<SectionInspector {...props} sectionKey="s1" saveError={{ message: "Section condition: syntax error", sections: ["s1"] }} />));
    expect(rejected).toContain("The server rejected this condition");
    expect(text(renderToString(<SectionInspector {...props} sectionKey={null} saveError={null} />))).toContain("Select a section");
  });

  it("lists saved layouts with the one in use", () => {
    const v = (seq: number, is_active: boolean): Customization => ({
      id: `id${seq}`,
      seq,
      entity: "Ticket",
      op: { op: "set_entity_property", property: "form", value: [{ label: "A", fields: ["title", "status"], tab: "X" }] },
      is_active,
      note: seq === 2 ? "Simpler" : null,
      created_at: "2026-10-29T10:00:00Z",
    });
    const versions = [v(2, true), v(1, false)];
    const t = text(
      renderToString(
        <LayoutHistory meta={meta} loading={false} error={null} onRetry={noop} versions={versions} current={versions[0]} restoring={null} onRestore={noop} />,
      ),
    );
    expect(t).toContain("In use");
    expect(t).toContain("Off");
    expect(t).toContain("1 tab · 1 section · 2 fields");
    expect(t).toContain("Simpler");
    expect(t.match(/Restore/g)).toHaveLength(2); // the older one and the original layout
  });
});
