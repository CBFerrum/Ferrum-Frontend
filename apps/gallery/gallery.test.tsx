// The gallery's sections drawn to HTML: no axe violations in the light theme, and one assertion per pattern.

import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { preloadRichTextEditor } from "../../src/ui/richtext";
import { violations } from "../../src/test/axe";
import { RichTextExamples, Sections } from "./src/Gallery";

// The rich-text section's editors are a lazy chunk (TipTap): fetched here, in setup with its own time, so no import is left
// running into a test or past the file's end. Drawn to a string they show their frame-shaped placeholder.
beforeAll(() => preloadRichTextEditor(), 30_000);

describe("the gallery", () => {
  it("has no axe violations (light theme)", async () => {
    expect(await violations(`<h1>Ferrum gallery</h1>${renderToString(<Sections without={["rich-text"]} />)}`)).toEqual([]);
  }, 30_000); // axe over every section but rich text (checked below): a few seconds alone, more on a busy machine (as solutions/render.test.tsx)

  it("has no axe violations in the rich-text section on its own", async () => {
    expect(await violations(`<h1>Rich text</h1>${renderToString(<RichTextExamples />)}`)).toEqual([]);
  }, 15_000);

  it("has stable section ids", () => {
    const html = renderToString(<Sections />);
    for (const id of ["type", "colour", "buttons", "inputs", "record-form", "badges", "tabs", "overlays", "alerts", "states", "skeletons", "save", "selection", "toast", "anatomy", "chips", "work-home", "rich-text"]) expect(html).toContain(`id="g-${id}" data-gallery="${id}"`);
  });
});
