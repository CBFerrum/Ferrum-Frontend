// Customer solutions in Studio (Ferrum's docs/logic/studio.md): drafts, checks, simulations, releases and
// their reviews, runs and people's tasks, over `/api/app/studio/{solutions,runs,tasks,calendars}`. The server
// decides who may do what; these only ask. A draft's source is the one definition: the guided view edits the
// parsed source in place and writes it back, so a setting it does not know survives (BUILDER_UX §4).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

const BASE = "/api/app/studio";

// ───────────────────────────── types (crates/logic, crates/kernel) ─────────────────────────────

export interface DraftRow {
  id: string;
  solution: string;
  label: string;
  version: number;
  updated_by?: string | null;
  updated_at: string;
}
export interface Draft extends DraftRow {
  source: string;
}
export interface ReleaseRow {
  id: string;
  solution: string;
  version: string;
  artifact_digest: string;
  created_by?: string | null;
  created_at: string;
  active: boolean;
  generation?: number | null;
  reviews: { by: string; decision: string; reason: string; digest: string; at: string }[];
}
export interface Diagnostic {
  code: string;
  message: string;
  pointer: string;
  node?: string | null;
  fault: boolean;
}
export interface Change {
  area: "parameter" | "rule" | "decision" | "decision_row" | "process" | "step" | "capability";
  id: string;
  kind: "added" | "removed" | "changed";
  fields?: string[];
  changes_records?: boolean;
  /** Each differing setting as it was and as it is (`null` where absent). */
  values?: Record<string, [unknown, unknown]>;
}
export interface Locked {
  id: string;
  version: string;
  digest: string;
  effect: string;
  compensation?: string;
}
export interface ReleaseReview {
  release: {
    id: string;
    solution: string;
    version: string;
    source_digest: string;
    artifact_digest: string;
    created_by?: string | null;
    created_at: string;
    profile: string;
    compiler: string;
    lock: Locked[];
    notes: Diagnostic[];
    rules: number;
    decisions: number;
    processes: { id: string; label: string; trigger: string }[];
  };
  active: { release: string; version: string; generation: number } | null;
  reviews: ReleaseRow["reviews"];
  diff: { changes: Change[]; privilege_growth: string[] };
}
export interface Compiled {
  ok: boolean;
  release?: { solution: string; version: string; source_digest: string; artifact_digest: string; lock: Locked[]; types: Record<string, ProcessTypes> };
  diagnostics: Diagnostic[];
}
export interface ProcessTypes {
  trigger: unknown;
  steps: Record<string, unknown>;
  items?: Record<string, unknown>;
}
export interface Entry {
  at: string;
  kind: "command" | "event";
  activation?: string | null;
  what: Record<string, unknown>;
  source?: "stand_in" | "not_modelled" | "deadline";
}
export interface Simulation {
  release: { solution: string; version: string; artifact_digest: string };
  simulation: { entries: Entry[]; status: { status: string; outcome?: string; output?: unknown }; not_modelled: string[]; stopped?: string };
}
export interface Run {
  id: string;
  solution: string;
  process: string;
  business_key?: string;
  status: RunStatus;
  requester?: string | null;
  subject_entity?: string | null;
  subject_id?: string | null;
  accepted_at: string;
  updated_at: string;
  finished_at?: string | null;
}
export type RunStatus = "starting" | "running" | "needs_attention" | "cancelling" | "completed" | "refused" | "cancelled";
/** A move of the run onto another release, as recorded on it: planned, approved, carried out or refused. */
export interface RunMove {
  action: "plan_migration" | "approve_migration" | "migrated" | "migration_refused";
  at: string;
  by?: string | null;
  diff: { release?: string; to?: string; map?: Record<string, string>; digest?: string; moved?: string[]; why?: string[]; reason?: string };
}
export interface RunDetail extends Run {
  output?: unknown;
  state?: unknown;
  release?: { id: string; version?: string | null };
  generation?: number | null;
  trigger_event?: number | null;
  moves?: RunMove[];
  /** How often each step was tried, and how its last try went. */
  attempts?: Record<string, { attempts: number; last: string; first_at?: string; last_at?: string }>;
  tasks: { id: string; activation: string; kind: TaskKind; label: string; status: string; deadline?: string | null }[];
}
export type TaskKind = "task" | "case" | "recovery" | "attention";
export interface TaskRow {
  id: string;
  kind: TaskKind;
  label: string;
  role: string;
  deadline?: string | null;
}
export interface FormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
}
export interface Task extends TaskRow {
  run: string;
  activation: string;
  material: unknown;
  digest: string;
  form: FormField[];
  approvals: number;
  /** How many times it may be handed on, and how many it has been. */
  delegation?: number;
  handed_on?: number;
  status: string;
  deadline_basis?: { calendar?: string; revision?: number; zone?: string; adjusted?: string } | null;
  detail: { tasks?: CaseTask[]; why?: string; evidence?: unknown; reason?: string; resumable?: boolean };
  /** Who did what on it, oldest first. */
  history?: TaskEvent[];
}
export interface TaskEvent {
  decision: "approve" | "reject" | "delegate" | "done" | "close" | "resume" | "end" | "acknowledge";
  part: string;
  reason: string;
  at: string;
  by: string;
  to?: string | null;
}
export interface CaseTask {
  id: string;
  label: string;
  role: string;
  requires?: string[];
  required?: boolean;
  form?: FormField[];
}
export interface Calendar {
  name: string;
  zone: string;
  weekends: string[];
  holidays: string[];
  revision?: number;
  updated_at?: string;
}
export interface CatalogEntry {
  id: string;
  version: string;
  label: string;
  effect: string;
  entity?: string | null;
  input?: { properties?: Record<string, unknown>; required?: string[] };
  /** What the capability promises (crates/logic/src/capability.rs): what done means, whether a retry can
   *  do it twice, what happens when its outcome is unknown, what undoes it, and the rights it runs with. */
  completion?: string;
  idempotency?: string;
  unknown_outcome?: string;
  compensate_with?: string | null;
  permissions?: string[];
  limits?: { max_attempts?: number; timeout_ms?: number };
}
export interface CatalogEvent {
  id: string;
  label?: string;
  entity?: string | null;
}

