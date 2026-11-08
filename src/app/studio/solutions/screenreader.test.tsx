// @vitest-environment jsdom
// A virtual screen reader (Guidepup's) reads the solution, run and task screens as a screen reader does: from the
// accessibility tree, item by item, in order. It is not a person who uses assistive technology, and FLC-UI-004
// still waits for that audit. It hears what such a person would hear wrong: a control or field without a name, a
// decision read before what it decides, a refusal read after what went well.

import { virtual } from "@guidepup/virtual-screen-reader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { Me } from "@/lib/meta";
import { parseSource, printSource, type RunDetail, type Task } from "@/lib/solutions";
import { RunPage } from "../runs/RunsPage";
import { TaskPage } from "../runs/TasksPage";
import { GuidedEditor } from "./GuidedEditor";
import { template } from "./SolutionsPage";

const me: Me = { tenant: "t", user: { id: "u1", email: "reviewer@acme.test", full_name: "Reviewer", is_admin: false, roles: ["Reviewer"] }, default_company: null, scopes: {}, fiscal_year_start_month: 4, packages: [] };
const catalog = {
  capabilities: [
    { id: "procs.request.read", version: "1.0.0", label: "Read a request", effect: "query", entity: "Request", input: { properties: { id: {} }, required: ["id"] } },
    { id: "procs.order.create", version: "1.0.0", label: "Create an order", effect: "transactional_action", entity: "Order", input: { properties: { values: {} } } },
  ],
  events: [{ id: "procs.request.submitted", label: "Request submitted", entity: "Request" }],
};

// jsdom draws no pseudo-elements; the reader asks for their content when naming things, and finds none.
const computed = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element, pseudo?: string | null) =>
  pseudo ? ({ content: "none", getPropertyValue: () => "" } as unknown as CSSStyleDeclaration) : computed(elt)) as typeof window.getComputedStyle;

/** What a screen reader says moving through `element`, item by item, from the start of the page to its end. */
async function spoken(element: ReactNode, path = "/", routePath = "/", data: [unknown[], unknown][] = []): Promise<string[]> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  qc.setQueryData(["me"], me);
  qc.setQueryData(["studio", "catalog"], catalog);
  for (const [key, value] of data) qc.setQueryData(key, value);
  const router = createMemoryRouter([{ path: routePath, element }], { initialEntries: [path] });
  document.body.innerHTML = `<main>${renderToString(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )}</main>`;
  await virtual.start({ container: document.body });
  for (let i = 0; i < 2000 && (await virtual.lastSpokenPhrase()) !== "end of document"; i++) await virtual.next();
  const log = await virtual.spokenPhraseLog();
  await virtual.stop();
  return log;
}

const ROLES = ["button", "link", "textbox", "combobox", "spinbutton", "checkbox", "radio", "listbox", "slider", "switch"];

/** Each control spoken without a name: what someone using a screen reader cannot tell apart. */
const unnamed = (log: string[]) => log.filter((p) => ROLES.some((r) => p === r || p.startsWith(`${r}, ,`)));

/** Where in what was said a phrase starting with `start` first comes. */
const at = (log: string[], start: string) => log.findIndex((p) => p.startsWith(start));

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

describe("what a screen reader says", () => {
  it("names every control of the guided editor, its steps and the chosen step's settings", async () => {
    const source = parseSource(printSource(template("approval"))).source!;
    const log = await spoken(<GuidedEditor source={source} onChange={() => {}} selected={{ process: "approval", path: [], step: "review" }} onSelect={() => {}} />);
    expect(unnamed(log)).toEqual([]);
    expect(at(log, "navigation, Steps of Approval")).toBeGreaterThan(-1);
    // A step is a button saying its kind, its name and where it goes next; the chosen one is said to be current.
    expect(log).toContain("button, Person decides Approve the request start next → completed · on_reject → refused · on_timeout → attention, current item");
    expect(at(log, "region, Inspector")).toBeGreaterThan(at(log, "navigation, Steps of Approval"));
    expect(log).toContain("Never the requester, whatever roles they hold.");
    expect(log).toContain("radio, A duration, checked, position 1, set size 2");
    expect(log.at(-1)).toBe("end of document");
  });

  it("reads a task's subject before its decision, says what must be filled in, and why a button is off", async () => {
    const log = await spoken(<TaskPage />, "/t/t1", "/t/:id", [[["tasks", "t1"], task]]);
    expect(unnamed(log)).toEqual([]);
    expect(log).toContain("heading, Approve the request, level 1");
    expect(at(log, "region, What you decide on")).toBeLessThan(at(log, "button, Approve"));
    expect(log.indexOf("REQ-1")).toBeLessThan(at(log, "button, Approve"));
    expect(log.indexOf("9000")).toBeLessThan(at(log, "button, Reject"));
    // A field the form requires is said to be required, not only marked with a star.
    expect(log).toContain("textbox, Note, required");
    expect(log).toContain("button, Hand it on, disabled");
    expect(log).toContain("Someone holding the role, who has not had it before; never the requester.");
  });

  it("reads a run's refusal before what went well, and what stopping it would do", async () => {
    const log = await spoken(<RunPage />, "/runs/run1", "/runs/:id", [[["runs", "run1"], run]]);
    expect(unnamed(log)).toEqual([]);
    expect(log).toContain("heading, approval, level 1");
    expect(log.indexOf("stale_approval: the Request approved at version 2 is at version 3 now")).toBeLessThan(log.indexOf("review"));
    expect(log).toContain("settled after it was no longer wanted");
    expect(at(log, "Work already in hand still settles")).toBeLessThan(at(log, "button, Ask it to stop"));
    expect(log).toContain("button, Ask it to stop, disabled");
  });
});
