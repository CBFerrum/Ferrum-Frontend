// Settings every builder record shares (label, description, sharing with roles, module) and the
// "accepts" map of charts and cards: which dashboard filters apply to them, and on which field.

import { useEffect, useId, useState, type ComponentProps } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useMe, useMetaIndex, type ReportParam } from "@/lib/meta";
import { issuesAt, type Accepts, type FieldCatalog, type FilterDef, type Issue, type Sharing, type StudioRecord } from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FILTER_TYPE_LABEL } from "./filters";
import { FieldPicker } from "./pickers";
import { Messages, Section } from "./ui";

const SHARING: { value: Sharing; label: string; hint: string }[] = [
  { value: "private", label: "Only me", hint: "Managers and administrators can still open it." },
  { value: "roles", label: "People with these roles", hint: "Choose the roles below." },
  { value: "everyone", label: "Everyone", hint: "Each person still sees only the data they may read." },
];
const NONE = "__none";

type Common = Pick<StudioRecord, "label" | "description" | "sharing" | "roles" | "module">;

/** A list typed as text separated by commas, applied when the field is left (undo shows up here too). */
export function ListInput({ value, onChange, ...rest }: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & { value: string[]; onChange: (list: string[]) => void }) {
  const joined = value.join(", ");
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return (
    <Input
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = [...new Set(text.split(",").map((x) => x.trim()).filter(Boolean))];
        if (list.join(", ") !== joined) onChange(list);
        else setText(joined);
      }}
    />
  );
}

