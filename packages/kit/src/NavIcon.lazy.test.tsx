// If the drawing table never loads, a row still renders its slot (and its label stays the row's name): no throw, no retry storm.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./NavIconTable", () => {
  throw new Error("chunk failed to load");
});

it("renders the empty slot when the chunk is rejected", async () => {
  const { NavIcon, navIconsReady } = await import("./NavIcon");
  await expect(navIconsReady()).resolves.toBeUndefined();
  const html = renderToStaticMarkup(<NavIcon icon="receipt" />);
  expect(html).toContain("nav-icon");
  expect(html).toContain("width:16px");
  expect(html).not.toContain("<svg");
});
