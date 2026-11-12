// The "Messages" panel of a record form, collapsed when empty and open with the sends when not, then axe.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { violations } from "../test/axe";
import { RecordMessages, type Send } from "./MessageLog";

const send = (over: Partial<Send>): Send => ({ id: "s1", template: "bookings.confirmed", channel: "text", recipient: "+4915123456789", state: "delivered", created_at: "2026-11-12T08:00:00Z", updated_at: "2026-11-12T08:01:00Z", ...over });
function page(sends: Send[]) {
  const qc = new QueryClient();
  qc.setQueryData(["messages", "log", { entity: "Booking", record_id: "b1" }], { sends });
  return renderToString(
    <QueryClientProvider client={qc}>
      <RecordMessages entity="Booking" id="b1" />
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the record's messages", () => {
  it("is collapsed when nothing was sent", async () => {
    const html = page([]);
    expect(html).not.toContain("<details class=\"card\" open");
    expect(text(html)).toContain("Nothing has been sent about this record.");
    expect(await violations(html)).toEqual([]);
  });
  it("is open with when, to whom, channel and template, state and reason", async () => {
    const html = page([send({}), send({ id: "s2", channel: "email", recipient: "ann@x.test", state: "skipped", reason: "opted out" }), send({ id: "s3", state: "failed", reason: null, error: "429: slow down" })]);
    expect(html).toContain("<details class=\"card\" open");
    const t = text(html);
    expect(t).toContain("Messages (3)");
    expect(t).toContain("+4915123456789");
    expect(t).toContain("Text message");
    expect(t).toContain("bookings.confirmed");
    expect(t).toContain("Delivered");
    expect(t).toContain("Skipped");
    expect(t).toContain("opted out");
    expect(t).toContain("429: slow down");
    expect(await violations(html)).toEqual([]);
  });
});
