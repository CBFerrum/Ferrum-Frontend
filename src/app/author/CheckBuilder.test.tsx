// Renders the check builder to HTML for rows (one, and two joined), for an expression typed by hand (advanced)
// and for one with unfinished rows, then runs axe over each.

import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../../test/axe";
import type { Field } from "../../lib/meta";
import { CheckInput, checkStateOf, checkText, startCheck } from "./CheckBuilder";

const f = (name: string, type: string, extra = {}) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()), type, can_read: true, can_write: true, ...extra }) as unknown as Field;
const fields = [f("title", "data"), f("qty", "int"), f("total", "currency"), f("due", "date"), f("status", "select", { options: ["Open", "Closed"] }), f("paid", "check"), f("secret_note", "secret"), f("lines", "table")];
const draw = (state = startCheck()) => renderToString(<MemoryRouter><CheckInput fields={fields} state={state} onChange={() => {}} /></MemoryRouter>);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the check builder", () => {
  it("shows a fresh check as one row with what is missing", async () => {
    const html = draw();
    expect(html).toContain('aria-label="Field of condition 1"');
    expect(html).toContain("Advanced: type the expression");
    expect(text(html)).toContain("Finish condition 1, or remove it.");
    expect(html).not.toContain("secret_note");
    expect(html).not.toContain(">Lines<");
    expect(await violations(html)).toEqual([]);
  });

  it("opens an expression it wrote as rows, joined, and shows what they come to", async () => {
    const expr = "(doc.qty >= 5) || (doc.due != null && doc.due < '2026-01-31')";
    const state = checkStateOf(expr, fields);
    expect(state.advanced).toBe(false);
    const html = draw(state);
    const t = text(html);
    expect(t).toContain("any of these holds");
    expect(t).toContain("Written as");
    expect(t).toContain(expr);
    expect(checkText(state, fields)).toBe(expr);
    expect(html).toContain('value="2026-01-31"');
    expect(await violations(html)).toEqual([]);
  });

  it("opens an expression typed by hand in advanced", async () => {
    const state = checkStateOf("doc.status != 'Closed' || doc.remarks != ''", fields);
    expect(state.advanced).toBe(true);
    const html = draw(state);
    expect(html).toContain("doc.status != &#x27;Closed&#x27; || doc.remarks != &#x27;&#x27;");
    expect(text(html)).toContain("Variables: doc, old, user, today, now");
    expect(checkText(state, fields)).toBe("doc.status != 'Closed' || doc.remarks != ''");
    expect(await violations(draw(state))).toEqual([]);
  });

  it("sends nothing while a row is unfinished", () => {
    expect(checkText(startCheck(), fields)).toBe("");
  });
});
