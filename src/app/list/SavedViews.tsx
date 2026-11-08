// The list's saved views: switch between them and the standard view, save the current filters,
// search, sort and columns as a view, save changes to one, rename or delete it, and pick the view
// the list opens with. Views belong to the user (they are stored with their list settings), until
// they share one with the team; then it belongs to the list, and whoever shared it looks after it.

import { Bookmark, ChevronDown, Pencil, Plus, RotateCcw, Save, Star, StarOff, Trash2, Users } from "lucide-react";
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
import { t } from "../../lib/i18n";
import { Button, confirmDialog, Dialog, Field } from "../../ui/kit";
import { sortedViews, viewNameError, type SavedView } from "./settings";
import { t as tr, isolate } from "@ferrum/client";

interface Props {
  views: Record<string, SavedView>;
  /** The views the team shares on this list. */
  team: Record<string, SavedView>;
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
  onShare: (view: SavedView) => void;
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
  const shared = a?.shared;
  // Someone else's shared view can be looked through, not changed.
  const mine = !!a && (!shared || shared.can_change);
  const teamViews = sortedViews(p.team);

  const remove = async (v: SavedView) => {
    const ok = await confirmDialog({
      title: v.shared ? tr("Stop sharing “{name}”?", { name: v.name }) : tr("Delete the view “{name}”?", { name: v.name }),
      message: v.shared
        ? tr("It goes from everyone's list of views. Its records stay.")
        : tr("Only the view is deleted: its records, filters in the address bar and other views stay."),
      confirmLabel: v.shared ? tr("Stop sharing") : tr("Delete view"),
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
          aria-label={(p.modified ? tr("Saved views: {value}, with unsaved changes", { value: a ? a.name : tr("standard view") }) : tr("Saved views: {value}", { value: a ? a.name : tr("standard view") }))}
        >
          <Bookmark className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{a ? a.name : t("Views")}</span>
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
          <DropdownMenuLabel className="text-xs text-muted-foreground">{tr("Your views")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={a?.id ?? ""} onValueChange={(id) => p.onApply(p.views[id] ?? p.team[id] ?? null)}>
            <DropdownMenuRadioItem value="" className={ITEM}>
              {tr("Standard view")}
            </DropdownMenuRadioItem>
            {sortedViews(p.views).map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id} className={ITEM}>
                <span className="min-w-0 flex-1 truncate">{isolate(v.name)}</span>
                {v.id === p.defaultId && (
                  <>
                    <Star className="size-3.5 fill-current text-warning" aria-hidden="true" />
                    <span className="sr-only">{tr("(opens by default)")}</span>
                  </>
                )}
              </DropdownMenuRadioItem>
            ))}
            {teamViews.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">{tr("Shared with the team")}</DropdownMenuLabel>}
            {teamViews.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id} className={ITEM}>
                <span className="min-w-0 flex-1 truncate">{isolate(v.name)}</span>
                {v.shared?.by && <span className="max-w-24 truncate text-xs text-muted-foreground">{isolate(v.shared.by)}</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {a && p.modified && mine && (
            <>
              <DropdownMenuItem className={ITEM} onSelect={p.onSave}>
                <Save aria-hidden="true" />
                <span className="truncate">{tr("Save changes to “{name}”", { name: a.name })}</span>
              </DropdownMenuItem>
            </>
          )}
          {a && p.modified && (
            <DropdownMenuItem className={ITEM} onSelect={() => p.onApply(a)}>
              <RotateCcw aria-hidden="true" />
              {tr("Discard changes")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className={ITEM} onSelect={later(() => setNaming({ name: "" }))}>
            <Plus aria-hidden="true" />
            {tr("Save as a new view…")}
          </DropdownMenuItem>
          {a && mine && (
            <>
              <DropdownMenuItem className={ITEM} onSelect={later(() => setNaming({ id: a.id, name: a.name }))}>
                <Pencil aria-hidden="true" />
                {tr("Rename…")}
              </DropdownMenuItem>
              {!shared && (
                <>
                  <DropdownMenuItem className={ITEM} onSelect={() => p.onDefault(isDefault ? null : a.id)}>
                    {isDefault ? <StarOff aria-hidden="true" /> : <Star aria-hidden="true" />}
                    {isDefault ? tr("Stop opening the list with it") : tr("Open the list with this view")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className={ITEM} onSelect={() => p.onShare(a)}>
                    <Users aria-hidden="true" />
                    {tr("Share with the team")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem className={ITEM} variant="destructive" onSelect={later(() => void remove(a))}>
                <Trash2 aria-hidden="true" />
                {shared ? tr("Stop sharing…") : tr("Delete…")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!naming} onClose={() => setNaming(null)} title={naming?.id ? tr("Rename view") : tr("Save as a new view")}>
        {naming && (
          <NameForm
            initial={naming.name}
            renaming={!!naming.id}
            check={(name) => viewNameError(name, a?.shared && naming.id ? p.team : p.views, naming.id)}
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
      <Field label={tr("Name")} htmlFor={`${id}-name`} required error={error ?? undefined} hint={renaming ? undefined : tr("Saves the current filters, search, sort and columns.")}>
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
          {tr("Open the list with this view")}
        </label>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>{tr("Cancel")}</Button>
        <Button type="submit" variant="primary">
          {renaming ? tr("Rename") : tr("Save view")}
        </Button>
      </div>
    </form>
  );
}
