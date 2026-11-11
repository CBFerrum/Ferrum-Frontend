// The catalogue: every token, primitive and pattern in one page, in labelled sections with stable ids
// (`#g-…`, `data-gallery`) for screenshot scripts. The controls at the top set <html> data-theme,
// data-density, data-contrast and dir. Content is synthetic. Words here are not t()-ed: a dev page.

import { useEffect, useRef, useState } from "react";
import { Badge as ShBadge } from "@/components/ui/badge";
import { Button as ShButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { Textarea } from "@/components/ui/textarea";
import { EmptyRun } from "@/app/EmptyRun";
import { Alert, Badge, Button, confirmDialog, ConfirmHost, Dialog, Field, Menu, MenuItem, PageLoading, TabPanel, Tabs, toast, Toaster, type Tone } from "@/ui/kit";
import { FormSkeleton, ListSkeleton, ReaderSkeleton, SaveStatus, SelectionToolbar, StatePanel, TableSkeleton, type SaveState, type StateKind } from "@/ui/patterns";

const FILE = "Q3-consolidated-statement-of-financial-position-final-reviewed-v12 (copy).xlsx";
const PEOPLE = ["Aarav Sharma", "فاطمة المنصوري", "李明", "Zoë Kowalski", "Дмитрий Орлов", "प्रिया नायर"];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`g-${id}`} data-gallery={id} className="flex flex-col gap-4 border-t border-border py-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const TOKENS = ["--bg", "--surface", "--surface-2", "--surface-3", "--border", "--border-strong", "--border-control", "--text", "--muted-foreground", "--faint", "--primary", "--primary-hover", "--primary-soft", "--primary-text", "--danger", "--danger-soft", "--success", "--success-soft", "--warning", "--warning-soft", "--purple", "--purple-soft", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6", "--chart-7", "--chart-8"];

/** A token's swatch; the resolved colour is read from the element (light-dark() is already resolved there). */
function Swatch({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const read = () => ref.current && setValue(getComputedStyle(ref.current).backgroundColor);
    read();
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, { attributes: true });
    return () => watch.disconnect();
  }, []);
  return (
    <div data-token={name} className="flex items-center gap-3">
      <div ref={ref} className="size-10 shrink-0 rounded-md border border-border" style={{ background: `var(${name})` }} />
      <div className="min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{value}</div>
      </div>
    </div>
  );
}

const ROLES = [
  ["text-xs", "caption"],
  ["text-sm", "compact UI"],
  ["text-base", "standard UI"],
  ["text-lg", "reading, message body"],
  ["text-xl", "section heading"],
  ["text-2xl", "page heading"],
] as const;

const KIT_VARIANTS = ["default", "primary", "danger", "ghost"] as const;
const SH_VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const SH_SIZES = ["xs", "sm", "default", "lg"] as const;
const TONES: Tone[] = ["neutral", "blue", "green", "amber", "red", "purple"];
const KINDS: StateKind[] = ["loading", "empty", "no-matches", "denied", "offline", "failed"];
const SAVES: SaveState[] = ["draft", "saving", "saved", "local", "conflict", "failed", "unknown"];
const AT = "2026-11-10T14:32:00Z";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Controls() {
  const [theme, setTheme] = useState("light");
  const [density, setDensity] = useState("comfortable");
  const [contrast, setContrast] = useState("normal");
  const [dir, setDir] = useState("ltr");
  useEffect(() => {
    const h = document.documentElement;
    h.dataset.theme = theme;
    h.dataset.density = density;
    if (contrast === "more") h.dataset.contrast = "more";
    else delete h.dataset.contrast;
    h.dir = dir;
  }, [theme, density, contrast, dir]);
  const pick = (label: string, value: string, set: (v: string) => void, options: string[]) => (
    <label className="flex items-center gap-2 text-sm">
      {label}
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div id="g-controls" data-gallery="controls" className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-border bg-background py-3">
      {pick("Theme", theme, setTheme, ["light", "dark"])}
      {pick("Density", density, setDensity, ["comfortable", "compact"])}
      {pick("Contrast", contrast, setContrast, ["normal", "more"])}
      {pick("Direction", dir, setDir, ["ltr", "rtl"])}
    </div>
  );
}

