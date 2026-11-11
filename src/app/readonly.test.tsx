// A value the person cannot edit is text in its own place, not a greyed box: still an input element (named by its label,
// selectable), read-only, out of the tab order, an em dash when empty.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Field } from "../lib/meta";
import { FieldControl } from "./widgets";

const field = (type: string): Field => ({ name: "total", label: "Total", type, can_read: true, can_write: false }) as Field;
const render = (type: string, value: unknown, disabled = true) => renderToString(<FieldControl field={field(type)} id="f-total" value={value} onChange={() => {}} disabled={disabled} />);

describe("a field that cannot be edited", () => {
  it("shows its formatted value as read-only text, end-aligned for money, not as a disabled control", () => {
    const html = render("currency", "7500");
    expect(html).toContain('id="f-total"');
    expect(html).toContain("read-value");
    expect(html).toContain("readOnly");
    expect(html).toContain('value="7,500.00"');
    expect(html).toContain("num");
    expect(html).not.toContain("disabled");
    expect(html).toContain('tabindex="-1"');
  });
  it("shows an em dash where there is nothing", () => {
    expect(render("data", null)).toContain('placeholder="—"');
  });
  it("keeps long text as a read-only textarea that grows to fit", () => {
    expect(render("text", "Net 30")).toMatch(/<textarea[^>]*read-value/);
  });
  it("shows a tick it cannot change as a word, named by its label, not as a disabled box", () => {
    const yes = render("check", true);
    expect(yes).toMatch(/<output id="f-total"[^>]*>Yes<\/output>/);
    expect(yes).not.toContain("checkbox");
    expect(yes).not.toContain("disabled");
    expect(render("check", false)).toMatch(/read-text-off[^>]*>No<\/output>/);
    expect(render("check", undefined)).toContain(">No<");
    expect(render("check", true, false)).toContain('type="checkbox"');
  });
  it("is the editable control when the person can edit", () => {
    const html = render("currency", "7500", false);
    expect(html).not.toContain("read-value");
    expect(html).not.toContain("readOnly");
  });
  it("prints an editable date in the same style as a read-only one (the browser's own date box prints in its own format)", () => {
    const editable = render("date", "2026-11-11", false);
    expect(editable).toContain('type="date"');
    expect(editable).toMatch(/<span class="print-value" aria-hidden="true">Nov 11, 2026<\/span>/);
    expect(render("date", "2026-11-11")).toContain('value="Nov 11, 2026"');
  });
});
