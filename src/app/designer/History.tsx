// The entity's saved form layouts (each a `form` customization), newest first, with the one in use and a
// way back to any of them, including the entity's own layout without customizations.

import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatDateTime } from "../../lib/format";
import type { EntityMeta } from "../../lib/meta";
import { ErrorState } from "../../ui/kit";
import { layoutSummary, plural, type Customization } from "./logic";

/** Restoring this target turns every layout customization off. */
export const ORIGINAL = "original";

export function LayoutHistory({
  meta,
  loading,
  error,
  onRetry,
  versions,
  current,
  restoring,
  onRestore,
}: {
  meta: EntityMeta;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  versions: Customization[];
  current: Customization | null;
  /** The version being restored (its id, or ORIGINAL). */
  restoring: string | null;
  onRestore: (target: Customization | null) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the layout history">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} title="Could not load the history" />;
  const restoreButton = (target: Customization | null) => {
    const id = target?.id ?? ORIGINAL;
    return (
      <Button variant="outline" size="sm" className="mt-3 pointer-coarse:h-11" disabled={!!restoring} onClick={() => onRestore(target)}>
        {restoring === id ? <Spinner /> : <RotateCcw aria-hidden="true" />} Restore
      </Button>
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {!versions.length && <p className="text-sm text-muted-foreground">No layout has been saved for {meta.label} yet. Each save adds one here.</p>}
      <ol className="flex flex-col gap-2" aria-label="Saved layouts, newest first">
        {versions.map((v) => {
          const sum = layoutSummary(v.op.value);
          const inUse = current?.id === v.id;
          return (
            <li key={v.id} className={cn("rounded-lg border bg-card p-3", inUse && "border-primary")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{formatDateTime(v.created_at)}</p>
                  <p className="text-xs text-muted-foreground">
                    {plural(sum.tabs, "tab")} · {plural(sum.sections, "section")} · {plural(sum.fields, "field")}
                  </p>
                  {v.note && <p className="mt-1 text-sm break-words">{v.note}</p>}
                </div>
                {inUse ? (
                  <Badge>In use</Badge>
                ) : v.is_active ? (
                  <Badge variant="secondary" title="Switched on, but a later layout is in use">
                    Replaced
                  </Badge>
                ) : (
                  <Badge variant="outline">Off</Badge>
                )}
              </div>
              {!inUse && restoreButton(v)}
            </li>
          );
        })}
        <li className={cn("rounded-lg border border-dashed p-3", !current && "border-primary")}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Original layout</p>
              <p className="text-xs text-muted-foreground">
                {meta.custom ? "As the entity was defined" : "As its app defines it"}, without layout customizations.
              </p>
            </div>
            {!current && <Badge>In use</Badge>}
          </div>
          {current && restoreButton(null)}
        </li>
      </ol>
    </div>
  );
}