/** The sections alone (the tests render these). */
export function Sections() {
  const [tab, setTab] = useState("invoices");
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  return (
    <>
      <Section id="type" title="Type roles">
        {ROLES.map(([cls, role]) => (
          <p key={cls} className={cls}>
            {cls} · {role}: Invoice INV-2026-00418 for {PEOPLE[0]}, due 30 November
          </p>
        ))}
      </Section>

      <Section id="colour" title="Colour tokens">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOKENS.map((n) => (
            <Swatch key={n} name={n} />
          ))}
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <p className="text-sm text-muted-foreground">Kit Button, then the shadcn primitive; variants down, sizes across.</p>
        <div data-gallery="buttons-kit" className="flex flex-col gap-3">
          {KIT_VARIANTS.map((v) => (
            <Row key={v} label={`kit ${v}`}>
              <Button variant={v} size="md">Approve invoice</Button>
              <Button variant={v} size="sm">Approve</Button>
              <Button variant={v} icon="plus">New</Button>
              <Button variant={v} disabled>Disabled</Button>
              <Button variant={v} loading>Loading</Button>
            </Row>
          ))}
        </div>
        <div data-gallery="buttons-primitive" className="flex flex-col gap-3">
          {SH_VARIANTS.map((v) => (
            <Row key={v} label={`shadcn ${v}`}>
              {SH_SIZES.map((s) => (
                <ShButton key={s} variant={v} size={s}>{s}</ShButton>
              ))}
              <ShButton variant={v} disabled>disabled</ShButton>
              <ShButton variant={v} className="outline-2 outline-solid outline-offset-2 outline-ring" data-forced="focus-visible">focus (forced)</ShButton>
            </Row>
          ))}
        </div>
      </Section>

      <Section id="inputs" title="Inputs">
        {(["rest", "disabled", "invalid"] as const).map((state) => {
          const common = { disabled: state === "disabled", "aria-invalid": state === "invalid" || undefined };
          return (
            <div key={state} data-gallery={`inputs-${state}`} className="grid items-center gap-3 sm:grid-cols-5">
              <Input aria-label={`Customer (${state})`} defaultValue={PEOPLE[2]} {...common} />
              <Select disabled={common.disabled}>
                <SelectTrigger aria-label={`Status (${state})`} aria-invalid={common["aria-invalid"]}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
              <Textarea aria-label={`Notes (${state})`} defaultValue={FILE} {...common} />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} aria-label={`Send reminder (${state})`} {...common} />
                Send reminder
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch aria-label={`Auto-approve (${state})`} {...common} />
                Auto-approve
              </label>
            </div>
          );
        })}
      </Section>

      <Section id="record-form" title="Record form">
        <div data-gallery="record-form-states" className="form-grid" style={{ "--cols": 3 } as React.CSSProperties}>
          <Field label="Customer" htmlFor="rf-editable">
            <input id="rf-editable" className="input" defaultValue={PEOPLE[2]} />
          </Field>
          <Field label="Order date" htmlFor="rf-required" required>
            <input id="rf-required" className="input" defaultValue="2026-10-30" type="date" />
          </Field>
          <Field label="Customer PO no" htmlFor="rf-hint" hint="Printed on the invoice; leave empty if the customer sent none.">
            <input id="rf-hint" className="input" />
          </Field>
          <Field label="Contact email" htmlFor="rf-invalid" error="Enter an address like name@example.com." required>
            <input id="rf-invalid" className="input" defaultValue="not-an-address" aria-invalid="true" aria-describedby="rf-invalid-error" />
          </Field>
          <Field label="Customer name (read-only value)" htmlFor="rf-readonly">
            <input id="rf-readonly" className="input read-value" readOnly tabIndex={-1} placeholder="—" defaultValue="Acme Traders Pvt Ltd" />
          </Field>
          <Field label="Quotation (read-only, empty)" htmlFor="rf-readonly-empty">
            <input id="rf-readonly-empty" className="input read-value" readOnly tabIndex={-1} placeholder="—" />
          </Field>
          <Field label="Credit limit (disabled control)" htmlFor="rf-disabled" hint="Available once the customer is approved.">
            <input id="rf-disabled" className="input" disabled defaultValue="50,000.00" />
          </Field>
          <Field label="Terms" htmlFor="rf-text">
            <textarea id="rf-text" className="textarea" defaultValue="Net 30" />
          </Field>
          <Field label="Charge type" htmlFor="rf-select">
            <select id="rf-select" className="select" defaultValue="Net">
              <option>Net</option>
              <option>Actual</option>
            </select>
          </Field>
          <Field label="Web order (read-only, yes)" htmlFor="rf-check-yes">
            <output id="rf-check-yes" className="read-text">Yes</output>
          </Field>
          <Field label="Round off (read-only, no)" htmlFor="rf-check-no">
            <output id="rf-check-no" className="read-text read-text-off">No</output>
          </Field>
          <EmptyRun labels={["Web payment", "Contact email", "Ship to"]}>
            {["Web payment", "Contact email", "Ship to"].map((l, i) => (
              <Field key={l} label={l} htmlFor={`rf-run-${i}`} className="field-empty">
                <input id={`rf-run-${i}`} className="input read-value" readOnly tabIndex={-1} placeholder="—" />
              </Field>
            ))}
          </EmptyRun>
        </div>
        <div data-gallery="record-form-totals" className="totals">
          {[["rf-t1", "Total", "7,500.00"], ["rf-t2", "Total taxes", "1,350.00"], ["rf-t3", "Grand total", "8,850.00"]].map(([id, label, v]) => (
            <Field key={id} label={label} htmlFor={id}>
              <input id={id} className="input read-value num" readOnly tabIndex={-1} defaultValue={v} />
            </Field>
          ))}
        </div>
      </Section>

      <Section id="badges" title="Badges">
        <Row label="kit tones">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>{tone}</Badge>
          ))}
        </Row>
        <Row label="shadcn">
          {(["default", "secondary", "destructive", "outline"] as const).map((v) => (
            <ShBadge key={v} variant={v}>{v}</ShBadge>
          ))}
        </Row>
      </Section>

      <Section id="chips" title="Chips and toggles">
        <div className="chips" data-gallery="chips">
          <button type="button" className="chip">Button</button>
          <button type="button" className="chip" aria-pressed="true" data-gallery="chip-pressed">Pressed</button>
          <button type="button" className="chip" aria-pressed="false">Not pressed</button>
          <a className="chip" href="#g-chips">Link</a>
          <span className="chip">Span with a count <strong>3</strong></span>
          <button type="button" className="chip">Showing Meera Rao&apos;s tickets <span className="icon" aria-hidden="true">×</span></button>
          <button type="button" className="chip" disabled>Disabled</button>
          <span className="chip">{FILE}</span>
        </div>
        <Row label="segmented">
          <div className="segmented" role="group" aria-label="View"><button type="button" aria-pressed="true" data-gallery="seg-pressed">List</button><button type="button" aria-pressed="false">Board</button></div>
          <Toggle pressed aria-label="Bold" data-gallery="toggle-pressed">B</Toggle>
          <Toggle aria-label="Italic">I</Toggle>
        </Row>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs id="gallery-tabs" value={tab} onChange={setTab} tabs={[{ id: "invoices", label: "Invoices" }, { id: "payments", label: "Payments" }, { id: "files", label: "Files" }]} />
        <TabPanel id="gallery-tabs" tab={tab}>
          <p className="text-sm">{tab === "files" ? FILE : `${PEOPLE[1]} · INV-2026-00419`}</p>
        </TabPanel>
      </Section>

      <Section id="overlays" title="Dialog and menu">
        <Row label="openers">
          <Button onClick={() => setOpen(true)}>Open dialog</Button>
          <Menu label="Actions">
            {(close) => (
              <>
                <MenuItem onSelect={close}>Duplicate</MenuItem>
                <MenuItem danger onSelect={close}>Delete</MenuItem>
              </>
            )}
          </Menu>
        </Row>
        <Dialog open={open} onClose={() => setOpen(false)} title="Approve INV-2026-00418?" footer={<Button variant="primary" onClick={() => setOpen(false)}>Approve</Button>}>
          <p>{PEOPLE[3]} will be notified once it is approved.</p>
        </Dialog>
      </Section>

      <Section id="toast" title="Toast and confirm">
        <Row label="raise">
          <Button onClick={() => toast("Invoice INV-2026-00418 approved")}>Show toast</Button>
          <Button onClick={() => toast("The server did not answer in time.", "error")}>Show error toast</Button>
          <Button variant="danger" onClick={() => void confirmDialog({ title: "Delete INV-2026-00418?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true })}>Confirm…</Button>
        </Row>
        <Toaster />
        <ConfirmHost />
      </Section>

      <Section id="anatomy" title="Page anatomy">
        <div data-gallery="anatomy" className="rounded-lg border border-dashed border-border p-4">
          <div className="crumbs">Sales Orders</div>
          <div className="page-head">
            <div>
              <h1 className="page-title">SO-2026-00018</h1>
              <p className="page-sub">Acme Traders · 3 lines</p>
            </div>
            <div className="page-actions">
              <Button>Save</Button>
              <Button variant="primary">Submit</Button>
            </div>
          </div>
          <div className="card card-pad">The content starts one gap (16px) under the header.</div>
        </div>
      </Section>

      <Section id="alerts" title="Alerts">
        {(["info", "success", "warning", "error"] as const).map((tone) => (
          <Alert key={tone} tone={tone} action={<Button size="sm">Details</Button>}>
            {tone}: payment run of 18 invoices for {PEOPLE[4]}
          </Alert>
        ))}
      </Section>

      <Section id="states" title="StatePanel">
        <div className="grid gap-4 md:grid-cols-2">
          {KINDS.map((kind) => (
            <div key={kind} data-gallery={`state-${kind}`} className="rounded-lg border border-border">
              <StatePanel
                kind={kind}
                error={kind === "failed" ? new Error("The server did not answer in time.") : undefined}
                onRetry={kind === "failed" ? () => {} : undefined}
                onClear={kind === "no-matches" ? () => {} : undefined}
                action={kind === "empty" ? <Button variant="primary" icon="plus">New invoice</Button> : undefined}
              >
                {kind === "offline" ? "Your changes are kept on this device until you are back online." : kind === "empty" ? "Invoices you create appear here." : kind === "no-matches" ? "Nothing matches “INV-2025” in Paid." : undefined}
              </StatePanel>
            </div>
          ))}
        </div>
      </Section>

      <Section id="skeletons" title="Skeletons">
        <div className="grid gap-4 md:grid-cols-2">
          <div data-gallery="skeleton-list" className="rounded-lg border border-border"><ListSkeleton rows={4} /></div>
          <div data-gallery="skeleton-table" className="rounded-lg border border-border"><TableSkeleton columns={4} rows={4} /></div>
          <div data-gallery="skeleton-form" className="rounded-lg border border-border p-4"><FormSkeleton fields={3} /></div>
          <div data-gallery="skeleton-reader" className="rounded-lg border border-border"><ReaderSkeleton /></div>
          <div data-gallery="skeleton-page" className="rounded-lg border border-border p-4"><PageLoading /></div>
        </div>
      </Section>

      <Section id="save" title="SaveStatus">
        {SAVES.map((state) => (
          <Row key={state} label={state}>
            <SaveStatus state={state} at={state === "saved" || state === "local" ? AT : undefined} />
          </Row>
        ))}
      </Section>

      <Section id="selection" title="SelectionToolbar">
        <div data-gallery="selection-shown" className="relative">
          <SelectionToolbar label="Actions for the 3 invoices selected" count={3} onClear={() => {}} extend={<Button size="sm" variant="ghost">Select all 25 shown</Button>}>
            <Button size="sm">Assign</Button>
            <Button size="sm" variant="danger" icon="trash">Delete</Button>
          </SelectionToolbar>
        </div>
        <div data-gallery="selection-matching" className="relative">
          <SelectionToolbar label="Actions for the 240 invoices selected" count={240} scope="matching" of={240} onClear={() => {}}>
            <Button size="sm">Assign</Button>
          </SelectionToolbar>
        </div>
        <div data-gallery="selection-capped" className="relative">
          <SelectionToolbar label="Actions for the 500 invoices selected" count={500} scope="matching" of={1200} onClear={() => {}}>
            <Button size="sm">Assign</Button>
          </SelectionToolbar>
        </div>
      </Section>
    </>
  );
}

export function Gallery() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24">
      <Controls />
      <h1 className="py-4 text-2xl font-semibold">Ferrum gallery</h1>
      <Sections />
    </div>
  );
}
