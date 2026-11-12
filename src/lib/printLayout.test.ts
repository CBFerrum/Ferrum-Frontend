import { describe, expect, it } from "vitest";
import { record, redo, startHistory, undo } from "../app/designer/logic";
import invoice from "./__fixtures__/salesInvoice.layout.json";
import {
  addSection, allIds, blockFromCatalogue, copiesOffered, duplicateNode, find, freshId, insertBlock, locate, moveBlock, newBlock, nudge, paperMm, paragraphsOf, parseCondition, parseSlot, printPrefScope,
  printQuery, removeNode, resizeColumns, setColumnCount, startingChoice, templateErrorAt, textOf, toNeighbourColumn, toNewSectionAbove, toSave, updateNode, validate, widthsOf, writeCondition,
  type Catalogue, type Choices, type FieldBlock, type Layout, type TableBlock,
} from "./printLayout";

const L = invoice as unknown as Layout;
const blocksOf = (l: Layout, col: string) => {
  const w = locate(l, col);
  return w && w.kind === "column" ? l.sections[w.s].columns[w.c].blocks.map((b) => b.id) : [];
};

const cat: Catalogue = {
  entity: { name: "SalesInvoice", label: "Sales Invoice", submittable: true },
  fields: ["customer", "customer_name", "posting_date", "due_date", "return_against", "po_no", "project", "currency", "total", "discount_amount", "net_total", "total_taxes", "rounding_adjustment", "rounded_total", "grand_total", "terms", "is_return", "ship_to"].map((f) => ({ path: `doc.${f}`, label: f })),
  system: ["number", "status", "docstatus"].map((f) => ({ path: `doc.${f}`, label: f })),
  tables: [
    { path: "doc.items", label: "Items", of: "SalesInvoiceItem", columns: ["item_name", "item", "description", "qty", "uom", "rate", "discount_percent", "net_amount", "amount"].map((f) => ({ path: `row.${f}`, label: f, type: f === "rate" ? "currency" : f === "qty" ? "decimal" : "data" })) },
    { path: "doc.taxes", label: "Taxes", of: "Tax", columns: ["description", "account", "rate", "tax_amount"].map((f) => ({ path: `row.${f}`, label: f })) },
  ],
  links: [
    { path: "links.customer", field: "customer", to: "Customer", label: "Customer", fields: [{ path: "links.customer.customer_name", label: "Customer Name" }, { path: "links.customer.billing_address", label: "Billing" }] },
    { path: "links.customer_address", field: "customer_address", to: "Address", label: "Address", fields: [{ path: "links.customer_address.display", label: "Display" }] },
    { path: "links.ship_to", field: "ship_to", to: "Address", label: "Ship to", fields: [{ path: "links.ship_to.display", label: "Display" }] },
  ],
  company: ["company_name", "acc_print_terms", "acc_bank_name", "acc_bank_account_no", "acc_bank_branch_code", "acc_logo"].map((f) => ({ path: `company.${f}`, label: f, type: f === "acc_logo" ? "attach" : "data" })),
  computed: [{ path: "doc.grand_total", label: "Grand Total in words", format: "words" }],
  print: [{ path: "print.copy", label: "Copy" }, { path: "print.now", label: "Printed at" }],
  settings: [],
};

describe("the worked sales invoice (§4.5)", () => {
  it("passes every check the server makes, with and without the catalogue", () => {
    expect(validate(L)).toEqual([]);
    expect(validate(L, cat)).toEqual([]);
  });
  it("finds every node by id", () => {
    expect(locate(L, "parties")).toEqual({ kind: "section", s: 1 });
    expect(locate(L, "bill")).toEqual({ kind: "column", s: 1, c: 0 });
    expect(locate(L, "cust")).toEqual({ kind: "block", s: 1, c: 0, b: 1 });
    expect(locate(L, "c_qty")).toEqual({ kind: "tcol", s: 2, c: 0, b: 0, t: 1 });
    expect(locate(L, "nope")).toBeNull();
    expect(new Set(allIds(L)).size).toBe(allIds(L).length);
  });
});