// ───────────────────────────── hooks ─────────────────────────────

/** The solutions a person may author; `enabled` false asks nothing (for people who author none). */
export function useSolutions(enabled = true) {
  return useQuery({
    queryKey: ["solutions"],
    queryFn: () => api.get<{ drafts: DraftRow[]; releases: ReleaseRow[]; calendars: Calendar[]; profile: string }>(`${BASE}/solutions`),
    enabled,
  });
}

export function useDraft(id: string | undefined) {
  return useQuery({ queryKey: ["solutions", "draft", id], queryFn: () => api.get<Draft>(`${BASE}/solutions/drafts/${id}`), enabled: !!id });
}

export function useCatalog() {
  return useQuery({
    queryKey: ["studio", "catalog"],
    queryFn: () => api.get<{ capabilities: CatalogEntry[]; events: CatalogEvent[] }>(`${BASE}/catalog`),
    staleTime: 5 * 60_000,
  });
}

export const createDraft = (source: string) => api.post<{ id: string; version: number }>(`${BASE}/solutions/drafts`, { source });
export const saveDraft = (id: string, version: number, source: string) =>
  api.put<{ version: number }>(`${BASE}/solutions/drafts/${id}`, { source }, { ifMatch: version });
export const deleteDraft = (id: string, version: number) => api.del(`${BASE}/solutions/drafts/${id}`, { ifMatch: version });
export const keepRelease = (id: string, version: number) =>
  api.post<{ id: string; version: string; artifact_digest: string }>(`${BASE}/solutions/drafts/${id}/release`, undefined, { ifMatch: version });
export const compile = (source: string) => api.post<Compiled>(`${BASE}/solutions/compile`, { source });
export const simulate = (source: string, scenario: Scenario) => api.post<Simulation>(`${BASE}/solutions/simulate`, { source, scenario });

export function useReleaseReview(id: string | undefined) {
  return useQuery({ queryKey: ["solutions", "release", id], queryFn: () => api.get<ReleaseReview>(`${BASE}/solutions/releases/${id}`), enabled: !!id });
}
export const reviewRelease = (id: string, body: { digest: string; privileges: string[]; approve: boolean; reason: string }) =>
  api.post(`${BASE}/solutions/releases/${id}/review`, body);
