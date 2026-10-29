// What the chart and number card builders share: an edit session over a saved record (undo/redo,
// unsaved changes, saving with version checks and a rebase onto a newer version on 409, server
// errors by field), the header with its actions, and the notice on package records.

import { useMemo, useState, type ReactNode } from "react";
import { Copy, Lock, Redo2, Save, Undo2 } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { fieldIssues, studio, useSaveStudioRecord, type Issue, type StudioRecords } from "@/lib/studio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/ui/kit";
import { mergeRecord, stableJson, useHistory } from "./history";

type Kind = "charts" | "cards";
const SERVER_KEYS = ["id", "version", "created_at", "created_by", "updated_at", "updated_by", "_titles", "base_entity", "is_standard", "docstatus", "amended_from", "number", "workflow_state"] as const;

/** A record without what the server maintains: what the user edits and what gets compared. */
export function editable<T extends object>(r: T): T {
  const out = { ...r } as Record<string, unknown>;
  for (const k of SERVER_KEYS) delete out[k];
  if (Array.isArray(out.roles)) out.roles = (out.roles as { role: string; id?: string }[]).map((x) => ({ role: x.role }));
  return out as T;
}

/** A copy to customize (package records cannot be changed): no id, a new title. */
export function duplicateOf<T extends { label: string }>(r: T): T {
  return { ...editable(r), label: `Copy of ${r.label}`.slice(0, 140) };
}

export interface Conflict {
  fields: string[];
}

export function useBuilder<K extends Kind, D>({
  kind,
  initial,
  toDraft,
  toRecord,
  onSaved,
  noun,
}: {
  kind: K;
  initial: StudioRecords[K];
  toDraft: (r: StudioRecords[K]) => D;
  /** The record to save from the draft (without id and version). */
  toRecord: (d: D) => StudioRecords[K];
  onSaved?: (r: StudioRecords[K], created: boolean) => void;
  /** "chart", "number card": for messages. */
  noun: string;
}) {
  const [base, setBase] = useState<StudioRecords[K]>(initial);
  const history = useHistory<D>(() => toDraft(initial));
  const saveMut = useSaveStudioRecord(kind);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // toDraft and toRecord are plain functions of their argument: the baseline changes with the base only.
  const baseline = useMemo(() => stableJson(editable(toRecord(toDraft(base)))), [base]);
  const record = toRecord(history.value);
  const dirty = !base.id || stableJson(editable(record)) !== baseline;

  const save = async (): Promise<StudioRecords[K] | null> => {
    const body = { ...editable(record), ...(base.id ? { id: base.id, version: base.version } : {}) } as StudioRecords[K];
    try {
      const saved = await saveMut.mutateAsync(body);
      setServerIssues([]);
      setConflict(null);
      setBase(saved);
      history.reset(toDraft(saved));
      toast(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} saved`);
      onSaved?.(saved, !base.id);
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && base.id) {
        // Someone saved first: their version becomes the base, my changes are replayed onto it.
        try {
          const latest = await studio.get(kind, base.id);
          const norm = (r: StudioRecords[K]) => editable(toRecord(toDraft(r))) as object;
          const merged = mergeRecord(norm(base), editable(record) as object, norm(latest));
          setBase(latest);
          history.set(toDraft({ ...(merged.value as StudioRecords[K]), id: latest.id, version: latest.version }));
          setConflict({ fields: merged.conflicts });
        } catch (e2) {
          toast(errorMessage(e2), "error");
        }
        return null;
      }
      const issues = fieldIssues(e);
      setServerIssues(issues);
      toast(issues.length ? `The ${noun} was not saved: please correct the highlighted settings.` : errorMessage(e), "error");
      return null;
    }
  };

  return {
    base,
    draft: history.value,
    set: history.set,
    reset: history.reset,
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    record,
    dirty,
    save,
    saving: saveMut.isPending,
    serverIssues,
    conflict,
    dismissConflict: () => setConflict(null),
    standard: !!base.is_standard,
  };
}

function IconAction({ label, keys, onClick, disabled, children }: { label: string; keys: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={`${label} (${keys})`} onClick={onClick} disabled={disabled}>
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {label} <span className="opacity-70">{keys}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const mac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);
export const KEYS = { undo: mac ? "⌘Z" : "Ctrl+Z", redo: mac ? "⇧⌘Z" : "Ctrl+Y" };

/** Undo, redo, extra actions, cancel and save, for the top of a builder. */
export function BuilderToolbar({
  canUndo,
  canRedo,
  undo,
  redo,
  dirty,
  saving,
  standard,
  onSave,
  onCancel,
  cancelLabel = "Cancel",
  extra,
  saveLabel = "Save",
}: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  dirty: boolean;
  saving: boolean;
  standard: boolean;
  onSave: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  extra?: ReactNode;
  saveLabel?: string;
}) {
  return (
    <>
      <IconAction label="Undo" keys={KEYS.undo} onClick={undo} disabled={!canUndo}>
        <Undo2 />
      </IconAction>
      <IconAction label="Redo" keys={KEYS.redo} onClick={redo} disabled={!canRedo}>
        <Redo2 />
      </IconAction>
      {extra}
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
      <Button type="button" onClick={onSave} disabled={saving || standard || !dirty} aria-busy={saving || undefined}>
        {saving ? <Spinner /> : <Save />}
        {saveLabel}
      </Button>
    </>
  );
}

/** Package records are read-only: say so, and offer a copy to customize. */
export function StandardNotice({ noun, onDuplicate }: { noun: string; onDuplicate: () => void }) {
  return (
    <Alert className="mb-4">
      <Lock />
      <AlertTitle>This {noun} comes with a package</AlertTitle>
      <AlertDescription>
        <p>It cannot be changed here. Make a copy to customize it.</p>
        <Button type="button" size="sm" variant="outline" className="mt-1" onClick={onDuplicate}>
          <Copy /> Make a copy
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** After a rebase: what happened and what to do next. */
export function ConflictNotice({ conflict, noun, onDismiss }: { conflict: Conflict; noun: string; onDismiss: () => void }) {
  return (
    <Alert className="mb-4 border-warning">
      <AlertTitle>Someone else saved this {noun} while you were editing</AlertTitle>
      <AlertDescription>
        <p>
          Their changes are now combined with yours.
          {conflict.fields.length > 0 && ` You both changed ${conflict.fields.join(", ")}: your version is kept.`} Review the preview, then save again.
        </p>
        <Button type="button" size="sm" variant="outline" className="mt-1" onClick={onDismiss}>
          Got it
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Issues for the query editor (paths inside the spec) from record-level ones (`spec.…`). */
export const specPart = (issues: Issue[]) => issues.flatMap((i) => (i.path === "spec" ? [{ ...i, path: "" }] : i.path.startsWith("spec.") ? [{ ...i, path: i.path.slice(5) }] : []));
