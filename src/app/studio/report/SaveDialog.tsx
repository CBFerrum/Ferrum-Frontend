// Saving a report: its name, description, menu module and who may open it (only the creator,
// chosen roles or everyone; the data shown is always what each viewer's own permissions allow).
// And the choice offered when someone else saved the report first.

import { useQuery } from "@tanstack/react-query";
import { Check, Globe, Lock, Users, X } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useMe, useMetaIndex } from "@/lib/meta";
import { issuesAt, type Issue, type Sharing } from "@/lib/studio";
import { Issues } from "./ui";

export interface SaveMeta {
  label: string;
  description: string;
  sharing: Sharing;
  roles: string[];
  module: string;
}

export type SaveMode = "create" | "copy" | "settings";

const TITLE: Record<SaveMode, [string, string]> = {
  create: ["Save report", "Save"],
  copy: ["Save a copy", "Save copy"],
  settings: ["Report settings", "Save"],
};

/** Roles to share with: the workspace's for administrators, else the viewer's own (the server checks every name). */
function useRoleNames(): string[] {
  const me = useMe();
  const admin = !!me.data?.user.is_admin;
  const all = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: ({ signal }) => api.get<{ roles: { name: string }[] }>("/api/admin/roles", undefined, signal),
    enabled: admin,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const names = all.data?.roles.map((r) => r.name) ?? me.data?.user.roles ?? [];
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [all.data, me.data]);
}

interface SaveDialogProps {
  mode: SaveMode;
  initial: SaveMeta;
  busy: boolean;
  /** Problems with the record's own fields (label, roles, …) from the last attempt. */
  issues: Issue[];
  /** Other problems from the last attempt (the query, columns or chart). */
  general: string[];
  onCancel: () => void;
  onSubmit: (m: SaveMeta) => void;
}

/** Render it keyed by what it edits: the form starts from `initial`. */
export function SaveDialog({ mode, initial, busy, issues, general, onCancel, onSubmit }: SaveDialogProps) {
  const id = useId();
  const [m, setM] = useState<SaveMeta>(initial);
  const [missingRoles, setMissingRoles] = useState(false);
  const roleNames = useRoleNames();
  const index = useMetaIndex();
  const modules = index.data?.modules ?? [];
  const [title, action] = TITLE[mode];
  const labelIssues = issuesAt(issues, "label");
  const roleIssues = [...issuesAt(issues, "roles"), ...(missingRoles ? ["Choose at least one role"] : [])];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.sharing === "roles" && !m.roles.length) return setMissingRoles(true);
    onSubmit({ ...m, label: m.label.trim(), description: m.description.trim() });
  };
  const toggleRole = (r: string) => {
    setMissingRoles(false);
    setM((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] }));
  };
  const options = [...new Set([...roleNames, ...m.roles])];
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Whoever opens it sees only the records their own permissions allow.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {general.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="grid gap-0.5">
                  {general.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-label`}>Name</Label>
            <Input
              id={`${id}-label`}
              required
              maxLength={140}
              autoFocus
              value={m.label}
              aria-invalid={labelIssues.length ? true : undefined}
              aria-describedby={labelIssues.length ? `${id}-label-issues` : undefined}
              onChange={(e) => setM({ ...m, label: e.target.value })}
            />
            <Issues id={`${id}-label-issues`} messages={labelIssues} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-desc`}>Description</Label>
            <Textarea id={`${id}-desc`} rows={2} value={m.description} placeholder="What it answers, for whoever opens it" onChange={(e) => setM({ ...m, description: e.target.value })} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Who can open it</legend>
            <RadioGroup value={m.sharing} onValueChange={(v) => setM({ ...m, sharing: v as Sharing })} className="gap-2">
              {(
                [
                  ["private", Lock, "Only me", "Administrators and report managers can still open it."],
                  ["roles", Users, "People with chosen roles", undefined],
                  ["everyone", Globe, "Everyone in the workspace", undefined],
                ] as const
              ).map(([value, Icon, text, hint]) => (
                <Label key={value} htmlFor={`${id}-${value}`} className="items-start gap-3 rounded-md border border-border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem id={`${id}-${value}`} value={value} className="mt-0.5" />
                  <span className="grid gap-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> {text}
                    </span>
                    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          {m.sharing === "roles" && (
            <div className="grid gap-1.5">
              <Label id={`${id}-roles`}>Roles</Label>
              {m.roles.length > 0 && (
                <ul className="flex flex-wrap gap-1" aria-label="Chosen roles">
                  {m.roles.map((r) => (
                    <li key={r} className="flex items-center gap-0.5 rounded bg-secondary py-0.5 pr-0.5 pl-2 text-xs">
                      {r}
                      <button type="button" className="grid size-5 place-items-center rounded hover:bg-accent pointer-coarse:size-8" aria-label={`Remove role ${r}`} onClick={() => toggleRole(r)}>
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Command className="rounded-md border border-input" aria-labelledby={`${id}-roles`}>
                <CommandInput placeholder="Find a role…" aria-label="Find a role" />
                <CommandList className="max-h-44">
                  <CommandEmpty>No role matches.</CommandEmpty>
                  <CommandGroup>
                    {options.map((r) => (
                      <CommandItem key={r} value={r} onSelect={() => toggleRole(r)} className="pointer-coarse:py-3">
                        <Check className={m.roles.includes(r) ? "opacity-100" : "opacity-0"} aria-hidden="true" />
                        {r}
                        <span className="sr-only">{m.roles.includes(r) ? "(chosen)" : ""}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
              <Issues messages={roleIssues} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-module`}>Show in the menu of</Label>
            <Select value={m.module || "__none__"} onValueChange={(v) => setM({ ...m, module: v === "__none__" ? "" : v })}>
              <SelectTrigger id={`${id}-module`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No module (the reports list only)</SelectItem>
                {modules.map((x) => (
                  <SelectItem key={x.name} value={x.name}>
                    {x.label}
                  </SelectItem>
                ))}
                {m.module && !modules.some((x) => x.name === m.module) && <SelectItem value={m.module}>{m.module}</SelectItem>}
              </SelectContent>
            </Select>
            <Issues messages={issuesAt(issues, "module")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !m.label.trim()}>
              {busy && <Spinner />}
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Someone saved the report since it was opened: overwrite their version, load it, or keep editing. */
export function ConflictDialog({ open, busy, onOverwrite, onLoadTheirs, onCancel }: { open: boolean; busy: boolean; onOverwrite: () => void; onLoadTheirs: () => void; onCancel: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Someone else saved this report</AlertDialogTitle>
          <AlertDialogDescription>It changed after you opened it. Save your version over theirs, or load theirs and drop your unsaved changes.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep editing</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={onLoadTheirs}>
            Load their version
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onOverwrite}>
            {busy && <Spinner />}
            Save mine over it
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
