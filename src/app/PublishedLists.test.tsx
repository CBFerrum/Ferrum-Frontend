// The published list form rendered with a list that has record pages, counters and framing, then axe.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { fromList } from "../lib/publishedListDraft";
import type { EntityMeta } from "../lib/meta";
import { ListForm } from "./PublishedLists";

const field = (name: string, type: string) => ({ name, label: name.replace(/^./, (c) => c.toUpperCase()), type, can_read: true, can_write: true });
const meta = { name: "Article", label: "Article", kind: "document", submittable: false, form: [{ fields: ["title", "body", "views", "helpful", "unhelpful"] }], children: {}, numbering: null,
  fields: [field("title", "data"), field("body", "text"), field("views", "int"), field("helpful", "int"), field("unhelpful", "int")] } as unknown as EntityMeta;
const list = { name: "help", label: "Help", fields: ["title"], slug: "title", detail: ["body"], summary: "title", frame_origins: ["https://town.example"], count_views: "views", votes: { up: "helpful", down: "unhelpful" } };

function form(start: ReturnType<typeof fromList>) {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <StaticRouter location="/customize/Article/lists">
        <ListForm meta={meta} start={start} taken={[]} onClose={() => {}} />
      </StaticRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the published list form", () => {
  const html = form(fromList(list));
  it("shows the settings a list with record pages has, as saved", async () => {
    expect(text(html)).toContain("Record pages");
    expect(html).toContain("https://town.example");
    expect(html).toMatch(/<select id="pl-views"[^>]*>.*?<option value="views" selected/s);
    expect(html).toMatch(/<select id="pl-up"[^>]*>.*?<option value="helpful" selected/s);
    expect(await violations(html)).toEqual([]);
  });
  it("offers no counters until a record page address is chosen", () => {
    const t = text(form(fromList({ name: "x", label: "X", fields: ["title"] })));
    expect(t).toContain("No record pages");
    expect(t).not.toContain("Count each page’s visitors in");
  });
});