describe("changing a layout", () => {
  it("never touches the layout it was given", () => {
    const before = JSON.stringify(L);
    moveBlock(L, "cust", "ship", 0);
    removeNode(L, "items");
    updateNode<FieldBlock>(L, "number", { label: "No." });
    duplicateNode(L, "parties");
    expect(JSON.stringify(L)).toBe(before);
  });
  it("moves a block into another column at a slot, and within its own column", () => {
    const a = moveBlock(L, "cust", "ship", 1);
    expect(blocksOf(a, "bill")).toEqual(["bill_h", "addr"]);
    expect(blocksOf(a, "ship")).toEqual(["ship_h", "cust", "ship_a"]);
    // Down within one column: the slot after "date" (index 3) puts it after "date".
    expect(blocksOf(moveBlock(L, "number", "head_r", 3), "head_r")).toEqual(["copy", "date", "number", "due", "against"]);
    expect(blocksOf(moveBlock(L, "against", "head_r", 0), "head_r")).toEqual(["against", "copy", "number", "date", "due"]);
    // Dropping a block where it already is changes nothing.
    expect(moveBlock(L, "number", "head_r", 1)).toBe(L);
    expect(moveBlock(L, "number", "head_r", 2)).toBe(L);
  });
  it("inserts a block at a slot with an id nobody else has", () => {
    const { layout, id } = insertBlock(L, { id: "number", type: "field", value: "doc.po_no" }, "bill", 99);
    expect(id).toBe("number_2");
    expect(blocksOf(layout, "bill").at(-1)).toBe("number_2");
    expect(validate(layout, cat)).toEqual([]);
  });
  it("removes blocks, table columns (and their totals), columns (blocks kept) and sections, but never the last", () => {
    const t = updateNode<TableBlock>(L, "items", { totals: ["c_qty", "c_amt"] });
    const noQty = removeNode(t, "c_qty");
    expect((find(noQty, "items") as TableBlock).totals).toEqual(["c_amt"]);
    const noShip = removeNode(L, "ship");
    expect(blocksOf(noShip, "bill")).toEqual(["bill_h", "cust", "addr", "ship_h", "ship_a"]);
    const one: Layout = { version: 1, sections: [{ id: "s", columns: [{ id: "c", blocks: [] }] }] };
    expect(removeNode(one, "s")).toBe(one);
    expect(removeNode(one, "c")).toBe(one);
  });
  it("updates properties and removes those set to undefined; never the id", () => {
    const a = updateNode<FieldBlock>(L, "number", { label: null, weight: undefined, id: "x" } as Partial<FieldBlock>);
    expect(find(a, "number")).toEqual({ id: "number", type: "field", value: "doc.number", label: null, align: "end" });
  });
  it("duplicates a block or a whole section with new ids", () => {
    const { layout, id } = duplicateNode(L, "items");
    expect(id).toBe("items_2");
    expect(new Set(allIds(layout)).size).toBe(allIds(layout).length);
    expect(validate(layout)).toEqual([]);
    const s = duplicateNode(L, "sums");
    expect(s.layout.sections[4].id).toBe("sums_2");
    expect(new Set(allIds(s.layout)).size).toBe(allIds(s.layout).length);
  });
  it("moves by keyboard: up and down, into the next or previous column across sections, out to a new section", () => {
    expect(blocksOf(nudge(L, "date", -1), "head_r")).toEqual(["copy", "date", "number", "due", "against"]);
    expect(nudge(L, "copy", -1)).toBe(L);
    expect(nudge(L, "head", 1).sections.map((s) => s.id).slice(0, 2)).toEqual(["parties", "head"]);
    expect((find(nudge(L, "c_qty", 1), "items") as TableBlock).columns.map((c) => c.id).slice(0, 3)).toEqual(["c_item", "c_uom", "c_qty"]);
    const next = toNeighbourColumn(L, "against", 1); // head_r is the last column of "head": on to "bill", first
    expect(blocksOf(next, "bill")[0]).toBe("against");
    const prev = toNeighbourColumn(L, "bill_h", -1); // back to the end of head_r
    expect(blocksOf(prev, "head_r").at(-1)).toBe("bill_h");
    expect(toNeighbourColumn(L, "sign", 1)).toBe(L);
    const out = toNewSectionAbove(L, "items");
    expect(out.layout.sections[2].columns[0].blocks.map((b) => b.id)).toEqual(["items"]);
    expect(out.layout.sections[3].id).toBe("lines");
  });
  it("adds sections, changes a section's columns and resizes them", () => {
    const { layout, section } = addSection(L, "head");
    expect(layout.sections[1].id).toBe(section);
    const two = setColumnCount(L, "parties", 2);
    expect(blocksOf(two, "ship")).toEqual(["ship_h", "ship_a", "po", "project", "cur"]);
    expect(two.sections[1].widths).toBeUndefined();
    const four = setColumnCount(L, "lines", 4);
    expect(four.sections[2].columns.length).toBe(4);
    expect(new Set(allIds(four)).size).toBe(allIds(four).length);
    expect(resizeColumns(L, "head", 0, 2).sections[0].widths).toEqual([9, 3]);
    expect(resizeColumns(L, "head", 0, 9).sections[0].widths).toEqual([11, 1]);
    expect(resizeColumns(L, "head", 1, 1)).toBe(L);
    expect(widthsOf({ id: "x", columns: [{ id: "a", blocks: [] }, { id: "b", blocks: [] }, { id: "c", blocks: [] }] })).toEqual([4, 4, 4]);
  });
  it("undoes and redoes every change through the designer's history", () => {
    let h = startHistory(L);
    h = record(h, moveBlock(h.present, "cust", "ship", 0));
    h = record(h, removeNode(h.present, "items"));
    expect(find(h.present, "items")).toBeNull();
    h = undo(h);
    expect(find(h.present, "items")).not.toBeNull();
    h = undo(h);
    expect(h.present).toBe(L);
    h = redo(redo(h));
    expect(find(h.present, "items")).toBeNull();
  });
});

