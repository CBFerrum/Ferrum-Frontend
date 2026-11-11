// The shared patterns drawn to HTML: roles, words and the states each must keep apart.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
