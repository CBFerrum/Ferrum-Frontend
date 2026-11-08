import { describe, expect, it } from "vitest";
import {
  addStep,
  blankStep,
  defaultScenario,
  mergeRuns,
  newProcess,
  newStepId,
  ordered,
  outline,
  parseSource,
  printSource,
  removeStep,
  requireCapability,
  routedFrom,
  stepAt,
  updateStep,
  type Process,
  type Run,
  type Source,
} from "./solutions";
import { inputFields } from "@/app/studio/solutions/GuidedEditor";
import { releaseState, template } from "@/app/studio/solutions/SolutionsPage";

const source = (): Source => ({
  schema_version: "ferrum.solution/1",
  kind: "Solution",
  id: "acme.requests",
  version: "1.0.0",
  label: "Requests",
  requires: [{ id: "procs.request.read", version: "1.0.0" }],
  ui: { layout: { snapshot: { x: 10, y: 20 } } },
  processes: [
    {
      id: "approve",
      label: "Approve",
      trigger: { event: "procs.request.submitted", business_key: "trigger.id" },
      entry: "snapshot",
      max_steps: 50,
      nodes: [
        { type: "query", id: "snapshot", label: "Read it", capability: { id: "procs.request.read", version: "1.0.0" }, input: { id: "trigger.id" }, next: "review", on_error: "attention" },
        { type: "human_task", id: "review", label: "Approve it", role: "Reviewer", material: "snapshot.output", timeout: "P2D", next: "lines", on_reject: "refused", on_timeout: "attention", future_setting: { kept: true } },
        {
          type: "for_each",
          id: "lines",
          label: "Each line",
          items: "snapshot.output.lines",
          key: "item.code",
          max_items: 10,
          body: { id: "line", entry: "hold", nodes: [{ type: "action", id: "hold", label: "Hold it", next: "held", on_error: "held" }, { type: "end", id: "held", label: "Held", outcome: "completed" }] },
          next: "completed",
          on_error: "attention",
        },
        { type: "end", id: "completed", label: "Completed", outcome: "completed" },
        { type: "end", id: "refused", label: "Refused", outcome: "refused" },
        { type: "suspend", id: "attention", label: "Needs attention", reason: "Look into it." },
      ],
    },
  ],
});

const proc = (s: Source) => s.processes![0] as Process;

describe("the guided view's edits", () => {
  it("change what they name and keep everything else, settings they do not know included", () => {
    const s = source();
    const next = updateStep(s, "approve", [], "review", { label: "Two reviewers approve", approvals: 2 });
    const review = proc(next).nodes.find((n) => n.id === "review")!;
    expect([review.label, review.approvals, review.future_setting]).toEqual(["Two reviewers approve", 2, { kept: true }]);
    expect(next.ui).toEqual(s.ui);
    expect(proc(s).nodes.find((n) => n.id === "review")!.label).toBe("Approve it");
    // Source → guided → source: the same definition.
    expect(parseSource(printSource(next)).source).toEqual(next);
    // An empty value takes the setting away.
    expect(updateStep(next, "approve", [], "review", { approvals: "" }).processes![0].nodes.find((n) => n.id === "review")!.approvals).toBeUndefined();
  });

  it("reach steps inside a structured step's block", () => {
    const next = updateStep(source(), "approve", ["lines", "line"], "hold", { label: "Hold the line's stock" });
    const hold = (proc(next).nodes.find((n) => n.id === "lines")!.body as { nodes: { id: string; label: string }[] }).nodes[0];
    expect(hold.label).toBe("Hold the line's stock");
  });

  it("add a step with a unique id, and never remove one other steps route to", () => {
    const s = source();
    const id = newStepId(proc(s), "Approve it");
    expect(id).toBe("approve_it");
    expect(newStepId(proc(s), "Review")).toBe("review_2");
    const added = addStep(s, "approve", [], blankStep("delay", "pause", "Pause", "completed"));
    expect(proc(added).nodes.map((n) => n.id)).toContain("pause");
    expect(routedFrom(proc(s).nodes, "attention")).toEqual(["snapshot", "review", "lines"]);
    expect(removeStep(s, "approve", [], "attention")).toBe(s);
    expect(proc(removeStep(added, "approve", [], "pause")).nodes.map((n) => n.id)).not.toContain("pause");
  });

  it("ask for a capability once, at the version chosen", () => {
    const s = requireCapability(source(), { id: "procs.order.create", version: "1.2.0" });
    expect(s.requires).toEqual([
      { id: "procs.request.read", version: "1.0.0" },
      { id: "procs.order.create", version: "1.2.0" },
    ]);
    expect(requireCapability(s, { id: "procs.order.create", version: "9.9.9" })).toBe(s);
  });

  it("start a process with its two ends", () => {
    const s = newProcess(source(), "Approve", "procs.order.created");
    expect(s.processes!.map((p) => p.id)).toEqual(["approve", "approve_2"]);
    expect(s.processes![1].nodes.map((n) => n.type)).toEqual(["end", "end"]);
  });
});

