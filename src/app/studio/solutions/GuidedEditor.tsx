// The guided view of a solution (BUILDER_UX §4–6): a process's steps as a linear outline anyone can follow
// with a keyboard or a screen reader, and the selected step's settings in an inspector, typed by what the
// step is. It edits the parsed source in place, so what it does not know (a structured step's blocks, a
// setting added in the source) is kept as it was. Structured steps are shown, and edited in the source.

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addStep,
  blankStep,
  blockNodes,
  GUIDED_KINDS,
  newProcess,
  newStepId,
  outline,
  removeStep,
  requireCapability,
  routedFrom,
  routesOf,
  updateStep,
  useCalendars,
  useCatalog,
  type CatalogEntry,
  type GuidedKind,
  type Process,
  type ProcessTypes,
  type Source,
  type Step,
} from "@/lib/solutions";
import { Field } from "./field";
import { t as tr, isolate } from "@ferrum/client";

export interface Selection {
  process: string;
  path: string[];
  step: string;
}

export const KIND_LABEL: Record<string, string> = {
  query: "Read",
  action: "Do",
  decision: "Decide",
  human_task: "Person decides",
  wait_event: "Wait for an event",
  delay: "Wait",
  end: "End",
  suspend: "Needs attention",
  parallel: "Side by side",
  for_each: "For each",
  repeat: "Repeat",
  subprocess: "Subprocess",
  case: "Case",
  compensate: "Undo",
};

const kindLabel = (k: string) => tr(KIND_LABEL[k] ?? k);

