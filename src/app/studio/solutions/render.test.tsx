// Renders the solution, run and task screens to HTML with data shaped like the server's: catches crashes in
// render paths, checks what reaches the page (who did what, why a button is off, refusals first), and runs the
// accessibility check over every screen drawn (FERRUM-UX-005).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { violations } from "../../../test/axe";
import type { Me } from "@/lib/meta";
import { parseSource, printSource, type ReleaseReview, type RunDetail, type Task } from "@/lib/solutions";
import { RunPage, RunsPage } from "../runs/RunsPage";
import { TaskPage, TasksPage } from "../runs/TasksPage";
import { CalendarsPage } from "./CalendarsPage";
import { GuidedEditor } from "./GuidedEditor";
import { ReleasePage } from "./ReleasePage";
import { SolutionsPage, template } from "./SolutionsPage";

const me: Me = { tenant: "t", user: { id: "u1", email: "admin@acme.test", full_name: "Admin", is_admin: true, roles: [] }, default_company: null, scopes: {}, fiscal_year_start_month: 4, packages: [] };
const catalog = {
  capabilities: [
    { id: "procs.request.read", version: "1.0.0", label: "Read a request", effect: "query", entity: "Request", input: { properties: { id: {} }, required: ["id"] } },
    { id: "procs.order.create", version: "1.0.0", label: "Create an order", effect: "transactional_action", entity: "Order", input: { properties: { values: {} } } },
  ],
  events: [{ id: "procs.request.submitted", label: "Request submitted", entity: "Request" }],
};

function client(data: [unknown[], unknown][] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  qc.setQueryData(["me"], me);
  qc.setQueryData(["studio", "catalog"], catalog);
  for (const [key, value] of data) qc.setQueryData(key, value);
  return qc;
}

const drawn: string[] = [];

