// A field's label names its control, and a link as a record's title shows the linked title.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recordTitle } from "../lib/meta";
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
});