/** Label and description: the top of every builder. */
export function LabelFields({ value, onChange, issues, labelId }: { value: Common; onChange: (p: Partial<Common>, key?: string) => void; issues: Issue[]; labelId?: string }) {
  const own = useId();
  const id = labelId ?? own;
  const err = issuesAt(issues, "label");
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={id}>
          Title <span className="text-destructive" aria-hidden="true">*</span>
        </Label>
        <Input id={id} value={value.label} maxLength={140} required aria-invalid={err.length > 0 || undefined} aria-describedby={err.length ? `${id}-err` : undefined} onChange={(e) => onChange({ label: e.target.value }, "label")} />
        <div id={`${id}-err`}>
          <Messages list={err} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-desc`}>Description</Label>
        <Textarea id={`${id}-desc`} rows={2} value={value.description ?? ""} onChange={(e) => onChange({ description: e.target.value }, "description")} />
      </div>
    </div>
  );
}

/** Who may open it, and the module menu it shows in. */
export function SharingFields({ value, onChange, issues }: { value: Common; onChange: (p: Partial<Common>, key?: string) => void; issues: Issue[] }) {
  const id = useId();
  const modules = useMetaIndex().data?.modules ?? [];
  const myRoles = useMe().data?.user.roles ?? [];
  const setRoles = (names: string[]) => {
    const known = new Map((value.roles ?? []).map((r) => [r.role, r.id]));
    onChange({ roles: names.map((role) => (known.get(role) ? { id: known.get(role), role } : { role })) }, "roles");
  };
  return (
    <Section title="Sharing" hint="The data inside is always computed with each viewer's own permissions.">
      <RadioGroup value={value.sharing} onValueChange={(v) => onChange({ sharing: v as Sharing })} aria-label="Who can open it" className="gap-2">
        {SHARING.map((s) => (
          <Label key={s.value} htmlFor={`${id}-${s.value}`} className="flex items-start gap-2.5 rounded-md border p-2.5 font-normal has-[[data-state=checked]]:border-primary">
            <RadioGroupItem id={`${id}-${s.value}`} value={s.value} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.hint}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {value.sharing === "roles" && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-roles`}>Roles</Label>
          <ListInput
            id={`${id}-roles`}
            list={`${id}-role-list`}
            value={(value.roles ?? []).map((r) => r.role)}
            placeholder="Sales Manager, Accounts User"
            onChange={setRoles}
            aria-invalid={issuesAt(issues, "roles").length > 0 || undefined}
          />
          <datalist id={`${id}-role-list`}>
            {myRoles.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">Separate roles with commas.</p>
          <Messages list={issuesAt(issues, "roles")} />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-module`}>Module</Label>
        <Select value={value.module || NONE} onValueChange={(m) => onChange({ module: m === NONE ? null : m })}>
          <SelectTrigger id={`${id}-module`} className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {value.module && !modules.some((m) => m.name === value.module) && <SelectItem value={value.module}>{value.module}</SelectItem>}
            {modules.map((m) => (
              <SelectItem key={m.name} value={m.name}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Messages list={issuesAt(issues, "module")} />
      </div>
    </Section>
  );
}

const AUTO = "__auto";
const IGNORE = "__ignore";
const FIELD = "__field";

/**
 * Which dashboard filters a chart or card takes: by default a date range lands on its own date
 * field and any other filter on a field of the same name; a filter can be pointed at another
 * field (or report parameter) or ignored.
 */
export function AcceptsEditor({
  value,
  onChange,
  defs,
  catalog,
  params,
  issues,
}: {
  value: Accepts | null | undefined;
  onChange: (a: Accepts | null) => void;
  /** The dashboard's filters, when the builder was opened from one. */
  defs: FilterDef[];
  catalog?: FieldCatalog;
  /** Built-in report sources map filters to their parameters. */
  params?: ReportParam[];
  issues: Issue[];
}) {
  const accepts = value ?? {};
  const names = [...new Set([...defs.map((d) => d.name), ...Object.keys(accepts)])];
  const set = (name: string, target: string | false | undefined) => {
    const next = { ...accepts };
    if (target === undefined) delete next[name];
    else next[name] = target;
    onChange(Object.keys(next).length ? next : null);
  };
  const adding = useId();
  const add = (name: string) => {
    if (name.trim()) set(name.trim().toLowerCase(), false);
  };
  return (
    <Section title="Dashboard filters" hint="Filters of the dashboard it sits on apply automatically: a date range to its date field, any other filter to a field of the same name.">
      {names.length === 0 && <p className="text-sm text-muted-foreground">{defs.length ? "" : "Open the builder from a dashboard to map its filters, or name a filter below."}</p>}
      {names.map((name) => {
        const def = defs.find((d) => d.name === name);
        const t = accepts[name];
        const mode = t === undefined ? AUTO : t === false ? IGNORE : FIELD;
        return (
          <div key={name} className="grid gap-1 rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">
                {def?.label || name}
                {def && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{FILTER_TYPE_LABEL[def.type]}</span>}
              </span>
              {!def && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove the setting for ${name}`} onClick={() => set(name, undefined)}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Select value={mode} onValueChange={(m) => set(name, m === AUTO ? undefined : m === IGNORE ? false : params?.[0]?.name ?? catalog?.fields.find((f) => f.groupable)?.path ?? "")}>
                <SelectTrigger aria-label={`${def?.label || name}: applies`} className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Automatically</SelectItem>
                  <SelectItem value={FIELD}>{params ? "To a parameter" : "To a field"}</SelectItem>
                  <SelectItem value={IGNORE}>Not at all</SelectItem>
                </SelectContent>
              </Select>
              {mode === FIELD &&
                (params ? (
                  <Select value={typeof t === "string" ? t : undefined} onValueChange={(p) => set(name, p)}>
                    <SelectTrigger aria-label={`${def?.label || name}: parameter`} className="h-9 w-full">
                      <SelectValue placeholder="Choose a parameter…" />
                    </SelectTrigger>
                    <SelectContent>
                      {params.map((p) => (
                        <SelectItem key={p.name} value={p.name}>
                          {p.label ?? p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <FieldPicker catalog={catalog} which={def?.type === "date_range" || def?.type === "date" ? "date" : "any"} value={typeof t === "string" ? t : undefined} label={`${def?.label || name}: field`} onChange={(p) => set(name, p)} />
                ))}
            </div>
          </div>
        );
      })}
      {!defs.length && (
        <div className="flex gap-1.5">
          <Input
            id={adding}
            placeholder="Filter name, such as company"
            aria-label="Filter name to set up"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(e.currentTarget.value);
                e.currentTarget.value = "";
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const el = document.getElementById(adding) as HTMLInputElement | null;
              if (el) {
                add(el.value);
                el.value = "";
              }
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      )}
      <Messages list={issuesAt(issues, "accepts")} />
    </Section>
  );
}