describe("blocks from the field catalogue", () => {
  it("makes a table with columns, an image for an attach field and amount in words", () => {
    const t = blockFromCatalogue("doc.items", cat, L) as TableBlock;
    expect(t.type).toBe("table");
    expect(t.id).toBe("items_2");
    expect(t.columns.map((c) => c.value)).toEqual(["row.item_name", "row.item", "row.description", "row.qty", "row.uom"]);
    expect(t.columns[3].align).toBe("end");
    expect(blockFromCatalogue("company.acc_logo", cat, L).type).toBe("image");
    const w = blockFromCatalogue("doc.grand_total", cat, L, "words") as FieldBlock;
    expect(w.format).toEqual({ as: "words" });
    expect(freshId(L, "Invoice No.")).toBe("invoice_no");
    expect(freshId(L, "9 lives")).toBe("lives");
    expect(newBlock("spacer", L)).toEqual({ id: "spacer", type: "spacer", height_mm: 6 });
  });
});

describe("the checks before save (§4.2), naming the block", () => {
  const msgs = (l: Layout, o?: { letterhead?: boolean }) => validate(l, cat, o).map((p) => `${p.id}: ${p.message}`);
  it("refuses a label over 80, a heading over 200, a colour that is not #rrggbb and a size off the scale", () => {
    const l = updateNode<FieldBlock>(updateNode(L, "number", { label: "x".repeat(81), color: "red" }), "title", { text: "y".repeat(201), size: "huge" } as never);
    const said = msgs(l).join("\n");
    expect(said).toContain("number: Field “" + "x".repeat(81) + "”: the label is longer than 80 characters.");
    expect(said).toContain("number: Field");
    expect(said).toMatch(/number: .*#rrggbb/);
    expect(said).toMatch(/title: Heading .*longer than 200/);
    expect(said).toMatch(/title: .*size from the scale/);
  });
  it("refuses unknown paths, line fields outside a table and page numbers outside a letter head", () => {
    const l = insertBlock(insertBlock(insertBlock(L, { id: "a", type: "field", value: "links.nope.x" }, "bill", 0).layout, { id: "b", type: "field", value: "row.qty" }, "bill", 0).layout, { id: "c", type: "field", value: "print.page" }, "bill", 0).layout;
    const said = msgs(l).join("\n");
    expect(said).toMatch(/a: .*no field “links.nope.x”/);
    expect(msgs(insertBlock(L, { id: "z", type: "field", value: "doc.not_in_catalogue" }, "bill", 0).layout)).toEqual([]);
    expect(said).toMatch(/b: .*line's field/);
    expect(said).toMatch(/c: .*only in a letter head/);
    const sys = insertBlock(L, { id: "ag", type: "field", value: "links.customer.number" }, "bill", 0).layout;
    expect(msgs(sys)).toEqual([]);
    const tc = updateNode(L, "c_qty", { value: "row.nope" });
    expect(msgs(tc).join()).toMatch(/c_qty: Column “Qty”: the lines have no field “row.nope”/);
  });
  it("counts the limits: columns, table columns, totals ids, ids, conditions", () => {
    const five = updateNode(L, "head", { columns: [1, 2, 3, 4, 5].map((i) => ({ id: `k${i}`, blocks: [] })) });
    expect(msgs(five).join()).toMatch(/head: .*1 to 4 columns/);
    const tot = updateNode<TableBlock>(L, "items", { totals: ["zzz"] });
    expect(msgs(tot).join()).toMatch(/items: .*does not have/);
    const dup = updateNode(L, "bill", { blocks: [{ id: "cust", type: "spacer", height_mm: 2 }, ...(find(L, "bill") as { blocks: unknown[] }).blocks] } as never);
    expect(msgs(dup).join()).toMatch(/used twice/);
    const badId = insertBlock(L, { id: "Bad Id", type: "spacer", height_mm: 2 }, "bill", 0).layout;
    expect(msgs(badId).join()).toMatch(/Bad Id: .*lower case/);
    const sp = insertBlock(L, { id: "sp", type: "spacer", height_mm: 0 }, "bill", 0).layout;
    expect(msgs(sp).join()).toMatch(/sp: Space: the height must be from 1 to 100/);
    const many = updateNode(L, "bill", { blocks: Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, type: "spacer", height_mm: 1 })) } as never);
    expect(msgs(many).join()).toMatch(/bill: .*at most 50 blocks/);
    const cels = updateNode(L, "bill", { blocks: Array.from({ length: 50 }, (_, i) => ({ id: `w${i}`, type: "spacer", height_mm: 1, when: "doc.is_return" })) } as never);
    const cels2 = updateNode(cels, "ship", { blocks: Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, type: "spacer", height_mm: 1, when: "doc.is_return" })) } as never);
    expect(msgs(cels2).join()).toMatch(/at most 100 conditions/);
  });
  it("holds a letter head to its blocks and roots", () => {
    const lh: Layout = { version: 1, sections: [{ id: "h", columns: [{ id: "hc", blocks: [{ id: "n", type: "field", value: "company.company_name" }, { id: "p", type: "field", value: "print.page" }, { id: "d", type: "field", value: "doc.number" }, { id: "t", type: "table", value: "doc.items", columns: [] }] }] }] };
    const said = msgs(lh, { letterhead: true });
    expect(said.filter((x) => x.startsWith("n:") || x.startsWith("p:"))).toEqual([]);
    expect(said.join()).toMatch(/d: .*company's, the settings' and the print's/);
    expect(said.join()).toMatch(/t: .*fields, text, headings/);
  });
});