/** What an activation changed: going back to an earlier release is this too, a new generation selecting it. */
export interface Activated {
  generation: number;
  replaced?: { release: string; version: string } | null;
  handed_over?: { automation: string; name: string } | null;
  open_elsewhere: number;
  kept: string;
}
export const activateRelease = (id: string, expected_generation: number | null) =>
  api.post<Activated>(`${BASE}/solutions/releases/${id}/activate`, expected_generation === null ? {} : { expected_generation });

/** One side of a shadow comparison: how the replay ended, what its decisions came to, its steps and effects. */
export interface ShadowSide {
  outcome: string;
  decisions: Record<string, unknown>;
  steps: string[];
  effects: { step?: string; capability?: string; input?: unknown; action?: string; to?: unknown }[];
  not_modelled: string[];
}
export interface ShadowCase {
  run?: string;
  event?: number;
  at: string;
  same: boolean;
  differences: string[];
  now: ShadowSide;
  candidate: ShadowSide;
}
/** A candidate beside what runs now, replayed on what happened: nothing ran, changed or was kept. */
export interface Shadow {
  against: { kind: "release"; release: string; version: string } | { kind: "automation"; automation: string; name: string };
  candidate: { solution: string; version: string; artifact_digest: string };
  compared: number;
  differing: number;
  cases: ShadowCase[];
  note: string;
}
export const shadowRelease = (release: string, last = 20) => api.post<Shadow>(`${BASE}/solutions/shadow`, { release, last });

/** A release as a pack for another workspace: its source, digests, what it needs and its review; no secret. */
export interface Pack {
  format: string;
  solution: string;
  version: string;
  label?: string | null;
  source: string;
  source_digest: string;
  artifact_digest: string;
  needs: { capabilities: { id: string; version: string }[]; events: string[]; calendars: string[] };
  evidence: unknown;
  exported_at: string;
}
export const releasePack = (id: string) => api.get<Pack>(`${BASE}/solutions/releases/${id}/pack`);
export interface PackTakenIn {
  draft: { id: string; solution: string; label: string; version: number };
  check: { ok: boolean; diagnostics: Diagnostic[] };
  to_map: string[];
  note: string;
}
export const importPack = (pack: unknown) => api.post<PackTakenIn>(`${BASE}/solutions/import/pack`, { pack });

/** Moving a waiting run onto the release that runs now: one administrator plans, another approves. */
export const planMove = (run: string, release: string, map: Record<string, string>) =>
  api.post<{ digest: string; moved: string[]; next: string }>(`${BASE}/runs/${run}/migrate/plan`, { release, map });
export const approveMove = (run: string, digest: string, reason: string) => api.post<{ delivered: boolean; note: string }>(`${BASE}/runs/${run}/migrate`, { digest, reason });
export const deactivateSolution = (solution: string, expected_generation: number) =>
  api.post(`${BASE}/solutions/${encodeURIComponent(solution)}/deactivate`, { expected_generation });

/** The runs the person may see, kept up to date: the server's cursor never skips a change committed late. */
export function useRuns(pollMs = 5_000) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const prev = qc.getQueryData<{ runs: Run[]; cursor: string }>(["runs"]);
      const page = await api.get<{ runs: Run[]; cursor: string; resync: boolean }>(`${BASE}/runs`, prev ? { cursor: prev.cursor } : undefined);
      return { runs: prev && !page.resync ? mergeRuns(prev.runs, page.runs) : page.runs, cursor: page.cursor };
    },
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
  });
}

export function useRun(id: string | undefined) {
  return useQuery({ queryKey: ["runs", id], queryFn: () => api.get<RunDetail>(`${BASE}/runs/${id}`), enabled: !!id, refetchInterval: 5_000 });
}
export const cancelRun = (id: string, reason: string) => api.post(`${BASE}/runs/${id}/cancel`, { reason });

export function useRunsAbout(entity: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["runs", "about", entity, id],
    queryFn: () => api.get<RelatedRun[]>(`${BASE}/runs/about/${encodeURIComponent(entity!)}/${id}`),
    enabled: !!entity && !!id,
    retry: false,
  });
}
export interface RelatedRun {
  id: string;
  solution: string;
  process: string;
  status: RunStatus;
  accepted_at: string;
  finished_at?: string | null;
  waiting: { kind: TaskKind; label: string; role: string; deadline?: string | null }[];
}

