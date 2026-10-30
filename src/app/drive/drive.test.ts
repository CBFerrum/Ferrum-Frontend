import { describe, expect, it } from "vitest";
import { copyName, readOnlyReason } from "./BrowserEdit";
import { type BrowserEditor, editable, editorsFor, extension, sizeLabel } from "./Drive";

describe("drive", () => {
  it("knows which files the editor opens", () => {
    for (const n of ["Plan.docx", "budget.XLSX", "deck.pptx", "notes.odt", "old.doc", "data.csv"]) expect(editable(n), n).toBe(true);
    for (const n of ["photo.png", "report.pdf", "docx", "archive.zip"]) expect(editable(n), n).toBe(false);
  });

  it("shows sizes the way people read them", () => {
    expect([null, 0, 1023, 1024, 15_360, 5_242_880, 3 * 1024 ** 3].map(sizeLabel)).toEqual(["", "0 B", "1023 B", "1.0 KB", "15 KB", "5.0 MB", "3.0 GB"]);
  });

  const sheets: BrowserEditor = { id: "sheets", title: "Spreadsheet (GridCraft)", kind: "browser", program: "gridcraft", types: ["xlsx", "csv"], max_mb: 50, app: "drive-editors", version: "0.1.0" };
  const pdf: BrowserEditor = { ...sheets, id: "pdf", title: "PDF (PdfCraft)", program: "pdfcraft", types: ["pdf"], max_mb: undefined };
  const file = (name: string, size = 1000) => ({ id: "f1", name, size });

  it("offers the online editor first, then the browser editors for the type", () => {
    const both = { online: true, browser: [sheets, pdf] };
    expect(editorsFor(file("Budget.XLSX"), both).map((c) => c.key)).toEqual(["online", "sheets"]);
    expect(editorsFor(file("Budget.xlsx"), both)[1].to).toBe("/edit/f1/sheets");
    expect(editorsFor(file("report.pdf"), both).map((c) => c.key)).toEqual(["pdf"]);
    expect(editorsFor(file("budget.xlsx"), { online: false, browser: [sheets] }).map((c) => c.key)).toEqual(["sheets"]);
    expect(editorsFor(file("photo.png"), both)).toEqual([]);
    expect(editorsFor(file("README"), both)).toEqual([]);
  });

  it("puts editors that cannot take a file last, saying why", () => {
    const big = editorsFor(file("budget.xlsx", 60 * 1024 * 1024), { online: false, browser: [sheets] });
    expect(big).toEqual([{ key: "sheets", label: "Spreadsheet (GridCraft)", to: "/edit/f1/sheets", unavailable: "larger than 50 MB" }]);
    expect(editorsFor(file("budget.xlsx", 60 * 1024 * 1024), { online: true, browser: [sheets] }).map((c) => c.key)).toEqual(["online", "sheets"]);
    expect(editorsFor(file("huge.pdf", 5e9), { online: false, browser: [pdf] })[0].unavailable).toBeUndefined();
  });

  it("reads extensions and names copies", () => {
    expect(["a.XLSX", "archive.tar.gz", "README", ".env"].map(extension)).toEqual(["xlsx", "gz", "", "env"]);
    expect(["budget.xlsx", "a.b.docx", "README", ".env"].map(copyName)).toEqual(["budget (copy).xlsx", "a.b (copy).docx", "README (copy)", ".env (copy)"]);
  });

  it("says why a file opened read-only", () => {
    expect(readOnlyReason({ held_by: "me@acme.test", held_in: "browser" }, "me@acme.test")).toBe("You are editing this file in another tab or window.");
    expect(readOnlyReason({ held_by: "ana@acme.test", held_in: "browser" }, "me@acme.test")).toBe("ana@acme.test is editing this file in a browser editor.");
    expect(readOnlyReason({ held_by: null, held_in: "online" }, "me@acme.test")).toBe("Someone is editing this file in the online editor.");
    expect(readOnlyReason({ held_by: "ana@acme.test", held_in: "checkout" }, "me@acme.test")).toBe("ana@acme.test has checked this file out.");
    expect(readOnlyReason({ held_by: null, held_in: null }, "me@acme.test")).toBe("You can view this file but not change it.");
  });
});
