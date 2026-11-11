// The gallery's sections drawn to HTML: no axe violations in the light theme, and one assertion per pattern.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../../src/test/axe";
import { Sections } from "./src/Gallery";

describe("the gallery", () => {
  it("has no axe violations (light theme)", async () => {
    expect(await violations(`<h1>Ferrum gallery</h1>${renderToString(<Sections />)}`)).toEqual([]);
  });

  it("has stable section ids", () => {
    const html = renderToString(<Sections />);
    for (const id of ["type", "colour", "buttons", "inputs", "record-form", "badges", "tabs", "overlays", "alerts", "states", "skeletons", "save", "selection", "toast", "anatomy", "chips", "work-home"]) expect(html).toContain(`id="g-${id}" data-gallery="${id}"`);
  });
});
