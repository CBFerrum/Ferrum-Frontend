// The list's saved views: switch between them and the standard view, save the current filters,
// search, sort and columns as a view, save changes to one, rename or delete it, and pick the view
// the list opens with. Views belong to the user (they are stored with their list settings).

import { Bookmark, ChevronDown, Pencil, Plus, RotateCcw, Save, Star, StarOff, Trash2 } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button, confirmDialog, Dialog, Field } from "../../ui/kit";
import { sortedViews, viewNameError, type SavedView } from "./settings";

interface Props {
  views: Record<string, SavedView>;
  active: SavedView | null;
  /** The list's filters, search or sort differ from what the active view saved. */
  modified: boolean;
  defaultId?: string;
  onApply: (view: SavedView | null) => void;
  onCreate: (name: string, makeDefault: boolean) => void;
  onSave: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDefault: (id: string | null) => void;
}

const ITEM = "pointer-coarse:min-h-11";

export function SavedViews(p: Props) {
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // An item that opens a dialog runs once the menu has closed and focus is back on its button, so
  // the dialog returns focus there when it closes.
  const pending = useRef<(() => void) | null>(null);
  const later = (fn: () => void) => () => {
    pending.current = fn;
  };
  const a = p.active;
  const isDefault = !!a && a.id === p.defaultId;

  const remove = async (v: SavedView) => {
    const ok = await confirmDialog({
      title: `Delete the view “${v.name}”?`,
      message: "Only the view is deleted: its records, filters in the address bar and other views stay.",
      confirmLabel: "Delete view",
      danger: true,
    });
    if (ok) p.onDelete(v.id);
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          ref={trigger}
          className="btn btn-default btn-md max-w-[16rem]"
          aria-label={`Saved views: ${a ? a.name : "standard view"}${p.modified ? ", with unsaved changes" : ""}`}
        >
          <Bookmark className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{a ? a.name : "Views"}</span>
          {p.modified && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-72 max-w-[calc(100vw-2rem)]"
          onCloseAutoFocus={(e) => {
            const fn = pending.current;
            if (!fn) return;
            pending.current = null;
            e.preventDefault();
            trigger.current?.focus();
            fn();
          }}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">Your views</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={a?.id ?? ""} onValueChange={(id) => p.onApply(p.views[id] ?? null)}>
            <DropdownMenuRadioItem value="" className={ITEM}>
              Standard view
            </DropdownMenuRadioItem>
            {sortedViews(p.views).map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id} className={ITEM}>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {v.id === p.defaultId && (
                  <>
                    <Star className="size-3.5 fill-current text-warning" aria-hidden="true" />
                    <span className="sr-only">(opens by default)</span>
                  </>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {a && p.modified && (
            <>
              <DropdownMenuItem className={ITEM} onSelect={p.onSave}>
                <Save aria-hidden="true" />
                <span className="truncate">Save changes to “{a.name}”</span>
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM} onSelect={() => p.onApply(a)}>
                <RotateCcw aria-hidden="true" />
                Discard changes
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem className={ITEM} onSelect={later(() => setNaming({ name: "" }))}>
            <Plus aria-hidden="true" />
            Save as a new view…
          </DropdownMenuItem>
          {a && (
            <>
              <DropdownMenuItem className={ITEM} onSelect={later(() => setNaming({ id: a.id, name: a.name }))}>
                <Pencil aria-hidden="true" />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM} onSelect={() => p.onDefault(isDefault ? null : a.id)}>
                {isDefault ? <StarOff aria-hidden="true" /> : <Star aria-hidden="true" />}
                {isDefault ? "Stop opening the list with it" : "Open the list with this view"}
              </DropdownMenuItem>
              <DropdownMenuItem className={ITEM} variant="destructive" onSelect={later(() => void remove(a))}>
                <Trash2 aria-hidden="true" />
                Delete…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!naming} onClose={() => setNaming(null)} title={naming?.id ? "Rename view" : "Save as a new view"}>
        {naming && (
          <NameForm
            initial={naming.name}
            renaming={!!naming.id}
            check={(name) => viewNameError(name, p.views, naming.id)}
            onCancel={() => setNaming(null)}
            onDone={(name, makeDefault) => {
              if (naming.id) p.onRename(naming.id, name);
              else p.onCreate(name, makeDefault);
              setNaming(null);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function NameForm({
  initial,
  renaming,
  check,
  onCancel,
  onDone,
}: {
  initial: string;
  renaming: boolean;
  check: (name: string) => string | null;
  onCancel: () => void;
  onDone: (name: string, makeDefault: boolean) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = check(name);
    setError(problem);
    if (!problem) onDone(name.trim(), makeDefault);
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Name" htmlFor={`${id}-name`} required error={error ?? undefined} hint={renaming ? undefined : "Saves the current filters, search, sort and columns."}>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          maxLength={60}
          autoComplete="off"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-name-error` : renaming ? undefined : `${id}-name-hint`}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      {!renaming && (
        <label className="check-field">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          Open the list with this view
        </label>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          {renaming ? "Rename" : "Save view"}
        </Button>
      </div>
    </form>
  );
}