describe("the server's layout refusals (§6, deviation 8)", () => {
  it("name the node", async () => {
    const { refusedNode } = await import("./printLayout");
    expect(refusedNode("layout.due", "x")).toBe("due");
    expect(refusedNode("layout", "block items: unknown field `colour`, expected one of …")).toBe("items");
    expect(refusedNode("layout", "unknown field `x`")).toBeNull();
    expect(refusedNode("template", "en body, line 1: x")).toBeNull();
  });
  it("let a letter head's footer be empty, and hold it to 20 sections", () => {
    expect(validate({ version: 1, sections: [] }, null, { letterhead: true })).toEqual([]);
    expect(validate({ version: 1, sections: [] }).map((p) => p.message)).toEqual(["A layout needs at least one section."]);
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, columns: [{ id: `c${i}`, blocks: [] }] }));
    expect(validate({ version: 1, sections: many }, null, { letterhead: true }).map((p) => p.message)).toEqual(["A letter head's header or footer has at most 20 sections."]);
  });
});

describe("conditions, text, paper and slots", () => {
  it("reads and writes the three shapes the builder offers, and leaves anything else as CEL", () => {
    expect(parseCondition('doc.in_irn != ""')).toEqual({ path: "doc.in_irn", op: "set" });
    expect(parseCondition('company.in_gstin == ""')).toEqual({ path: "company.in_gstin", op: "empty" });
    expect(parseCondition('doc.payment_type == "Receive"')).toEqual({ path: "doc.payment_type", op: "is", literal: "Receive" });
    expect(parseCondition("doc.docstatus == 1")).toEqual({ path: "doc.docstatus", op: "is", literal: "1" });
    expect(parseCondition("!doc.is_return")).toBeNull();
    expect(parseCondition("doc.items.exists(r, r.discount_percent > 0)")).toBeNull();
    expect(writeCondition({ path: "doc.x", op: "is", literal: 'say "hi"' })).toBe('doc.x == "say \\"hi\\""');
    expect(writeCondition({ path: "doc.docstatus", op: "is", literal: "1" })).toBe("doc.docstatus == 1");
    for (const s of ['doc.a != ""', 'doc.a == ""', 'doc.a == "b"']) expect(writeCondition(parseCondition(s)!)).toBe(s);
  });
  it("turns a text block into lines with {values} and back", () => {
    const ps = paragraphsOf("Thank you, {doc.customer}.\nTotal {doc.grand_total|words}");
    expect(ps).toEqual([
      { spans: [{ t: "Thank you, " }, { v: "doc.customer" }, { t: "." }] },
      { spans: [{ t: "Total " }, { v: "doc.grand_total", format: { as: "words" } }] },
    ]);
    expect(textOf(ps)).toBe("Thank you, {doc.customer}.\nTotal {doc.grand_total|words}");
    expect(paragraphsOf("")).toEqual([{ spans: [{ t: "" }] }]);
  });
  it("knows paper sizes and turns them for landscape", () => {
    expect(paperMm({ size: "A5", orientation: "landscape" })).toEqual({ width: 210, height: 148 });
    expect(paperMm(undefined)).toEqual({ width: 210, height: 297 });
    expect(paperMm({ size: "Custom", width_mm: 80, height_mm: 200, orientation: "portrait" })).toEqual({ width: 80, height: 200 });
  });
  it("reads a design-mode slot", () => {
    expect(parseSlot("bill:1")).toEqual({ column: "bill", index: 1 });
    expect(parseSlot("head-r:0")).toEqual({ column: "head-r", index: 0 });
    expect(parseSlot("bill")).toBeNull();
  });
});

