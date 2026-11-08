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
import { parseSource, printSource, routesOf, type ReleaseReview, type ReleaseRow, type RunDetail, type Shadow, type Task } from "@/lib/solutions";
import { MovePanel, RunPage, RunsPage, WhatHappened } from "../runs/RunsPage";
import { TaskPage, TasksPage } from "../runs/TasksPage";
import { CalendarsPage } from "./CalendarsPage";
import { Diagram, layout } from "./Diagram";
import { businessDays, GuidedEditor } from "./GuidedEditor";
import { ActivationNote, ReleasePage, ShadowResult } from "./ReleasePage";
import { PackArrived, SolutionsPage, template } from "./SolutionsPage";

const me: Me = { tenant: "t", user: { id: "u1", email: "admin@acme.test", full_name: "Admin", is_admin: true, roles: [] }, default_company: null, scopes: {}, fiscal_year_start_month: 4, packages: [] };
const catalog = {
  capabilities: [
    { id: "procs.request.read", version: "1.0.0", label: "Read a request", effect: "query", entity: "Request", input: { properties: { id: {} }, required: ["id"] } },
    {
      id: "procs.order.create",
      version: "1.0.0",
      label: "Create an order",
      effect: "transactional_action",
      entity: "Order",
      input: { properties: { values: {} } },
      completion: "The record exists, committed with this receipt",
      idempotency: "native_receipt",
      unknown_outcome: "reconcile",
      permissions: ["Order:create"],
      limits: { max_attempts: 3, timeout_ms: 30000 },
    },
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

  it("draws a process as a diagram: each step a button, its routes said too, the chosen step's settings beside it", () => {
    const source = parseSource(printSource(template("approval"))).source!;
    const html = render(<Diagram source={source} onChange={() => {}} selected={{ process: "approval", path: [], step: "review" }} onSelect={() => {}} />);
    const t = text(html);
    for (const n of source.processes![0].nodes) expect(t).toContain(n.label || n.id);
    expect(t).toContain("Goes on to");
    expect(t).toContain("Never the requester, whatever roles they hold.");
    expect((html.match(/marker-end=/g) ?? []).length).toBe(layout(source.processes![0]).edges.length);
  });

  it("lays a process out without dropping or changing anything", () => {
    const p = parseSource(printSource(template("approval"))).source!.processes![0];
    p.nodes.push({ type: "end", id: "orphan", label: "Nobody comes here", outcome: "completed", custom: { kept: true } });
    const before = JSON.stringify(p);
    const drawn = layout(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(drawn.placed.map((x) => x.step.id).sort()).toEqual(p.nodes.map((n) => n.id).sort());
    expect(drawn.placed.find((x) => x.step.id === p.entry)!.layer).toBe(0);
    expect(drawn.placed.find((x) => x.step.id === "orphan")!.layer).toBe(Math.max(...drawn.placed.map((x) => x.layer)));
    const routes = p.nodes.flatMap((n) => routesOf(n)).filter(([, to]) => p.nodes.some((m) => m.id === to));
    expect(drawn.edges.length).toBe(routes.length);
  });

  it("says what a step's capability promises, and what a read does not", () => {
    const source = parseSource(printSource(template("approval"))).source!;
    source.processes![0].nodes.push(
      { type: "query", id: "read_it", label: "Read it", capability: { id: "procs.request.read", version: "1.0.0" }, input: { id: "trigger.id" }, next: "order_it", on_error: "attention" },
      { type: "action", id: "order_it", label: "Order it", capability: { id: "procs.order.create", version: "1.0.0" }, input: {}, next: "completed", on_error: "attention" },
    );
    const action = text(render(<GuidedEditor source={source} onChange={() => {}} selected={{ process: "approval", path: [], step: "order_it" }} onSelect={() => {}} />));
    expect(action).toContain("Changes records, all at once or not at all.");
    expect(action).toContain("who needs: create Order.");
    expect(action).toContain("Done means: The record exists, committed with this receipt.");
    expect(action).toContain("each try carries the same receipt, so it is never done twice");
    expect(action).toContain("looked up by its receipt");
    expect(action).toContain("the check refuses it otherwise");
    const read = text(render(<GuidedEditor source={source} onChange={() => {}} selected={{ process: "approval", path: [], step: "read_it" }} onSelect={() => {}} />));
    expect(read).toContain("Reads, and changes nothing.");
    expect(read).not.toContain("looked up by its receipt");
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
      diff: {
        changes: [
          { area: "capability", id: "procs.order.create", kind: "added", changes_records: true },
          { area: "step", id: "approval/notify", kind: "changed", fields: ["input"], values: { input: [{ to: "\"ops@acme.test\"" }, { to: "\"finance@acme.test\"" }] } },
        ],
        privilege_growth: ["procs.order.create"],
      },
    };
    const html = render(<ReleasePage />, "/r/r2", "/r/:id", client([[["solutions", "release", "r2"], review]]));
    const t = text(html);
    expect(t).toContain("procs.order.create");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Approve/s);
    expect(t).toContain("ops@acme.test");
    expect(t).toContain("finance@acme.test");
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

  it("shows what looking up a lost answer found, kept on the item", () => {
    const lookup = {
      by: "u1",
      at: "2026-11-09T10:00:00Z",
      effects: [
        {
          activation: "order",
          on_record: true,
          capability: "procs.order.create",
          at: "2026-11-09T09:59:00Z",
          meaning: "It was done: its receipt is here. Resuming repeats the step under its key, which the receipt answers; nothing is done twice.",
        },
      ],
    };
    const recovery: Task = { ...task, id: "t5", kind: "recovery", label: "Outcome unknown", form: [], material: {}, detail: { reason: "Find out whether the order was made.", resumable: true, lookup } };
    const t = text(render(<TaskPage />, "/t/t5", "/t/:id", client([[["tasks", "t5"], recovery]])));
    expect(t).toContain("On record");
    expect(t).toContain("procs.order.create");
    expect(t).toContain("nothing is done twice");
    expect(t).toContain("Look it up again");
    const fresh = text(render(<TaskPage />, "/t/t6", "/t/:id", client([[["tasks", "t6"], { ...recovery, id: "t6", detail: { reason: "Find out.", resumable: true } }]])));
    expect(fresh).toContain("Look it up");
    expect(fresh).not.toContain("On record");
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

describe("migration and operations screens", () => {
  const side = (outcome: string, decide: string, effects: number) => ({
    outcome,
    decisions: { decide },
    steps: ["snapshot", "review", "order"],
    effects: Array.from({ length: effects }, () => ({ step: "order", capability: "procs.order.create" })),
    not_modelled: [] as string[],
  });
  it("says what an activation replaced, that runs keep their release, and that nothing done is undone", () => {
    const t = text(
      render(
        <ActivationNote
          activated={{ generation: 3, replaced: { release: "r2", version: "1.1.0" }, handed_over: { automation: "a1", name: "Tell about changes" }, open_elsewhere: 2, kept: "" }}
          version="1.0.0"
        />,
      ),
    );
    expect(t).toContain("New runs start under 1.0.0 (generation 3).");
    expect(t).toContain("It replaced 1.1.0.");
    expect(t).toContain("The automation Tell about changes is off now");
    expect(t).toContain("The 2 runs still open under other releases go on under theirs.");
    expect(t).toContain("Nothing a run did is undone");
  });
  it("lists a shadow comparison's differing cases and what differs, the same ones out of the way", () => {
    const shadow: Shadow = {
      against: { kind: "release", release: "r1", version: "1.0.0" },
      candidate: { solution: "acme.requests", version: "1.2.0", artifact_digest: "sha256:c" },
      compared: 2,
      differing: 1,
      cases: [
        {
          run: "01a1ba01-0000-7000-8000-00000000abcd",
          at: "2026-11-08T10:00:00Z",
          same: false,
          differences: ["decisions", "effects"],
          now: side("completed", "review", 1),
          candidate: { ...side("completed", "proceed", 1), not_modelled: ["order"] },
        },
        { run: "01a1ba01-0000-7000-8000-00000000eeee", at: "2026-11-08T09:00:00Z", same: true, differences: [], now: side("refused", "review", 0), candidate: side("refused", "review", 0) },
      ],
      note: "",
    };
    const html = render(<ShadowResult shadow={shadow} />);
    const t = text(html);
    expect(t).toContain("Against 1.0.0, which runs now. 2 cases compared; 1 differ.");
    expect(t).toContain("what it decides, what it changes");
    expect(t).toContain("1 steps with no answer on record");
    expect(t).toContain("Nothing was run, changed or kept");
    expect(html).toContain("/studio/runs/01a1ba01-0000-7000-8000-00000000abcd");
    expect(html).not.toContain("00000000eeee");
  });
  it("says what must be mapped when a pack arrives, and that it is only a draft", () => {
    const t = text(
      render(
        <PackArrived
          taken={{
            draft: { id: "d9", solution: "acme.requests", label: "Requests", version: 1 },
            check: { ok: false, diagnostics: [] },
            to_map: ["the calendar office, which this workspace does not have"],
            note: "",
          }}
        />,
      ),
    );
    expect(t).toContain("Requests arrived as a draft. Nothing of it runs until it is checked here");
    expect(t).toContain("the calendar office, which this workspace does not have");
  });
  it("says how often a step was tried and how its last try went", () => {
    const t = text(
      render(
        <WhatHappened
          state={{ outputs: { order: { id: "O-1" } } }}
          attempts={{ order: { attempts: 3, last: "done" }, notify: { attempts: 2, last: "waits: procs.order.create is out of service here" } }}
        />,
      ),
    );
    expect(t).toContain("How often steps were tried");
    expect(t).toContain("tried 3 times · last: done");
    expect(t).toContain("tried 2 times · waits: procs.order.create is out of service here");
  });
  it("plans a move with a field per waiting step, and leaves its approval to another administrator", () => {
    const run: RunDetail = {
      id: "run-1",
      solution: "acme.requests",
      process: "approve_request",
      status: "running",
      accepted_at: "2026-11-08T08:00:00Z",
      updated_at: "2026-11-08T08:00:00Z",
      release: { id: "r1", version: "1.0.0" },
      state: { waiting: { review: {} } },
      moves: [],
      tasks: [],
    };
    const active: ReleaseRow = { id: "r3", solution: "acme.requests", version: "1.3.0", artifact_digest: "sha256:x", created_at: "2026-11-08T07:00:00Z", active: true, reviews: [] };
    const plan = render(<MovePanel run={run} active={active} meId="u1" isAdmin onDone={() => undefined} />);
    expect(text(plan)).toContain("It runs under 1.0.0; 1.3.0 runs now.");
    expect(text(plan)).toContain("review becomes");
    expect(text(plan)).toContain("Check and plan the move");
    const planned: RunDetail = { ...run, moves: [{ action: "plan_migration", at: "2026-11-08T09:00:00Z", by: "u2", diff: { digest: "sha256:d", moved: ["review moves to approve"] } }] };
    expect(text(render(<MovePanel run={planned} active={active} meId="u1" isAdmin onDone={() => undefined} />))).toContain("Approve the move");
    expect(text(render(<MovePanel run={planned} active={active} meId="u2" isAdmin onDone={() => undefined} />))).toContain("You planned it: another administrator approves it.");
    expect(text(render(<MovePanel run={run} active={active} meId="u9" isAdmin={false} onDone={() => undefined} />))).not.toContain("Move it to another release");
    const refused: RunDetail = { ...planned, moves: [...(planned.moves ?? []), { action: "migration_refused", at: "2026-11-08T09:05:00Z", diff: { digest: "sha256:d", why: ["review was approved meanwhile"] } }] };
    expect(text(render(<MovePanel run={refused} active={active} meId="u1" isAdmin onDone={() => undefined} />))).toContain("The move was refused");
  });
});

describe("a deadline's business days", () => {
  it("changes only for a whole number in range, so a cleared field or a stray key leaves the deadline be", () => {
    expect(businessDays("3")).toBe(3);
    expect(businessDays("")).toBeNull();
    expect(businessDays("S")).toBeNull();
    expect(businessDays("0")).toBeNull();
    expect(businessDays("2.5")).toBeNull();
    expect(businessDays("261")).toBeNull();
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
