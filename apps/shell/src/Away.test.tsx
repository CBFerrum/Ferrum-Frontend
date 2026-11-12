// The Away form on the account page rendered to HTML, then axe.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "@/test/axe";
import { Away } from "./Account";

describe("the away form", () => {
  const html = renderToString(<Away />);
  it("asks for the days, the person and why, each labelled", () => {
    for (const label of ["From", "To", "Who decides for you", "Why"]) expect(html).toContain(label);
    expect(html).toContain('type="date"');
  });
  it("passes axe", async () => {
    expect(await violations(html)).toEqual([]);
  });
});