describe("the server's template refusals", () => {
  it("say where they are", () => {
    expect(templateErrorAt("hi body, line 12: unknown filter")).toEqual({ language: "hi", part: "body", line: 12, text: "unknown filter" });
    expect(templateErrorAt("pt-BR footer, line 1: x\ny")).toEqual({ language: "pt-BR", part: "footer", line: 1, text: "x\ny" });
    expect(templateErrorAt("something else")).toBeNull();
  });
});

describe("the print dialog's memory (§6.1)", () => {
  const c: Choices = {
    templates: [
      { key: "selling.sales_invoice", label: "Sales Invoice", output: "page", kind: "layout", copies: ["Original", "Duplicate"] },
      { key: "w.gst", label: "GST", output: "page", kind: "template", languages: ["en", "hi"] },
      { key: "w.csv", label: "CSV", output: "csv" },
    ],
    default: "selling.sales_invoice",
    letterheads: [{ id: "lh1", name: "Acme" }],
    languages: ["en", "ar"],
    copies: ["Original for Recipient"],
  };
  it("names its preference by entity within the scope rule", () => {
    expect(printPrefScope("SalesInvoice")).toBe("print:SalesInvoice");
    expect(printPrefScope("Payroll Run")).toBe("print:Payroll_Run");
  });
  it("opens with what was remembered while it is still offered, else the default", () => {
    expect(startingChoice(c, undefined)).toEqual({ template: "selling.sales_invoice", letterhead: "default", language: "", copies: [] });
    expect(startingChoice(c, { template: "w.gst", letterhead: "lh1", language: "hi", copies: ["Original"] })).toEqual({ template: "w.gst", letterhead: "lh1", language: "hi", copies: [] });
    expect(startingChoice(c, { template: "gone", letterhead: "lhX", language: "ar", copies: ["Duplicate"] })).toEqual({ template: "selling.sales_invoice", letterhead: "default", language: "ar", copies: ["Duplicate"] });
    expect(startingChoice(c, { template: null })).toMatchObject({ template: null });
    expect(startingChoice(c, { template: "w.csv" }).template).toBe("selling.sales_invoice");
    expect(startingChoice({ templates: [], default: null }, undefined).template).toBeNull();
  });
  it("offers a format's own copies, else the settings'", () => {
    expect(copiesOffered(c, "selling.sales_invoice")).toEqual(["Original", "Duplicate"]);
    expect(copiesOffered(c, null)).toEqual(["Original for Recipient"]);
  });
  it("names the format that prints and its file as the server does", async () => {
    const { formatLabel, pdfFileName, printFields } = await import("./printLayout");
    expect(formatLabel(c, undefined, "Sales Invoice")).toBe("Sales Invoice");
    expect(formatLabel(c, "w.gst", "x")).toBe("GST");
    expect(formatLabel({ ...c, default: null, standard: { label: "Standard" } }, undefined, "x")).toBe("Standard");
    expect(formatLabel(undefined, undefined, "Sales Invoice")).toBe("Sales Invoice");
    expect(pdfFileName("GST invoice (ours)", "SINV/0042")).toBe("GST invoice _ours_ SINV_0042.pdf");
    expect(printFields({ template: null, letterhead: "default", language: "", copies: [] })).toEqual({ template: "standard" });
    expect(printFields({ template: "k", letterhead: "lh1", language: "hi", copies: ["Original"] })).toEqual({ template: "k", letterhead: "lh1", language: "hi", copies: ["Original"] });
  });
  it("asks the server with each copy and only what was chosen", () => {
    expect(printQuery({ template: "k", letterhead: "default", language: "", copies: ["A", "B C"], format: "html" })).toBe("?template=k&copy=A&copy=B+C&format=html");
    expect(printQuery({ template: null, letterhead: "none" })).toBe("?template=standard&letterhead=none");
    expect(printQuery({})).toBe("");
  });
});

