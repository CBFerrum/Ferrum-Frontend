// Renders the plan and the install result of a pack (no DOM needed), then runs axe over both.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type StaticHandlerContext } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { describePlan, describeResult } from "../lib/packPlan";
import { PlanBody, ResultBody } from "./Packs";

async function page(element: React.ReactNode) {
  const routes = [{ path: "*", element }];
  const { query } = createStaticHandler(routes);
  const context = (await query(new Request("http://localhost/customize/packs"))) as StaticHandlerContext;
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouterProvider router={createStaticRouter(routes, context)} context={context} hydrate={false} />
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const s = (created: string[], changed: string[] = [], unchanged: string[] = []) => ({ created, changed, unchanged });

describe("the packs page", () => {
  it("shows a plan: what the pack is, each section's lists, and the warnings", async () => {
    const plan = describePlan({
      name: "rooms", label: "Rooms", version: 3, digest: "sha256:ab", can_install: true, missing: [], requires: { packages: { core: "1" } },
      sections: { customizations: s(["XRoom: define_entity"]), records: s([], ["XRoom Hall"], ["a", "b", "c", "d", "e", "f"]), solutions: s(["Booking"]), later: s(["New thing"]) },
      warnings: ["The solution Booking arrives as a draft: it runs only once it is kept as a release, reviewed by a second administrator and activated."],
    });
    const html = await page(<PlanBody plan={plan} />);
    const t = text(html);
    expect(t).toContain("Rooms");
    expect(t).toContain("Will be created");
    expect(t).toContain("Will be changed");
    expect(t).toContain("Already there");
    expect(t).toContain("Later");
    expect(t).toContain("reviewed by a second administrator");
    expect(html).toContain("<details>"); // the six that were already there are collapsed
    expect(await violations(html)).toEqual([]);
  });

  it("shows a plan that cannot install with what is missing", async () => {
    const html = await page(<PlanBody plan={describePlan({ name: "p", label: "P", digest: "d", can_install: false, missing: ["the package hr is not installed"] })} />);
    expect(text(html)).toContain("the package hr is not installed");
    expect(await violations(html)).toEqual([]);
  });

  it("shows the result with a failed solution and the links to review", async () => {
    const result = describeResult({ name: "rooms", version: 3, summary: { customizations: s(["XRoom: define_entity"]), solutions: s(["Booking"]) }, failed: [{ solution: "Billing", error: "needs the package books" }] });
    const html = await page(<ResultBody result={result} />);
    const t = text(html);
    expect(t).toContain("These solutions did not import:");
    expect(t).toContain("needs the package books");
    expect(html).toContain('href="/studio/solutions"');
    expect(html).toContain('href="/customize"');
    expect(await violations(html)).toEqual([]);
  });
});
