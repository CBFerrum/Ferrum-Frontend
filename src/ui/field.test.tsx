// A field's label names its control, and a link as a record's title shows the linked title.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recordTitle, singleRecord } from "../lib/meta";
import { Field } from "./kit";

describe("Field", () => {
  it("names a single control that has no id", () => {
    const html = renderToString(
      <Field label="Customer">
        <input className="input" />
      </Field>,
    );
    const label = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
    expect(label).toBeTruthy();
    expect(html).toContain(`<input class="input" id="${label}"`);
  });

  it("keeps an id given to the control or the field", () => {
    expect(renderToString(<Field label="A"><input id="mine" /></Field>)).toContain('for="mine"');
    const html = renderToString(<Field label="B" htmlFor="theirs"><input /></Field>);
    expect(html).toContain('for="theirs"');
    expect(html).not.toMatch(/<input[^>]*id=/);
  });

  it("leaves a component alone, and several controls unnamed", () => {
    const Custom = () => <span>x</span>;
    expect(renderToString(<Field label="C"><Custom /></Field>)).not.toContain("for=");
    expect(renderToString(<Field label="D"><input /><input /></Field>)).not.toContain("for=");
  });
});

describe("recordTitle", () => {
  it("shows a link's title, not its id", () => {
    const meta = { title_field: "risk" };
    expect(recordTitle(meta, { id: "a", risk: "01a1a58b-73aa", _titles: { risk: "Single cell for the EU region" } })).toBe("Single cell for the EU region");
    expect(recordTitle(meta, { id: "a", risk: "Plain words" })).toBe("Plain words");
  });

  it("names settings by what they are, not by an id", () => {
    const row = { id: "01a1ad8d-e2b6-72c6-b015-44112acce0ac" };
    expect(recordTitle({ title_field: null, kind: "settings", label: "Field Service Settings" }, row)).toBe("Field Service Settings");
    expect(recordTitle({ title_field: null, kind: "document", label: "Stock Entry" }, row)).toBe("2acce0ac");
  });

  it("opens a workspace's settings as their one record, and lists a company's", () => {
    expect(singleRecord({ kind: "settings" })).toBe(true);
    expect(singleRecord({ kind: "settings", company_scoped: true })).toBe(false);
    expect(singleRecord({ kind: "master" })).toBe(false);
  });
});