describe("a format as saved", () => {
  it("leaves out what the server derives or defaults", () => {
    expect(toSave({ key: "k", entity: "E", output: "page", kind: "layout", layout: L, languages: {}, letterhead: "default", enabled: true, roles: [], copies: [] })).toEqual({ key: "k", entity: "E", output: "page", layout: L });
    expect(toSave({ key: "k", entity: "E", output: "page", languages: { en: { body: "x" } }, enabled: false })).toEqual({ key: "k", entity: "E", output: "page", languages: { en: { body: "x" } }, enabled: false });
    expect(toSave({ key: "selling.x", entity: "E", output: "page", layout: L, default: true }).default).toBeUndefined();
  });
});

describe("a letter head's form (§7.5)", () => {
  it("writes header and footer blocks a letter head may hold, and reads them back", async () => {
    const { letterHeadBlocks, letterHeadForm, EMPTY_LETTERHEAD } = await import("./printLayout");
    const f = { ...EMPTY_LETTERHEAD, logo: "/files/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", logo_position: "start" as const, lines: [{ kind: "field" as const, path: "company.company_name", bold: true }, { kind: "text" as const, text: "GSTIN {company.in_gstin}" }], footer: "Page {print.page} of {print.pages}" };
    const b = letterHeadBlocks(f);
    expect(b.header.sections[0].columns.map((c) => c.id)).toEqual(["lh_logo_c", "lh_lines_c"]);
    expect(b.header.sections[0].widths).toEqual([4, 8]);
    for (const part of [b.header, b.footer]) expect(validate({ version: 1, sections: part.sections }, null, { letterhead: true })).toEqual([]);
    expect(letterHeadForm(b.header, b.footer)).toEqual(f);
    expect(letterHeadForm(null, null)).toEqual(EMPTY_LETTERHEAD);
    expect(letterHeadForm({ sections: [{ id: "x", columns: [] }] }, null)).toBeNull();
    const centred = letterHeadBlocks({ ...f, logo_position: "center", footer: "" });
    expect(centred.header.sections[0].columns.length).toBe(1);
    expect(centred.footer.sections).toEqual([]);
    expect(letterHeadForm(centred.header, centred.footer)?.logo_position).toBe("center");
  });
});