export function Select({ id, value, onChange, options, label, allowEmpty }: { id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; allowEmpty?: string }) {
  return (
    <select id={id} aria-label={label} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {!options.some((o) => o.value === value) && value && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function GuidedEditor({
  source,
  onChange,
  selected,
  onSelect,
  types,
}: {
  source: Source;
  onChange: (s: Source) => void;
  selected: Selection | null;
  onSelect: (s: Selection | null) => void;
  types?: Record<string, ProcessTypes>;
}) {
  const catalog = useCatalog();
  const processes = source.processes ?? [];
  const [current, setCurrent] = useState(processes[0]?.id ?? "");
  const p = processes.find((x) => x.id === (selected?.process ?? current)) ?? processes[0];
  const events = catalog.data?.events ?? [];
  const set = (patch: Partial<Source>) => onChange({ ...source, ...patch });
  const setProcess = (patch: Partial<Process>) => onChange({ ...source, processes: processes.map((x) => (x.id === p?.id ? { ...x, ...patch } : x)) });

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="sr-only">{tr("Solution")}</legend>
        <Field label={tr("Name")}>
          <Input value={(source.label as string) ?? ""} onChange={(e) => set({ label: e.target.value })} />
        </Field>
        <Field label={tr("Identifier")} hint={tr("Lower case words joined by dots and underscores: workspace.purchase_approval")}>
          <Input dir="ltr" value={source.id ?? ""} onChange={(e) => set({ id: e.target.value })} />
        </Field>
        <Field label={tr("Version")} hint={tr("A kept release never changes: give each a new version.")}>
          <Input dir="ltr" value={source.version ?? ""} onChange={(e) => set({ version: e.target.value })} />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        {processes.length > 1 && (
          <Field label={tr("Process")} className="min-w-56">
            <Select
              id="guided-process"
              label={tr("Process")}
              value={p?.id ?? ""}
              onChange={(v) => {
                setCurrent(v);
                onSelect(null);
              }}
              options={processes.map((x) => ({ value: x.id, label: x.label || x.id }))}
            />
          </Field>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = newProcess(source, tr("New process"), events[0]?.id ?? "");
            onChange(next);
            setCurrent(next.processes![next.processes!.length - 1].id);
            onSelect(null);
          }}
        >
          <Plus aria-hidden /> {tr("Add a process")}
        </Button>
      </div>

      {!p ? (
        <p className="text-sm text-muted-foreground">{tr("No process yet. Add one, or write rules and decisions in the source.")}</p>
      ) : (
        <>
          <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5">
            <legend className="px-1 text-sm font-medium">{isolate(p.label || p.id)}</legend>
            <Field label={tr("Name")}>
              <Input value={p.label} onChange={(e) => setProcess({ label: e.target.value })} />
            </Field>
            <Field label={tr("Starts when")}>
              <Select
                id="guided-trigger"
                label={tr("Starts when")}
                value={p.trigger.event}
                allowEmpty={tr("Choose an event…")}
                onChange={(v) => setProcess({ trigger: { ...p.trigger, event: v } })}
                options={events.map((e) => ({ value: e.id, label: e.label ? `${e.label} (${e.id})` : e.id }))}
              />
            </Field>
            <Field label={tr("Once per")} hint={tr("What makes two events one request: trigger.id starts one run per record.")}>
              <Input dir="ltr" value={p.trigger.business_key} onChange={(e) => setProcess({ trigger: { ...p.trigger, business_key: e.target.value } })} />
            </Field>
            <Field label={tr("First step")}>
              <Select id="guided-entry" label={tr("First step")} value={p.entry} onChange={(v) => setProcess({ entry: v })} options={p.nodes.map((n) => ({ value: n.id, label: `${n.label || n.id} (${n.id})` }))} />
            </Field>
            <Field label={tr("Most steps a run may take")}>
              <Input type="number" min={1} value={p.max_steps} onChange={(e) => setProcess({ max_steps: Number(e.target.value) || 1 })} />
            </Field>
          </fieldset>
          <ProcessSteps source={source} p={p} onChange={onChange} selected={selected?.process === p.id ? selected : null} onSelect={onSelect} catalog={catalog.data?.capabilities ?? []} types={types?.[p.id]} />
        </>
      )}
    </div>
  );
}

function ProcessSteps({
  source,
  p,
  onChange,
  selected,
  onSelect,
  catalog,
  types,
}: {
  source: Source;
  p: Process;
  onChange: (s: Source) => void;
  selected: Selection | null;
  onSelect: (s: Selection | null) => void;
  catalog: CatalogEntry[];
  types?: ProcessTypes;
}) {
  const items = useMemo(() => outline(p), [p]);
  const [kind, setKind] = useState<GuidedKind>("human_task");
  const [label, setLabel] = useState("");
  const sel = selected && items.find((o) => o.step.id === selected.step);
  const block = sel?.path ?? [];
  const add = () => {
    const nodes = blockNodes(p, block) ?? [];
    const fallback = nodes.find((n) => n.type === "end")?.id ?? nodes[0]?.id ?? "";
    const id = newStepId(p, label || tr(KIND_LABEL[kind]));
    onChange(addStep(source, p.id, block, blankStep(kind, id, label || tr(KIND_LABEL[kind]), fallback)));
    onSelect({ process: p.id, path: block, step: id });
    setLabel("");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <nav className="min-w-0" aria-label={tr("Steps of {process}", { process: p.label || p.id })}>
        <ol className="grid gap-1">
          {items.map((o) => {
            const isSel = sel?.step.id === o.step.id;
            return (
              <li key={`${o.path.join("/")}/${o.step.id}`} className="min-w-0" style={{ paddingInlineStart: `${o.depth * 1.25}rem` }}>
                <button
                  type="button"
                  aria-current={isSel ? "true" : undefined}
                  className={`w-full min-w-0 overflow-hidden rounded-md border px-2 py-1.5 text-start text-sm ${isSel ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                  onClick={() => onSelect({ process: p.id, path: o.path, step: o.step.id })}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="shrink-0">
                      {kindLabel(o.step.type)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{isolate(o.step.label || o.step.id)}</span>
                    {p.entry === o.step.id && o.depth === 0 && <Badge variant="secondary">{tr("start")}</Badge>}
                  </span>
                  {routesOf(o.step).length > 0 && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground" dir="ltr">
                      {routesOf(o.step)
                        .map(([r, t]) => `${r} → ${t}`)
                        .join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 grid gap-2 rounded-md border p-2">
          <span className="text-xs font-medium">{block.length ? tr("Add a step inside {block}", { block: block[block.length - 1] }) : tr("Add a step")}</span>
          <Select id="guided-add-kind" label={tr("Kind of step")} value={kind} onChange={(v) => setKind(v as GuidedKind)} options={GUIDED_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
          <Input aria-label={tr("Its name")} placeholder={tr("Its name")} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button size="sm" onClick={add}>
            <Plus aria-hidden /> {tr("Add")}
          </Button>
        </div>
      </nav>
      <section id="guided-inspector" tabIndex={-1} aria-label={tr("Inspector")} className="min-w-0 rounded-md border p-3">
        {sel ? (
          <Inspector source={source} p={p} path={sel.path} step={sel.step} onChange={onChange} onSelect={onSelect} catalog={catalog} outputType={types?.steps?.[sel.step.id]} />
        ) : (
          <p className="text-sm text-muted-foreground">{tr("Choose a step to see and change its settings.")}</p>
        )}
      </section>
    </div>
  );
}

/** A step's settings, the same for the guided and the diagram view: each change is made to the one parsed source. */
export function Inspector({
  source,
  p,
  path,
  step,
  onChange,
  onSelect,
  catalog,
  outputType,
}: {
  source: Source;
  p: Process;
  path: string[];
  step: Step;
  onChange: (s: Source) => void;
  onSelect: (s: Selection | null) => void;
  catalog: CatalogEntry[];
  outputType?: unknown;
}) {
  const calendars = useCalendars();
  const nodes = blockNodes(p, path) ?? [];
  const targets = nodes.filter((n) => n.id !== step.id).map((n) => ({ value: n.id, label: `${n.label || n.id} (${n.id})` }));
  const patch = (v: Record<string, unknown>) => onChange(updateStep(source, p.id, path, step.id, v));
  const route = (name: string, label: string, optional = false) => (
    <Field label={label}>
      <Select id={`route-${step.id}-${name}`} label={label} value={(step[name] as string) ?? ""} onChange={(v) => patch({ [name]: v || undefined })} options={targets} allowEmpty={optional ? tr("None") : undefined} />
    </Field>
  );
  const blockers = routedFrom(nodes, step.id);
  const structured = !(GUIDED_KINDS as readonly string[]).includes(step.type);
  const cap = (step.capability as { id: string; version: string } | undefined) ?? { id: "", version: "" };
  const capEntry = catalog.find((c) => c.id === cap.id);
  const changing = (c: CatalogEntry) => !["query", "pure"].includes(c.effect);

  let body: ReactNode = null;
  if (structured) {
    body = <p className="text-sm text-muted-foreground">{tr("This step holds steps of its own, shown in the outline. Its own settings are edited in the source.")}</p>;
  } else if (step.type === "query" || step.type === "action") {
    const choices = catalog.filter((c) => (step.type === "query" ? !changing(c) : changing(c) && c.effect !== "human_task"));
    const inputs = inputFields(capEntry);
    const mapping = (step.input as Record<string, string>) ?? {};
    body = (
      <>
        <Field label={tr("Capability")} hint={step.type === "action" ? tr("What the step does, through the app that owns it, with the requester's rights when it runs.") : tr("What the step reads.")}>
          <Select
            id={`cap-${step.id}`}
            label={tr("Capability")}
            value={cap.id}
            allowEmpty={tr("Choose…")}
            options={choices.map((c) => ({ value: c.id, label: `${c.label} (${c.id})` }))}
            onChange={(v) => {
              const c = catalog.find((x) => x.id === v);
              if (!c) return patch({ capability: undefined });
              onChange(requireCapability(updateStep(source, p.id, path, step.id, { capability: { id: c.id, version: c.version } }), c));
            }}
          />
        </Field>
        {capEntry && <Contract entry={capEntry} unknownRoute={step.type === "action" ? ((step.on_unknown as string | undefined) ?? null) : undefined} />}
        {inputs.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{tr("Input")}</legend>
            {inputs.map(({ key, required }) => (
              <Field key={key} label={<span dir="ltr">{key}</span>} required={required}>
                <Input
                  dir="ltr"
                  placeholder={tr("an expression: trigger.id, snapshot.output.total")}
                  value={mapping[key] ?? ""}
                  onChange={(e) => {
                    const next = { ...mapping, [key]: e.target.value };
                    if (!e.target.value) delete next[key];
                    patch({ input: next });
                  }}
                />
              </Field>
            ))}
          </fieldset>
        )}
        {route("next", tr("Then"))}
        {route("on_error", tr("If it fails"))}
        {step.type === "action" && route("on_unknown", tr("If its outcome is unknown"), true)}
        {step.type === "action" && (
          <Field label={tr("Relies on the approval of")} hint={tr("The action is refused if what was approved changed since.")}>
            <Select
              id={`approval-${step.id}`}
              label={tr("Relies on the approval of")}
              value={(step.approval as string) ?? ""}
              allowEmpty={tr("None")}
              onChange={(v) => patch({ approval: v || undefined })}
              options={outline(p)
                .filter((o) => o.step.type === "human_task")
                .map((o) => ({ value: o.step.id, label: o.step.label || o.step.id }))}
            />
          </Field>
        )}
      </>
    );
  } else if (step.type === "decision") {
    const tables = ((source.decisions as { id: string; rows?: { outcome: unknown }[]; default?: unknown }[] | undefined) ?? []);
    const table = tables.find((d) => d.id === step.decision);
    const outcomes = [...new Set([...(table?.rows ?? []).map((r) => JSON.stringify(r.outcome)), ...(table?.default !== undefined ? [JSON.stringify(table.default)] : [])])];
    const routes = (step.routes as { outcome: unknown; target: string }[]) ?? [];
    body = (
      <>
        <Field label={tr("Decision table")}>
          <Select id={`dec-${step.id}`} label={tr("Decision table")} value={(step.decision as string) ?? ""} allowEmpty={tr("Choose…")} onChange={(v) => patch({ decision: v })} options={tables.map((d) => ({ value: d.id, label: d.id }))} />
        </Field>
        {outcomes.map((o) => (
          <Field key={o} label={tr("When it decides {outcome}", { outcome: o })}>
            <Select
              id={`dec-${step.id}-${o}`}
              label={tr("When it decides {outcome}", { outcome: o })}
              value={routes.find((r) => JSON.stringify(r.outcome) === o)?.target ?? ""}
              allowEmpty={tr("Choose…")}
              options={targets}
              onChange={(v) => patch({ routes: [...routes.filter((r) => JSON.stringify(r.outcome) !== o), { outcome: JSON.parse(o), target: v }] })}
            />
          </Field>
        ))}
        {route("on_error", tr("If it cannot decide"))}
      </>
    );
  } else if (step.type === "human_task") {
    body = (
      <>
        <Field label={tr("Who decides (a role)")} hint={tr("Never the requester, whatever roles they hold.")}>
          <Input value={(step.role as string) ?? ""} onChange={(e) => patch({ role: e.target.value })} />
        </Field>
        <Field label={tr("What they decide on")} hint={tr("An expression; if it changes after the decision, an action relying on it is refused.")}>
          <Input dir="ltr" value={(step.material as string) ?? ""} onChange={(e) => patch({ material: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("People who must approve")}>
            <Input type="number" min={1} max={9} value={(step.approvals as number) ?? 1} onChange={(e) => patch({ approvals: Math.min(9, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label={tr("Times it may be handed on")}>
            <Input type="number" min={0} max={3} value={(step.delegation as number) ?? 0} onChange={(e) => patch({ delegation: Math.min(3, Math.max(0, Number(e.target.value) || 0)) || undefined })} />
          </Field>
        </div>
        <WaitField label={tr("Deadline")} value={step.timeout} onChange={(v) => patch({ timeout: v })} calendars={(calendars.data ?? []).map((c) => c.name)} />
        <FormFields value={(step.form as FormFieldValue[]) ?? []} onChange={(v) => patch({ form: v.length ? v : undefined })} />
        {route("next", tr("If approved"))}
        {route("on_reject", tr("If rejected"))}
        {route("on_timeout", tr("If nobody decides in time"))}
      </>
    );
  } else if (step.type === "wait_event") {
    body = (
      <>
        <Field label={tr("Event")}>
          <Input dir="ltr" value={(step.event as string) ?? ""} onChange={(e) => patch({ event: e.target.value })} />
        </Field>
        <Field label={tr("About the record")} hint={tr("An expression naming the record the event must be about: create_order.output.id")}>
          <Input dir="ltr" value={(step.correlation as string) ?? ""} onChange={(e) => patch({ correlation: e.target.value })} />
        </Field>
        <WaitField label={tr("Deadline")} value={step.timeout} onChange={(v) => patch({ timeout: v })} calendars={(calendars.data ?? []).map((c) => c.name)} />
        {route("next", tr("When it comes"))}
        {route("on_timeout", tr("If it does not come in time"))}
      </>
    );
  } else if (step.type === "delay") {
    body = (
      <>
        <WaitField label={tr("Wait for")} value={step.wait} onChange={(v) => patch({ wait: v })} calendars={(calendars.data ?? []).map((c) => c.name)} />
        {route("next", tr("Then"))}
      </>
    );
  } else if (step.type === "end") {
    body = (
      <Field label={tr("Ends as")}>
        <Select
          id={`end-${step.id}`}
          label={tr("Ends as")}
          value={(step.outcome as string) ?? "completed"}
          onChange={(v) => patch({ outcome: v })}
          options={[
            { value: "completed", label: tr("Completed") },
            { value: "refused", label: tr("Refused") },
            ...(path.length ? [{ value: "again", label: tr("Once more (in a repeat)") }] : []),
          ]}
        />
      </Field>
    );
  } else if (step.type === "suspend") {
    body = (
      <>
        <Field label={tr("Why it waits for a person")}>
          <Textarea rows={2} value={(step.reason as string) ?? ""} onChange={(e) => patch({ reason: e.target.value })} />
        </Field>
        {route("resume_to", tr("A recovery may resume at"), true)}
      </>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{kindLabel(step.type)}</Badge>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {step.id}
        </span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={blockers.length > 0}
          title={blockers.length ? tr("Steps route here: {steps}", { steps: blockers.join(", ") }) : undefined}
          onClick={() => {
            onChange(removeStep(source, p.id, path, step.id));
            onSelect(null);
          }}
        >
          <Trash2 aria-hidden /> {tr("Remove")}
        </Button>
      </div>
      {blockers.length > 0 && <p className="text-xs text-muted-foreground">{tr("Steps route here: {steps}", { steps: blockers.join(", ") })}</p>}
      <Field label={tr("Name")}>
        <Input value={step.label} onChange={(e) => patch({ label: e.target.value })} />
      </Field>
      {body}
      {outputType !== undefined && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{tr("What later steps read from it ({step}.output)", { step: step.id })}</summary>
          <pre className="mt-1 overflow-auto rounded bg-muted p-2" dir="ltr">
            {JSON.stringify(outputType, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/** A capability's input fields, a nested object's fields one level down (`values.description`). */
export function inputFields(c: CatalogEntry | undefined): { key: string; required: boolean }[] {
  const props = c?.input?.properties ?? {};
  const required = new Set(c?.input?.required ?? []);
  const out: { key: string; required: boolean }[] = [];
  for (const [k, v] of Object.entries(props)) {
    const inner = (v as { properties?: Record<string, unknown>; required?: string[] }).properties;
    if (inner) {
      const innerReq = new Set((v as { required?: string[] }).required ?? []);
      for (const sub of Object.keys(inner)) out.push({ key: `${k}.${sub}`, required: required.has(k) && innerReq.has(sub) });
    } else out.push({ key: k, required: required.has(k) });
  }
  return out;
}

/** How many whole business days a text says, if it says one in range: anything else changes nothing. */
export function businessDays(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 260 ? n : null;
}

function WaitField({ label, value, onChange, calendars }: { label: string; value: unknown; onChange: (v: unknown) => void; calendars: string[] }) {
  const business = value !== null && typeof value === "object";
  const v = value as { business_days?: number; calendar?: string } | string | number | undefined;
  const group = useId();
  const stored = business ? ((v as { business_days?: number }).business_days ?? 1) : 1;
  // The text as typed: emptying the field to type another number, or a stray key, never rewrites the deadline.
  const [days, setDays] = useState(String(stored));
  useEffect(() => setDays(String(stored)), [stored]);
  return (
    <fieldset className="grid gap-2 rounded-md border p-2">
      <legend className="px-1 text-sm">{label}</legend>
      <div className="flex gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" name={group} checked={!business} onChange={() => onChange("P2D")} /> {tr("A duration")}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={group} checked={business} onChange={() => onChange({ business_days: 2, calendar: calendars[0] ?? "" })} /> {tr("Business days")}
        </label>
      </div>
      {business ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="number"
            min={1}
            max={260}
            aria-label={tr("How many business days")}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              const n = businessDays(e.target.value);
              if (n !== null && n !== stored) onChange({ ...(v as object), business_days: n });
            }}
            onBlur={() => setDays(String(stored))}
          />
          <select aria-label={tr("Calendar")} className="h-9 rounded-md border bg-transparent px-2 text-sm" value={(v as { calendar?: string }).calendar ?? ""} onChange={(e) => onChange({ ...(v as object), calendar: e.target.value })}>
            <option value="">{tr("Choose a calendar…")}</option>
            {calendars.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      ) : (
        <Input dir="ltr" aria-label={tr("Duration")} placeholder="P2D, PT4H" value={typeof v === "number" ? String(v) : ((v as string) ?? "")} onChange={(e) => onChange(/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)} />
      )}
    </fieldset>
  );
}

interface FormFieldValue {
  name: string;
  label: string;
  type: string;
  required?: boolean;
}

function FormFields({ value, onChange }: { value: FormFieldValue[]; onChange: (v: FormFieldValue[]) => void }) {
  const set = (i: number, patch: Partial<FormFieldValue>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <fieldset className="grid gap-2 rounded-md border p-2">
      <legend className="px-1 text-sm">{tr("What the person fills in")}</legend>
      {value.map((f, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto_auto]">
          <Input aria-label={tr("Field name")} dir="ltr" value={f.name} onChange={(e) => set(i, { name: e.target.value })} />
          <Input aria-label={tr("Field label")} value={f.label} onChange={(e) => set(i, { label: e.target.value })} />
          <select aria-label={tr("Field type")} className="h-9 rounded-md border bg-transparent px-2 text-sm" value={f.type} onChange={(e) => set(i, { type: e.target.value })}>
            {["text", "decimal", "int", "bool", "date"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked || undefined })} /> {tr("Required")}
          </label>
          <Button size="icon" variant="ghost" aria-label={tr("Remove")} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...value, { name: `field_${value.length + 1}`, label: tr("Note"), type: "text" }])}>
        <Plus aria-hidden /> {tr("Add a field")}
      </Button>
    </fieldset>
  );
}

const EFFECT: Record<string, string> = {
  query: "Reads, and changes nothing.",
  pure: "Works something out, and changes nothing.",
  transactional_action: "Changes records, all at once or not at all.",
  external_effect: "Reaches outside Ferrum: once it has gone, it cannot be called back.",
  human_task: "Asks a person.",
};
const UNKNOWN: Record<string, string> = {
  reconcile: "If its outcome is unknown, it is looked up by its receipt before anything else happens.",
  manual: "If its outcome is unknown, a person settles what happened before the run goes on.",
};

/** What the chosen capability promises, from the catalog, so the author sees what the step will do before
 *  running it (FLC-UI-003): its effect, the rights it needs, what done means, retries, an unknown outcome and
 *  what undoes it. */
/** `unknownRoute`: an action's route for an unknown outcome, null when it has none; undefined for a read. */
export function Contract({ entry, unknownRoute }: { entry: CatalogEntry; unknownRoute?: string | null }) {
  const rights = (entry.permissions ?? []).map((p) => (p === "admin" ? tr("an administrator's") : p.replace(/^(.+):(.+)$/, "$2 $1")));
  const attempts = entry.limits?.max_attempts;
  const repeatable = entry.idempotency === "read_only" || entry.idempotency === "native_receipt";
  const unknown = entry.unknown_outcome && UNKNOWN[entry.unknown_outcome];
  return (
    <section aria-label={tr("What it promises")} className="grid gap-1 rounded-md border bg-muted/40 p-2 text-sm">
      <p>{tr(EFFECT[entry.effect] ?? entry.effect)}</p>
      {rights.length > 0 && <p>{tr("Runs with the rights of whoever started the run, who needs: {rights}.", { rights: rights.join(", ") })}</p>}
      {entry.completion && <p>{tr("Done means: {what}.", { what: entry.completion })}</p>}
      {attempts !== undefined && (
        <p>
          {repeatable
            ? tr("Tried up to {n} times; each try carries the same receipt, so it is never done twice.", { n: attempts })
            : tr("Tried up to {n} times.", { n: attempts })}
        </p>
      )}
      {unknown && <p>{tr(unknown)}</p>}
      {entry.compensate_with && <p>{tr("Undone by {action} if a later step fails.", { action: entry.compensate_with })}</p>}
      {unknown && unknownRoute === null && (
        <p className="text-amber-700 dark:text-amber-400">{tr("Say where the run goes when its outcome is unknown (If its outcome is unknown): the check refuses it otherwise.")}</p>
      )}
    </section>
  );
}

