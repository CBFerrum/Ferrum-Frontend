// The diagram view of a process (FLC-UI-002): the same parsed source the guided and source views edit, drawn as its
// steps and the routes between them, in layers from the first step. Choosing a step opens the same inspector as the
// guided view, so a change made here is made to the one definition and every setting no view shows is kept. Each
// step is a button in reading order, so nothing needs dragging (FLC-UI-004); routes are said in words as well.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { routesOf, useCatalog, type Process, type Source, type Step } from "@/lib/solutions";
import { Inspector, KIND_LABEL, type Selection } from "./GuidedEditor";
import { t as tr, isolate } from "@ferrum/client";

export interface Placed {
  step: Step;
  layer: number;
  x: number;
  y: number;
}
export interface Edge {
  from: string;
  to: string;
  route: string;
}

const W = 184;
const H = 60;
const GAP_X = 72;
const GAP_Y = 28;

/** Each step placed in layers from the first one along its routes; a step no route reaches comes last. Every step
 * and every route of the process is there: the layout only reads. */
export function layout(p: Process): { placed: Placed[]; edges: Edge[]; width: number; height: number } {
  const byId = new Map(p.nodes.map((n) => [n.id, n] as const));
  const layer = new Map<string, number>();
  const queue: string[] = [];
  if (byId.has(p.entry)) {
    layer.set(p.entry, 0);
    queue.push(p.entry);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const [, to] of routesOf(byId.get(id)!)) {
      if (byId.has(to) && !layer.has(to)) {
        layer.set(to, layer.get(id)! + 1);
        queue.push(to);
      }
    }
  }
  const unreached = Math.max(-1, ...layer.values()) + 1;
  for (const n of p.nodes) if (!layer.has(n.id)) layer.set(n.id, unreached);
  const rows = new Map<number, number>();
  const placed = p.nodes
    .map((step) => {
      const l = layer.get(step.id)!;
      const row = rows.get(l) ?? 0;
      rows.set(l, row + 1);
      return { step, layer: l, x: l * (W + GAP_X), y: row * (H + GAP_Y) };
    })
    .sort((a, b) => a.layer - b.layer || a.y - b.y);
  const edges = p.nodes.flatMap((n) => routesOf(n).flatMap(([route, to]) => (byId.has(to) ? [{ from: n.id, to, route }] : [])));
  const layers = Math.max(0, ...placed.map((x) => x.layer)) + 1;
  return { placed, edges, width: layers * (W + GAP_X) - GAP_X, height: Math.max(1, ...rows.values()) * (H + GAP_Y) - GAP_Y };
}

function path(a: Placed, b: Placed): string {
  if (b.layer > a.layer) {
    const [x1, y1, x2, y2] = [a.x + W, a.y + H / 2, b.x, b.y + H / 2];
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  }
  // Back to an earlier step, or within one layer: around the bottom.
  const [x1, y1, x2, y2] = [a.x + W / 2, a.y + H, b.x + W / 2, b.y + H];
  const low = Math.max(y1, y2) + GAP_Y / 1.5;
  return `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2}`;
}

export function Diagram({
  source,
  onChange,
  selected,
  onSelect,
}: {
  source: Source;
  onChange: (s: Source) => void;
  selected: Selection | null;
  onSelect: (s: Selection | null) => void;
}) {
  const catalog = useCatalog();
  const processes = source.processes ?? [];
  const [current, setCurrent] = useState(processes[0]?.id ?? "");
  const p = processes.find((x) => x.id === (selected?.process ?? current)) ?? processes[0];
  const drawn = useMemo(() => (p ? layout(p) : null), [p]);
  if (!p || !drawn) return <p className="text-sm text-muted-foreground">{tr("No process yet. Add one, or write rules and decisions in the source.")}</p>;
  const at = new Map(drawn.placed.map((x) => [x.step.id, x] as const));
  const label = (id: string) => {
    const s = at.get(id)?.step;
    return s ? s.label || s.id : id;
  };
  const chosen = selected?.process === p.id && selected.path.length === 0 ? p.nodes.find((n) => n.id === selected.step) : undefined;
  return (
    <div className="grid gap-4">
      {processes.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={tr("Process")}>
          {processes.map((x) => (
            <Button
              key={x.id}
              size="sm"
              variant={x.id === p.id ? "default" : "outline"}
              aria-pressed={x.id === p.id}
              onClick={() => {
                setCurrent(x.id);
                onSelect(null);
              }}
            >
              {isolate(x.label || x.id)}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 overflow-x-auto rounded-md border p-3" dir="ltr">
          <div className="relative" style={{ width: drawn.width, height: drawn.height + GAP_Y }}>
            <svg aria-hidden="true" width={drawn.width} height={drawn.height + GAP_Y} className="absolute inset-0 text-muted-foreground">
              <defs>
                <marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                </marker>
              </defs>
              {drawn.edges.map((e) => {
                const a = at.get(e.from)!;
                const b = at.get(e.to)!;
                return <path key={`${e.from}-${e.route}-${e.to}`} d={path(a, b)} fill="none" stroke="currentColor" strokeWidth={1.25} markerEnd="url(#diagram-arrow)" />;
              })}
            </svg>
            <ol aria-label={tr("Steps of {process}", { process: p.label || p.id })}>
              {drawn.placed.map(({ step, x, y }) => {
                const routes = routesOf(step).filter(([, to]) => at.has(to));
                const isSel = chosen?.id === step.id;
                return (
                  <li key={step.id} className="absolute" style={{ left: x, top: y, width: W, height: H }}>
                    <button
                      type="button"
                      aria-current={isSel ? "true" : undefined}
                      className={`flex h-full w-full flex-col items-start justify-center gap-1 overflow-hidden rounded-md border bg-background px-2 text-start text-sm ${isSel ? "border-primary ring-1 ring-primary" : "hover:bg-muted"}`}
                      onClick={() => onSelect({ process: p.id, path: [], step: step.id })}
                    >
                      <span className="flex w-full min-w-0 items-center gap-1">
                        <Badge variant="outline" className="shrink-0">
                          {tr(KIND_LABEL[step.type] ?? step.type)}
                        </Badge>
                        {p.entry === step.id && <Badge variant="secondary">{tr("start")}</Badge>}
                      </span>
                      <span className="w-full truncate font-medium">{isolate(step.label || step.id)}</span>
                      {routes.length > 0 && (
                        <span className="sr-only">
                          {tr("Goes on to {targets}", { targets: routes.map(([r, to]) => `${label(to)} (${r})`).join(", ") })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        <section id="diagram-inspector" tabIndex={-1} aria-label={tr("Inspector")} className="min-w-0 rounded-md border p-3">
          {chosen ? (
            <Inspector source={source} p={p} path={[]} step={chosen} onChange={onChange} onSelect={onSelect} catalog={catalog.data?.capabilities ?? []} />
          ) : (
            <p className="text-sm text-muted-foreground">{tr("Choose a step to see and change its settings.")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
