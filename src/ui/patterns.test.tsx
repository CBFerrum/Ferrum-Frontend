// The shared patterns drawn to HTML: roles, words and the states each must keep apart.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageLoading } from "./kit";
import { FormSkeleton, ListSkeleton, ReaderSkeleton, SaveStatus, SelectionToolbar, StatePanel, TableSkeleton, type StateKind } from "./patterns";

describe("StatePanel", () => {
  const role = (kind: StateKind) => /<div [^>]*data-state-kind[^>]*>/.exec(renderToString(<StatePanel kind={kind} />))![0];
  it("gives each kind its live region", () => {
    expect(role("failed")).toContain('role="alert"');
    expect(role("loading")).toContain('role="status"');
    expect(role("loading")).toContain('aria-busy="true"');
    expect(role("no-matches")).toContain('role="status"');
    for (const k of ["empty", "denied", "offline"] as const) expect(role(k)).not.toContain("role=");
  });
  it("shows the error and the actions that belong to the kind", () => {
    const html = renderToString(<StatePanel kind="failed" error={new Error("Gateway timeout")} onRetry={() => {}} onClear={() => {}} />);
    expect(html).toContain("Gateway timeout");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Clear filters");
    expect(renderToString(<StatePanel kind="no-matches" onClear={() => {}} />)).toContain("Clear filters");
  });
  it("offers a retry when offline, and not on the kinds that cannot be retried", () => {
    expect(renderToString(<StatePanel kind="offline" onRetry={() => {}} />)).toContain("Try again");
    expect(renderToString(<StatePanel kind="offline" />)).not.toContain("Try again");
    expect(renderToString(<StatePanel kind="empty" onRetry={() => {}} />)).not.toContain("Try again");
  });
  it("does not say what exists when access is denied", () => {
    expect(renderToString(<StatePanel kind="denied" />)).toContain("You don&#x27;t have access to this");
  });
});

describe("SaveStatus", () => {
  it("never says Saved unless it is saved", () => {
    for (const s of ["draft", "saving", "local", "conflict", "failed", "unknown"] as const) expect(renderToString(<SaveStatus state={s} at="2026-11-10T14:32:00Z" />)).not.toMatch(/>Saved</);
    expect(renderToString(<SaveStatus state="saved" />)).toContain(">Saved<");
    expect(renderToString(<SaveStatus state="local" />)).toContain("Kept on this device");
  });
  it("is a polite status", () => {
    expect(renderToString(<SaveStatus state="saving" />)).toMatch(/role="status"[^>]*aria-live="polite"/);
  });
});

describe("skeletons", () => {
  it("are one status named Loading, with the shapes hidden", () => {
    for (const node of [<ListSkeleton />, <TableSkeleton />, <FormSkeleton />, <ReaderSkeleton />]) {
      const html = renderToString(node);
      expect(html).toMatch(/^<div role="status" aria-label="Loading…"[^>]*><div aria-hidden="true">/);
    }
  });
  it("are the same every time", () => {
    expect(renderToString(<ListSkeleton rows={5} />)).toBe(renderToString(<ListSkeleton rows={5} />));
  });
});

describe("SelectionToolbar", () => {
  const draw = (props: Partial<Parameters<typeof SelectionToolbar>[0]>) => renderToString(<SelectionToolbar label="Actions" count={3} onClear={() => {}} {...props} />);
  it("is a named toolbar that names its scope", () => {
    expect(draw({})).toContain('role="toolbar" aria-label="Actions"');
    expect(draw({})).toContain("3 selected");
    expect(draw({ count: 240, scope: "matching", of: 240 })).toContain("All 240 matching selected");
    const capped = draw({ count: 500, scope: "matching", of: 1200 });
    expect(capped).toContain("500 selected");
    expect(capped).toContain("of 1,200 matching");
    expect(draw({})).toContain("Clear selection");
  });
  it("draws every action before it has been measured, and a hidden copy to measure by", () => {
    const html = draw({ actions: [{ id: "a", label: "Archive", onSelect: () => {} }, { id: "d", label: "Delete", danger: true, onSelect: () => {} }] });
    expect(html.match(/>Archive</g)).toHaveLength(2); // the button and its copy in the gauge
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*inert[^>]*invisible/);
    expect(html).toContain("More actions"); // only the gauge has the More button yet
    expect(html).toContain("btn-danger");
    expect(html).toContain('class="sr-only [@media(width&gt;720px)]:not-sr-only"'); // Clear: icon on a phone, its words kept for readers
  });
  it("is the same bar without actions", () => {
    expect(draw({ children: <button>Assign</button> })).not.toContain("inert");
  });
});

describe("PageLoading", () => {
  it("is a named status shaped like a page: a title bar and rows, no spinner", () => {
    const html = renderToString(<PageLoading label="Loading invoices…" />);
    expect(html).toMatch(/role="status"[^>]*aria-busy="true"/);
    expect(html).toContain("Loading invoices…");
    expect(html.match(/data-slot="skeleton"/g)!.length).toBeGreaterThanOrEqual(6);
    expect(html).not.toContain("spinner");
    expect(renderToString(<PageLoading />)).toContain("Loading…");
  });
});

describe("failureKind", () => {
  it("tells refused, offline and failed apart by the request's status", async () => {
    const { failureKind } = await import("./patterns");
    expect([401, 403, 0, 500, 404].map((status) => failureKind({ status }))).toEqual(["denied", "denied", "offline", "failed", "failed"]);
    expect(failureKind(new Error("boom"))).toBe("failed");
    expect(failureKind(null)).toBe("failed");
  });
});