export function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskRow[]>(`${BASE}/tasks`), refetchInterval: 15_000 });
}
export function useTask(id: string | undefined) {
  return useQuery({ queryKey: ["tasks", id], queryFn: () => api.get<Task>(`${BASE}/tasks/${id}`), enabled: !!id });
}
export const decideTask = (id: string, body: { approve: boolean; digest: string; values: Record<string, unknown>; reason: string }) =>
  api.post<{ closed: boolean; approvals: number; needed: number }>(`${BASE}/tasks/${id}/decide`, body);
export const delegateTask = (id: string, to: string, reason: string) => api.post(`${BASE}/tasks/${id}/delegate`, { to, reason });
export const caseTaskDone = (id: string, task: string, values: Record<string, unknown>) => api.post(`${BASE}/tasks/${id}/done`, { task, values });
export const closeCase = (id: string) => api.post(`${BASE}/tasks/${id}/close`);
export const recoverTask = (id: string, resume: boolean, reason: string) => api.post(`${BASE}/tasks/${id}/recover`, { resume, reason });
export const acknowledgeTask = (id: string, reason: string) => api.post(`${BASE}/tasks/${id}/acknowledge`, { reason });

export function useCalendars() {
  return useQuery({ queryKey: ["calendars"], queryFn: () => api.get<Calendar[]>(`${BASE}/calendars`) });
}
export const saveCalendar = (c: Calendar) =>
  api.put<{ revision: number }>(`${BASE}/calendars/${encodeURIComponent(c.name)}`, { zone: c.zone, weekends: c.weekends, holidays: c.holidays });

/** A mutation that refreshes what it changed. */
export function useAct<A extends unknown[], R>(fn: (...a: A) => Promise<R>, keys: unknown[][]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (a: A) => fn(...a), onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })) });
}

// ───────────────────────────── runs ─────────────────────────────

/** Runs as the page keeps them: each the latest answer about it, the newest accepted first. */
export function mergeRuns(current: Run[], changed: Run[]): Run[] {
  const byId = new Map(current.map((r) => [r.id, r]));
  for (const r of changed) {
    const had = byId.get(r.id);
    if (!had || had.updated_at <= r.updated_at) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));
}

export const FINISHED: RunStatus[] = ["completed", "refused", "cancelled"];

// ───────────────────────────── the source ─────────────────────────────

/** A solution's source as the guided view reads it: what it knows typed, the rest kept as it is. */
export interface Source {
  id?: string;
  version?: string;
  label?: string;
  requires?: { id: string; version: string }[];
  processes?: Process[];
  [k: string]: unknown;
}
export interface Process {
  id: string;
  label: string;
  trigger: { event: string; business_key: string };
  entry: string;
  max_steps: number;
  nodes: Step[];
  [k: string]: unknown;
}
export interface Step {
  type: string;
  id: string;
  label: string;
  [k: string]: unknown;
}
export interface Block {
  id: string;
  entry: string;
  nodes: Step[];
}

export function parseSource(text: string): { source?: Source; error?: string } {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "A solution is a JSON object." };
    return { source: v as Source };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export const printSource = (s: Source) => JSON.stringify(s, null, 2) + "\n";

/** The routes out of a step: name → target, the way the compiler reads them. */
export function routesOf(s: Step): [string, string][] {
  const r: [string, string][] = [];
  for (const k of ["next", "on_error", "on_unknown", "on_reject", "on_timeout", "on_exhausted", "resume_to"]) {
    if (typeof s[k] === "string" && s[k]) r.push([k, s[k] as string]);
  }
  if (Array.isArray(s.routes)) for (const x of s.routes as { outcome: unknown; target: string }[]) r.push([`when ${JSON.stringify(x.outcome)}`, x.target]);
  return r;
}

/** The blocks a structured step holds. */
export function blocksOf(s: Step): Block[] {
  if (Array.isArray(s.branches)) return s.branches as Block[];
  if (s.body && typeof s.body === "object") return [s.body as Block];
  return [];
}

export interface OutlineItem {
  step: Step;
  depth: number;
  /** Where it is from its process: `structured/block/…`. */
  path: string[];
  /** The block that holds it. */
  block: string;
}

/** Every step of a process in order, structured steps' blocks nested under them: the linear outline that
 *  presents every construct without a diagram (BUILDER_UX §4, §13). */