function render(element: ReactNode, path = "/", routePath = "/", qc = client()): string {
  const router = createMemoryRouter([{ path: routePath, element }], { initialEntries: [path] });
  const html = renderToString(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  drawn.push(html);
  return html;
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("solution screens", () => {
  it("lists drafts and releases with where each stands", () => {
    const html = render(
      <SolutionsPage />,
      "/",
      "/",
      client([
        [
          ["solutions"],
          {
            drafts: [{ id: "d1", solution: "workspace.approval", label: "Approval", version: 3, updated_at: "2026-11-08T07:00:00Z" }],
            releases: [
              { id: "r1", solution: "workspace.approval", version: "0.1.0", artifact_digest: "a", created_at: "2026-11-08T07:00:00Z", active: true, generation: 2, reviews: [] },
              { id: "r2", solution: "workspace.approval", version: "0.2.0", artifact_digest: "b", created_at: "2026-11-08T07:10:00Z", active: false, reviews: [] },
            ],
            calendars: [],
            profile: "full",
          },
        ],
      ]),
    );
    const t = text(html);
    expect(t).toContain("Approval");
    expect(t).toContain("draft 3");
    expect(t).toContain("Running (generation 2)");
    expect(t).toContain("Waiting for review");
  });

  it("draws a process in the guided view, structured steps nested", () => {
    const source = parseSource(printSource(template("approval"))).source!;
    source.processes![0].nodes.push({
      type: "parallel",
      id: "both",
      label: "Tell both sides",
      join: "all",
      branches: [{ id: "a", entry: "a_end", nodes: [{ type: "end", id: "a_end", label: "Told A", outcome: "completed" }] }],
      next: "completed",
      on_error: "attention",
    });
    const html = render(<GuidedEditor source={source} onChange={() => {}} selected={{ process: "approval", path: [], step: "review" }} onSelect={() => {}} />);
    const t = text(html);
    expect(t).toContain("Approve the request");
    expect(t).toContain("Tell both sides");
    expect(t).toContain("Told A");
    expect(t).toContain("Never the requester, whatever roles they hold.");
  });

  it("holds approval back until each new changing capability is consented to", () => {
    const review: ReleaseReview = {
      release: {
        id: "r2",
        solution: "workspace.approval",
        version: "0.2.0",
        source_digest: "s",
        artifact_digest: "a",
        created_by: "u2",
        created_at: "2026-11-08T07:10:00Z",
        profile: "full",
        compiler: "1",
        lock: [{ id: "procs.order.create", version: "1.0.0", digest: "d", effect: "transactional_action" }],
        notes: [],
        rules: 0,
        decisions: 0,
        processes: [{ id: "approval", label: "Approval", trigger: "procs.request.submitted" }],
      },
      active: null,
      reviews: [],
      diff: { changes: [{ area: "capability", id: "procs.order.create", kind: "added", changes_records: true }], privilege_growth: ["procs.order.create"] },
    };
    const html = render(<ReleasePage />, "/r/r2", "/r/:id", client([[["solutions", "release", "r2"], review]]));
    const t = text(html);
    expect(t).toContain("procs.order.create");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Approve/s);
  });

  it("lists calendars with their revision", () => {
    const html = render(<CalendarsPage />, "/", "/", client([[["calendars"], [{ name: "office", zone: "Asia/Kolkata", weekends: ["sat", "sun"], holidays: [], revision: 2 }]]]));
    expect(text(html)).toContain("revision 2");
  });
});

describe("run and task screens", () => {
  const run: RunDetail = {
    id: "run1",
    solution: "workspace.approval",
    process: "approval",
    status: "needs_attention",
    accepted_at: "2026-11-08T07:29:00Z",
    updated_at: "2026-11-08T07:30:00Z",
    tasks: [{ id: "t2", activation: "attention", kind: "recovery", label: "Look into it", status: "open" }],
    state: {
      outputs: {
        review: { decision: "approved", by: "u3" },
        order_it: { error: { code: "stale_approval", message: "the Request approved at version 2 is at version 3 now" } },
      },
      effects: [{ activation: "order_it", capability: "procs.order.create", unwanted: true }],
    },
  };

  it("shows a run's refusals before what went well, and what it did", () => {
    const html = render(<RunPage />, "/runs/run1", "/runs/:id", client([[["runs", "run1"], run]]));
    const t = text(html);
    expect(t).toContain("Needs attention");
    expect(t.indexOf("stale_approval")).toBeLessThan(t.indexOf("review"));
    expect(t).toContain("settled after it was no longer wanted");
    expect(t).toContain("Ask it to stop");
  });

  it("lists runs not finished", () => {
    const html = render(<RunsPage />, "/", "/", client([[["runs"], { runs: [run, { ...run, id: "run2", status: "completed" }], cursor: "1" }]]));
    expect(text(html)).toContain("Needs attention");
    expect(html).not.toContain("/studio/runs/run2");
  });

  it("lists the person's tasks", () => {
    const html = render(<TasksPage />, "/", "/", client([[["tasks"], [{ id: "t1", kind: "task", label: "Approve the request", role: "Reviewer", deadline: "2026-11-10T07:29:00Z" }]]]));
    expect(text(html)).toContain("Approve the request");
  });

  const task: Task = {
    id: "t1",
    kind: "task",
    label: "Approve the request",
    role: "Reviewer",
    run: "run1",
    activation: "review",
    material: { reference: "REQ-1", total: "9000" },
    digest: "abc",
    form: [{ name: "note", label: "Note", type: "data", required: true }],
    approvals: 1,
    delegation: 1,
    handed_on: 0,
    status: "open",
    deadline: "2026-11-10T07:29:00Z",
    deadline_basis: { calendar: "office", revision: 2 },
    detail: {},
  };

  it("shows what a decision is about, with its form", () => {
    const html = render(<TaskPage />, "/t/t1", "/t/:id", client([[["tasks", "t1"], task]]));
    const t = text(html);
    expect(t).toContain("REQ-1");
    expect(t).toContain("office calendar, revision 2");
    expect(t).toContain("To (their email)");
    const spent = text(render(<TaskPage />, "/t/t4", "/t/:id", client([[["tasks", "t4"], { ...task, id: "t4", handed_on: 1 }]])));
    expect(spent).not.toContain("Hand it on");
  });

  it("says why a recovery cannot resume, where a keyboard reaches it", () => {
    const recovery: Task = { ...task, id: "t2", kind: "recovery", label: "Look into it", form: [], material: {}, detail: { reason: "Look into it.", resumable: false } };
    const html = render(<TaskPage />, "/t/t2", "/t/:id", client([[["tasks", "t2"], recovery]]));
    expect(text(html)).toContain("This step has nowhere to resume: it can only end.");
    expect(html).toMatch(/aria-describedby="recover-why-not"/);
  });

  it("shows who did what on a closed task, and why", () => {
    const closed: Task = {
      ...task,
      id: "t3",
      kind: "recovery",
      status: "resolved",
      detail: { reason: "Look into it.", resumable: false },
      history: [{ decision: "end", part: "", reason: "No order is wanted.", at: "2026-11-08T07:35:00Z", by: "Ana Admin" }],
    };
    const t = text(render(<TaskPage />, "/t/t3", "/t/:id", client([[["tasks", "t3"], closed]])));
    expect(t).toContain("This is closed: resolved.");
    expect(t).toContain("Ana Admin ended the run refused");
    expect(t).toContain("No order is wanted.");
  });
});

describe("accessibility", () => {
  it("has nothing axe finds wrong on any screen drawn above", async () => {
    expect(drawn.length).toBeGreaterThan(8);
    const found: string[] = [];
    for (const html of drawn) found.push(...(await violations(html)));
    expect(found).toEqual([]);
  });
});
