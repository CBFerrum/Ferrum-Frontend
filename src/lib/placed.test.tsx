import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { placed } from "./placed";

describe("a sentence with things in its places", () => {
  it("puts each thing where the sentence has its place, in the sentence's order", () => {
    expect(renderToStaticMarkup(<p>{placed("وجّه {host} إلى {target}.", { target: <code>a.example</code>, host: <b>shop</b> })}</p>)).toBe(
      "<p>وجّه <b>shop</b> إلى <code>a.example</code>.</p>",
    );
    expect(renderToStaticMarkup(<p>{placed("Keep {unknown} as it is", {})}</p>)).toBe("<p>Keep {unknown} as it is</p>");
  });
});