describe("the outline", () => {
  it("follows the routes from the entry, a structured step's block nested under it", () => {
    const items = outline(proc(source()));
    expect(items.map((o) => [o.step.id, o.depth])).toEqual([
      ["snapshot", 0],
      ["review", 0],
      ["lines", 0],
      ["hold", 1],
      ["held", 1],
      ["completed", 0],
      ["attention", 0],
      ["refused", 0],
    ]);
    // From the process's entry, whatever is listed first.
    const fromEntry = outline({ ...proc(source()), entry: "review" }).map((o) => o.step.id);
    expect(fromEntry[0]).toBe("review");
    expect(fromEntry).toContain("snapshot");
    expect(items.find((o) => o.step.id === "hold")!.path).toEqual(["lines", "line"]);
    expect(ordered([{ type: "end", id: "b", label: "" }, { type: "end", id: "a", label: "" }], "a").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("finds the step a diagnostic points at, inside blocks too", () => {
    const s = source();
    expect(stepAt(s, { pointer: "/processes/0/nodes/1/timeout" })).toEqual({ process: 0, step: "review" });
    expect(stepAt(s, { pointer: "/processes/0/nodes/2/body/nodes/0/capability" })).toEqual({ process: 0, step: "hold" });
    expect(stepAt(s, { pointer: "/processes/0/nodes/9", node: "attention" })).toEqual({ process: 0, step: "attention" });
    expect(stepAt(s, { pointer: "/requires/0" })).toBeNull();
  });
});

describe("runs kept up to date", () => {
  const run = (id: string, accepted: string, updated: string, status: Run["status"]): Run => ({ id, solution: "s", process: "p", status, accepted_at: accepted, updated_at: updated });
  it("take each run's latest answer, a stale one never over a newer", () => {
    const current = [run("a", "2026-11-08T10:00:00Z", "2026-11-08T10:00:00Z", "running"), run("b", "2026-11-08T09:00:00Z", "2026-11-08T09:00:00Z", "running")];
    const merged = mergeRuns(current, [run("a", "2026-11-08T10:00:00Z", "2026-11-08T10:05:00Z", "completed"), run("c", "2026-11-08T11:00:00Z", "2026-11-08T11:00:00Z", "starting")]);
    expect(merged.map((r) => [r.id, r.status])).toEqual([
      ["c", "starting"],
      ["a", "completed"],
      ["b", "running"],
    ]);
    // A repeat of an older answer changes nothing.
    expect(mergeRuns(merged, [run("a", "2026-11-08T10:00:00Z", "2026-11-08T10:00:00Z", "running")]).find((r) => r.id === "a")!.status).toBe("completed");
  });
});

describe("the simulator's starting scenario", () => {
  it("answers each top-level read and action, and approves each task an hour later", () => {
    const sc = defaultScenario(proc(source()), new Date("2026-11-06T10:00:00Z"));
    expect(Object.keys(sc.results)).toEqual(["snapshot"]);
    expect(sc.decisions).toEqual({ review: { approve: true, after: 3600 } });
    expect(sc.start).toBe("2026-11-06T10:00:00.000Z");
  });
});

describe("Studio's solution pages", () => {
  it("offer a capability's nested input field by field", () => {
    const fields = inputFields({
      id: "procs.order.create",
      version: "1",
      label: "Create",
      effect: "transactional_action",
      input: { properties: { values: { properties: { reference: {}, request: {} }, required: ["reference"] }, submit: {} }, required: ["values"] },
    });
    expect(fields).toEqual([
      { key: "values.reference", required: true },
      { key: "values.request", required: false },
      { key: "submit", required: false },
    ]);
  });

  it("say where a release stands", () => {
    const base = { id: "r", solution: "s", version: "1", artifact_digest: "d", created_at: "", active: false, reviews: [] as { by: string; decision: string; reason: string; digest: string; at: string }[] };
    expect(releaseState(base).tone).toBe("outline");
    expect(releaseState({ ...base, reviews: [{ by: "u", decision: "approved", reason: "", digest: "d", at: "" }] }).tone).toBe("secondary");
    expect(releaseState({ ...base, reviews: [{ by: "u", decision: "approved", reason: "", digest: "other", at: "" }] }).tone).toBe("outline");
    expect(releaseState({ ...base, active: true, generation: 2 }).tone).toBe("default");
  });

  it("start a new approval with a person's decision and its ends", () => {
    const t = template("approval");
    expect(t.processes![0].nodes.map((n) => n.type)).toEqual(["human_task", "end", "end", "suspend"]);
    expect(parseSource(printSource(t)).source).toEqual(t);
  });
});