export function outline(p: Process): OutlineItem[] {
  const out: OutlineItem[] = [];
  const walk = (nodes: Step[], entry: string, depth: number, path: string[], block: string) => {
    for (const s of ordered(nodes, entry)) {
      out.push({ step: s, depth, path, block });
      for (const b of blocksOf(s)) walk(b.nodes, b.entry, depth + 1, [...path, s.id, b.id], b.id);
    }
  };
  walk(p.nodes, p.entry, 0, [], "");
  return out;
}

/** Steps in the order a reader follows them: from the entry along routes, then whatever was not reached. */
export function ordered(nodes: Step[], entry: string | undefined): Step[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: Step[] = [];
  const visit = (id: string | undefined) => {
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    const s = byId.get(id)!;
    out.push(s);
    for (const [, t] of routesOf(s)) visit(t);
  };
  visit(entry);
  for (const n of nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}

/** The step a diagnostic points at, by its node or its pointer (`/processes/0/nodes/2/body/nodes/0/input/id`). */
export function stepAt(s: Source, d: Pick<Diagnostic, "pointer"> & { node?: string | null }): { process: number; step: string } | null {
  const m = /^\/processes\/(\d+)/.exec(d.pointer);
  if (!m) return null;
  const pi = Number(m[1]);
  if (d.node) return { process: pi, step: d.node };
  const parts = d.pointer.split("/").slice(3);
  let nodes: Step[] | undefined = s.processes?.[pi]?.nodes;
  let found: string | null = null;
  let i = 0;
  while (nodes && parts[i] === "nodes") {
    const n: Step | undefined = nodes[Number(parts[i + 1])];
    if (!n) break;
    found = n.id;
    i += 2;
    if (parts[i] === "branches") {
      nodes = (n.branches as Block[] | undefined)?.[Number(parts[i + 1])]?.nodes;
      i += 2;
    } else if (parts[i] === "body") {
      nodes = (n.body as Block | undefined)?.nodes;
      i += 1;
    } else break;
  }
  return found ? { process: pi, step: found } : null;
}

/** The nodes of the block `path` names (`[]` for the process's own). */
export function blockNodes(p: Process, path: string[]): Step[] | null {
  let nodes = p.nodes;
  for (let i = 0; i + 1 < path.length; i += 2) {
    const holder = nodes.find((n) => n.id === path[i]);
    const block = holder && blocksOf(holder).find((b) => b.id === path[i + 1]);
    if (!block) return null;
    nodes = block.nodes;
  }
  return nodes;
}

/** Every step id of a process: ids are the process's, not a block's. */
export function stepIds(p: Process): Set<string> {
  return new Set(outline(p).map((o) => o.step.id));
}

/** A new step id from a label: lower_snake_case, unique in the process. */
export function newStepId(p: Process, label: string): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "s_$1") || "step";
  const ids = stepIds(p);
  let id = base;
  for (let i = 2; ids.has(id); i++) id = `${base}_${i}`;
  return id;
}

/** The steps that route to `id` in its block: a step others route to is not removed silently. */
export function routedFrom(nodes: Step[], id: string): string[] {
  return nodes.filter((n) => routesOf(n).some(([, t]) => t === id)).map((n) => n.id);
}

/** Changes one step's settings, keeping everything else of the source as it was. */
export function updateStep(s: Source, process: string, path: string[], id: string, patch: Record<string, unknown>): Source {
  const next = structuredClone(s);
  const p = next.processes?.find((x) => x.id === process);
  const nodes = p && blockNodes(p, path);
  const step = nodes?.find((n) => n.id === id);
  if (!step) return s;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete step[k];
    else step[k] = v;
  }
  return next;
}

/** Adds a step to a block; the first step of an empty block becomes its entry. */
export function addStep(s: Source, process: string, path: string[], step: Step): Source {
  const next = structuredClone(s);
  const p = next.processes?.find((x) => x.id === process);
  const nodes = p && blockNodes(p, path);
  if (!p || !nodes) return s;
  nodes.push(step);
  if (path.length === 0 && !p.entry) p.entry = step.id;
  return next;
}

