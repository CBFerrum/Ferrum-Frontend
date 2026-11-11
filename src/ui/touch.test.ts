// @vitest-environment node
// On a touch device what a person presses is 44px: the coarse-pointer rules name each control the sweep found short.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const coarse = css.split("@media (pointer: coarse) {").slice(1).join("\\n");
const rule = (selector: string) => coarse.slice(coarse.indexOf(selector), coarse.indexOf("}", coarse.indexOf(selector)));

describe("touch targets", () => {
  it("makes each short control 44px", () => {
    for (const sel of [".segmented button {", '[data-slot="button"][data-size="xs"],', ".home-section-end a {"]) expect(rule(sel), sel).toMatch(/min-height: 44px/);
  });
  it("gives a 16px checkbox, radio and a switch a 44px hit area", () => {
    expect(coarse).toMatch(/\[data-slot="checkbox"\]::after,[\s\S]*?inset: -15px;/);
    expect(coarse).toMatch(/\[data-slot="switch"\]::after \{[\s\S]*?inset: -15px -7px;/);
  });
});
