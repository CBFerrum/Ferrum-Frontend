// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import invoice from "../../lib/__fixtures__/salesInvoice.layout.json";
import type { Layout } from "../../lib/printLayout";
import { GHOST_MIN, readMarks } from "./marks";

const L = invoice as unknown as Layout;

/** The design-mode markup of §5.2 with §12 item 45's ghosts: "title_cn" (a block whose condition is false), "c_disc" (a table
 *  column whose condition is false), a repeated mark, an id not in the layout, and the slots of a column. */
const HTML = `<!doctype html><html><body class="pf pf-design"><div class="pf-doc">
<section class="pf-section" data-b="head"><div class="pf-cols">
  <div class="pf-col" data-b="head_l">
    <div class="pf-slot" data-slot="head_l:0"></div>
    <div class="pf-block pf-heading pf-h1" data-b="title"><h1>Invoice</h1></div>
    <div class="pf-slot" data-slot="head_l:1"></div>
    <div class="pf-ghost" data-b="title_cn" data-ghost="heading" aria-hidden="true"><span>Heading · title_cn</span></div>
    <div class="pf-slot" data-slot="head_l:2"></div>
    <div class="pf-block pf-field" data-b="status"></div>
    <div class="pf-slot" data-slot="head_l:3"></div>
    <div class="pf-slot" data-slot="head_l:3"></div>
  </div>
</div></section>
<table class="pf-block pf-table" data-b="items"><colgroup><col style="width:0%"></colgroup>
  <thead><tr><th data-b="c_item">Description</th><th class="pf-ghost-col" data-b="c_disc" data-ghost="column" aria-hidden="true"></th></tr></thead>
  <tbody><tr><td data-b="c_item">Widget</td><td class="pf-ghost-col"></td></tr></tbody></table>
<div class="pf-block" data-b="not_in_layout"></div>
</div></body></html>`;

describe("reading the server's design render (§5.2, §12 item 45)", () => {
  const doc = new DOMParser().parseFromString(HTML, "text/html");
  const m = readMarks(doc, L);
  it("finds every part the layout has, once, with its kind", () => {
    expect(m.boxes.map((b) => [b.id, b.kind])).toEqual([["head", "section"], ["head_l", "column"], ["title", "block"], ["title_cn", "block"], ["status", "block"], ["items", "block"], ["c_item", "tcol"], ["c_disc", "tcol"]]);
  });
  it("knows the ghosts: a block whose condition is false and a hidden column, both selectable", () => {
    expect([...m.ghosts]).toEqual(["title_cn", "c_disc"]);
    const col = m.boxes.find((b) => b.id === "c_disc")!;
    expect(col.ghost).toBe(true);
    expect(col.w).toBeGreaterThanOrEqual(GHOST_MIN);
    expect(m.boxes.find((b) => b.id === "title")!.ghost).toBe(false);
  });
  it("reads each drop place once, as column and index", () => {
    expect(m.slots.map((s) => [s.column, s.index])).toEqual([["head_l", 0], ["head_l", 1], ["head_l", 2], ["head_l", 3]]);
  });
});