/** Removes a step no other step routes to. */
export function removeStep(s: Source, process: string, path: string[], id: string): Source {
  const next = structuredClone(s);
  const p = next.processes?.find((x) => x.id === process);
  const nodes = p && blockNodes(p, path);
  if (!p || !nodes || routedFrom(nodes, id).length > 0) return s;
  nodes.splice(
    nodes.findIndex((n) => n.id === id),
    1,
  );
  if (p.entry === id) p.entry = nodes[0]?.id ?? "";
  return next;
}

/** Asks for a capability at its installed version, once. */
export function requireCapability(s: Source, cap: { id: string; version: string }): Source {
  if (s.requires?.some((r) => r.id === cap.id)) return s;
  return { ...s, requires: [...(s.requires ?? []), { id: cap.id, version: cap.version }] };
}

/** A new process with its two ends: what it holds is the guided view's to fill. */
export function newProcess(s: Source, label: string, event: string): Source {
  const id = newStepId({ nodes: [], id: "", label: "", trigger: { event: "", business_key: "" }, entry: "", max_steps: 0 }, label) || "process";
  const ids = new Set((s.processes ?? []).map((p) => p.id));
  let pid = id;
  for (let i = 2; ids.has(pid); i++) pid = `${id}_${i}`;
  const p: Process = {
    id: pid,
    label,
    trigger: { event, business_key: "trigger.id" },
    entry: "completed",
    max_steps: 100,
    nodes: [
      { type: "end", id: "completed", label: "Completed", outcome: "completed" },
      { type: "end", id: "refused", label: "Refused", outcome: "refused" },
    ],
  };
  return { ...s, processes: [...(s.processes ?? []), p] };
}

/** The kinds of step the guided view builds, with the settings each needs. Structured steps (parallel,
 *  for-each, repeat, case, compensation, subprocess) are shown and kept, and edited in the source. */
export const GUIDED_KINDS = ["query", "action", "decision", "human_task", "wait_event", "delay", "end", "suspend"] as const;
export type GuidedKind = (typeof GUIDED_KINDS)[number];

export function blankStep(kind: GuidedKind, id: string, label: string, fallback: string): Step {
  const base = { type: kind, id, label };
  switch (kind) {
    case "query":
    case "action":
      return { ...base, capability: { id: "", version: "" }, input: {}, next: fallback, on_error: fallback };
    case "decision":
      return { ...base, decision: "", routes: [], on_error: fallback };
    case "human_task":
      return { ...base, role: "", material: "trigger", timeout: "P2D", next: fallback, on_reject: fallback, on_timeout: fallback };
    case "wait_event":
      return { ...base, event: "", correlation: "trigger.id", timeout: "P1D", next: fallback, on_timeout: fallback };
    case "delay":
      return { ...base, wait: "PT1H", next: fallback };
    case "end":
      return { ...base, outcome: "completed" };
    case "suspend":
      return { ...base, reason: "" };
  }
}

// ───────────────────────────── the simulator ─────────────────────────────

export interface Scenario {
  process: string;
  trigger: unknown;
  requester?: string | null;
  start: string;
  results: Record<string, { result: "done"; output: unknown } | { result: "refused"; code: string; message: string } | { result: "unknown"; why: string }>;
  decisions: Record<string, { approve: boolean; by?: string; values?: unknown; after?: number }>;
  signals: Record<string, { payload: unknown; after?: number }>;
  cases: Record<string, Record<string, unknown>>;
  recoveries: Record<string, boolean>;
}

/** A scenario that answers every top-level query and action with an empty success and approves every
 *  task at once: the starting point a person edits. */
export function defaultScenario(p: Process, start: Date): Scenario {
  const sc: Scenario = { process: p.id, trigger: { id: "SIM-1" }, start: start.toISOString(), results: {}, decisions: {}, signals: {}, cases: {}, recoveries: {} };
  for (const o of outline(p)) {
    const s = o.step;
    if (o.path.length > 0) continue;
    if (s.type === "query" || s.type === "action") sc.results[s.id] = { result: "done", output: {} };
    if (s.type === "human_task") sc.decisions[s.id] = { approve: true, after: 3600 };
  }
  return sc;
}

/** One timeline line in words a person reads. */
export function describe(e: Entry): string {
  const w = e.what as Record<string, unknown>;
  const name = (w.do ?? w.event ?? "") as string;
  return name.replace(/_/g, " ");
}
