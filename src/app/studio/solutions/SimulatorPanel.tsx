// The simulator (BUILDER_UX §8): a process run on a virtual clock in the state machine the runtime drives,
// with what the world outside does chosen here. Nothing it does reaches a record, a provider or a person.
// Each line of the timeline says where it came from: a stand-in chosen here, something not modelled (the step
// saw an unknown outcome, never an invented success), or a deadline passing on the virtual clock.

import { Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { defaultScenario, describe, outline, simulate, type Scenario, type Simulation, type Source } from "@/lib/solutions";
import { Alert, Field } from "@/ui/kit";
import { t as tr, isolate } from "@ferrum/client";

const SOURCE_LABEL: Record<string, string> = { stand_in: "stand-in", not_modelled: "not modelled", deadline: "deadline" };

export function SimulatorPanel({ source, parsed }: { source: string; parsed?: Source }) {
  const processes = parsed?.processes ?? [];
  const [process, setProcess] = useState(processes[0]?.id ?? "");
  const p = processes.find((x) => x.id === process) ?? processes[0];
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [json, setJson] = useState("");
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // A fresh scenario for the chosen process: every read and action answered empty, every task approved.
  useEffect(() => {
    if (!p) return;
    const sc = defaultScenario(p, new Date());
    setScenario(sc);
    setJson(JSON.stringify(sc, null, 2));
    setResult(null);
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = useMemo(() => (p ? outline(p).filter((o) => o.path.length === 0) : []), [p]);
  if (!p || !scenario) return <p className="text-sm text-muted-foreground">{tr("Add a process to simulate it.")}</p>;
  const update = (next: Scenario) => {
    setScenario(next);
    setJson(JSON.stringify(next, null, 2));
  };
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const sc = JSON.parse(json) as Scenario;
      setResult(await simulate(source, sc));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  const sim = result?.simulation;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {processes.length > 1 && (
          <Field label={tr("Process")}>
            <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={p.id} onChange={(e) => setProcess(e.target.value)}>
              {processes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label || x.id}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={tr("Starts at")} hint={tr("The virtual clock moves only to the next thing that happens.")}>
          <Input type="datetime-local" value={scenario.start.slice(0, 16)} onChange={(e) => update({ ...scenario, start: new Date(e.target.value).toISOString() })} />
        </Field>
        <Field label={tr("The triggering record (JSON)")}>
          <Input
            dir="ltr"
            defaultValue={JSON.stringify(scenario.trigger)}
            onBlur={(e) => {
              try {
                update({ ...scenario, trigger: JSON.parse(e.target.value) });
              } catch {
                setError(tr("The triggering record is not valid JSON."));
              }
            }}
          />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{tr("What happens at each step")}</legend>
        {steps.map(({ step }) => {
          if (step.type === "query" || step.type === "action") {
            const r = scenario.results[step.id];
            const kind = r ? r.result : "none";
            return (
              <div key={step.id} className="grid gap-2 sm:grid-cols-[12rem_10rem_1fr] sm:items-center">
                <span className="truncate text-sm">{isolate(step.label || step.id)}</span>
                <select
                  aria-label={tr("Outcome of {step}", { step: step.label || step.id })}
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={kind}
                  onChange={(e) => {
                    const results = { ...scenario.results };
                    if (e.target.value === "none") delete results[step.id];
                    else if (e.target.value === "done") results[step.id] = { result: "done", output: {} };
                    else if (e.target.value === "refused") results[step.id] = { result: "refused", code: "refused", message: tr("Refused in the scenario") };
                    else results[step.id] = { result: "unknown", why: tr("No answer in the scenario") };
                    update({ ...scenario, results });
                  }}
                >
                  <option value="done">{tr("Succeeds")}</option>
                  <option value="refused">{tr("Is refused")}</option>
                  <option value="unknown">{tr("Outcome unknown")}</option>
                  <option value="none">{tr("Not modelled")}</option>
                </select>
                {r?.result === "done" ? (
                  <Input
                    dir="ltr"
                    aria-label={tr("What it returns (JSON)")}
                    defaultValue={JSON.stringify(r.output)}
                    onBlur={(e) => {
                      try {
                        update({ ...scenario, results: { ...scenario.results, [step.id]: { result: "done", output: JSON.parse(e.target.value || "{}") } } });
                      } catch {
                        setError(tr("What {step} returns is not valid JSON.", { step: step.id }));
                      }
                    }}
                  />
                ) : (
                  <span />
                )}
              </div>
            );
          }
          if (step.type === "human_task") {
            const d = scenario.decisions[step.id];
            return (
              <div key={step.id} className="grid gap-2 sm:grid-cols-[12rem_10rem_1fr] sm:items-center">
                <span className="truncate text-sm">{isolate(step.label || step.id)}</span>
                <select
                  aria-label={tr("Decision on {step}", { step: step.label || step.id })}
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={d ? (d.approve ? "approve" : "reject") : "none"}
                  onChange={(e) => {
                    const decisions = { ...scenario.decisions };
                    if (e.target.value === "none") delete decisions[step.id];
                    else decisions[step.id] = { ...(decisions[step.id] ?? { after: 3600 }), approve: e.target.value === "approve" };
                    update({ ...scenario, decisions });
                  }}
                >
                  <option value="approve">{tr("Approved")}</option>
                  <option value="reject">{tr("Rejected")}</option>
                  <option value="none">{tr("Nobody decides")}</option>
                </select>
                {d ? (
                  <Input
                    type="number"
                    min={0}
                    aria-label={tr("After how many minutes")}
                    value={Math.round((d.after ?? 0) / 60)}
                    onChange={(e) => update({ ...scenario, decisions: { ...scenario.decisions, [step.id]: { ...d, after: (Number(e.target.value) || 0) * 60 } } })}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{tr("its deadline passes")}</span>
                )}
              </div>
            );
          }
          if (step.type === "wait_event") {
            const s = scenario.signals[step.id];
            return (
              <div key={step.id} className="grid gap-2 sm:grid-cols-[12rem_10rem_1fr] sm:items-center">
                <span className="truncate text-sm">{isolate(step.label || step.id)}</span>
                <select
                  aria-label={tr("Whether {step} comes", { step: step.label || step.id })}
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={s ? "comes" : "none"}
                  onChange={(e) => {
                    const signals = { ...scenario.signals };
                    if (e.target.value === "none") delete signals[step.id];
                    else signals[step.id] = { payload: {}, after: 3600 };
                    update({ ...scenario, signals });
                  }}
                >
                  <option value="comes">{tr("The event comes")}</option>
                  <option value="none">{tr("It never comes")}</option>
                </select>
                <span />
              </div>
            );
          }
          return null;
        })}
      </fieldset>
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">{tr("The whole scenario (JSON): steps inside blocks, events, cases and recoveries")}</summary>
        <Textarea dir="ltr" className="mt-2 min-h-48 font-mono text-xs" spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} aria-label={tr("The whole scenario (JSON)")} />
      </details>
      <div>
        <Button onClick={run} disabled={running}>
          <Play aria-hidden /> {tr("Run the simulation")}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {sim && (
        <div className="grid gap-2" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={sim.status.status === "finished" ? "secondary" : "outline"}>
              {sim.status.status === "finished" ? tr("Finished: {outcome}", { outcome: String(sim.status.outcome ?? "") }) : tr("Stopped")}
            </Badge>
            {sim.stopped && <span>{isolate(sim.stopped)}</span>}
            {sim.not_modelled.length > 0 && <span className="text-amber-700 dark:text-amber-400">{tr("Not modelled: {steps}", { steps: sim.not_modelled.join(", ") })}</span>}
          </div>
          <ol className="grid gap-1 text-sm">
            {sim.entries.map((e, i) => (
              <li key={i} className="grid gap-2 sm:grid-cols-[11rem_6rem_1fr_auto]">
                <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
                <span className="text-xs">{e.kind === "command" ? tr("asks") : tr("happens")}</span>
                <span className="min-w-0 truncate" dir="ltr">
                  {e.activation ? `${e.activation}: ` : ""}
                  {describe(e)}
                </span>
                {e.source ? <Badge variant={e.source === "not_modelled" ? "destructive" : "outline"}>{tr(SOURCE_LABEL[e.source] ?? e.source)}</Badge> : <span />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
