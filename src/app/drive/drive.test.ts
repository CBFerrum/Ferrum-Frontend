import { describe, expect, it } from "vitest";
import { editable, sizeLabel } from "./Drive";

describe("drive", () => {
  it("knows which files the editor opens", () => {
    for (const n of ["Plan.docx", "budget.XLSX", "deck.pptx", "notes.odt", "old.doc", "data.csv"]) expect(editable(n), n).toBe(true);
    for (const n of ["photo.png", "report.pdf", "docx", "archive.zip"]) expect(editable(n), n).toBe(false);
  });

  it("shows sizes the way people read them", () => {
    expect([null, 0, 1023, 1024, 15_360, 5_242_880, 3 * 1024 ** 3].map(sizeLabel)).toEqual(["", "0 B", "1023 B", "1.0 KB", "15 KB", "5.0 MB", "3.0 GB"]);
  });
});
