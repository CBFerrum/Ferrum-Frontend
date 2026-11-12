// The catalogue: every token, primitive and pattern in one page, in labelled sections with stable ids
// (`#g-…`, `data-gallery`) for screenshot scripts. The controls at the top set <html> data-theme,
// data-density, data-contrast and dir. Content is synthetic. Words here are not t()-ed: a dev page.

import { useEffect, useRef, useState } from "react";
import { Badge as ShBadge } from "@/components/ui/badge";
import { Button as ShButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { SwatchPalette, rememberColor, type Swatch } from "@/ui/swatches";
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from "@/ui/toolbar";
import { RichText, RichTextEditor, type MergeField } from "@/ui/richtext";
import { FieldControl } from "@/app/widgets";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, ItalicIcon, LinkIcon, ListIcon, ListOrderedIcon, Redo2Icon, StrikethroughIcon, UnderlineIcon, Undo2Icon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toggle } from "@/components/ui/toggle";
import { Textarea } from "@/components/ui/textarea";
import { EmptyRun } from "@/app/EmptyRun";
import { Alert, announce, Badge, Button, confirmDialog, ConfirmHost, Dialog, Field, Menu, MenuItem, PageLoading, TabPanel, Tabs, toast, Toaster, useToastPlacement, type Tone, type ToastPlacement } from "@/ui/kit";
import { MemoryRouter } from "react-router";
import { PageHeader as PageHead } from "@/app/studio/dashboard/ui";
import { ButtonLink, FormSkeleton, HomeSection, HomeSkeleton, ListSkeleton, PageSplit, PageStack, Progress, Queue, QueueGrid, QueueItem, Stat, StatGrid, ReaderSkeleton, SaveStatus, SelectionToolbar, StatePanel, TableSkeleton, Tile, TileGrid, type SaveState, type StateKind } from "@/ui/patterns";

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

const contract = (i: number, title: string, who: string, due: string, status: string, tone?: Tone) => (
  <QueueItem key={i} to={`/c/${i}`} title={title} meta={`${who} · ${due}`} trailing={<Badge tone={tone}>{status}</Badge>} />
);

/** Work homes: a normal one, one with nothing waiting, one with something that needs attention first, and tiles. */
function WorkHomes() {
  const head = (summary?: string) => <PageHead title="Contracts" description={summary} actions={<ButtonLink to="/c/new" variant="primary" icon="plus">New contract</ButtonLink>} />;
  const frame = "rounded-lg border border-dashed border-border p-4";
  return (
    <MemoryRouter>
      <div data-gallery="home-normal" className={frame}>
        {head("2 notices due · 4 obligations open")}
        <QueueGrid>
          <Queue title="In the works" count={2} link={{ to: "/c", label: "All contracts" }}>
            {contract(1, "Cleaning services 2027", "Acme Facilities", "ends 3 Mar 2027", "In Review")}
            {contract(2, "Office lease, Pune, second floor, renewal with revised escalation clause", "Meridian Estates Pvt Ltd", "ends 30 Jun 2028", "Draft")}
          </Queue>
          <Queue title="Out for signature" count={1}>
            {contract(3, "Master services agreement", "Northwind Traders", "sent 9 Nov", "Out for Signature", "blue")}
          </Queue>
          <Queue title="Active" count={7} more={{ to: "/c", count: 2 }}>
            {contract(4, "Logistics framework", "Blue Dart", "ends 1 Apr 2027", "Active", "green")}
            {contract(5, "Software licence", "Vendor Co", "ends 12 Aug 2027", "Active", "green")}
            {contract(6, "Insurance", "Safe Mutual", "ends 2 Jan 2027", "Active", "green")}
            {contract(7, "Audit retainer", "Ledger LLP", "ends 31 Mar 2027", "Active", "green")}
            {contract(8, "Courier", "Speedy", "ends 5 Dec 2026", "Active", "green")}
          </Queue>
          <Queue title="Obligations" count={1}>
            <QueueItem to="/o/1" title="Send the quarterly usage report" meta="Due 15 Nov" trailing={<Badge tone="red">Overdue</Badge>} />
          </Queue>
        </QueueGrid>
      </div>
      <div data-gallery="home-empty" className={frame}>
        {head("Nothing needs you right now")}
        <QueueGrid>
          <Queue title="Drafts" count={0} />
          <Queue title="Sent" count={0} />
          <Queue title="Running" count={0} />
          <Queue title="Duties" count={0} empty="No obligations are open" />
        </QueueGrid>
      </div>
      <div data-gallery="home-attention" className={frame}>
        {head("1 notice due · 1 obligation overdue")}
        <QueueGrid>
          <Queue title="Notice due before renewal" count={1} tone="attention">
            {contract(9, "Cloud hosting", "Hyperscale Inc", "renews after 14 Dec", "Active", "amber")}
          </Queue>
          <Queue title="Overdue obligations" count={1} tone="attention">
            <QueueItem to="/o/1" title="Send the quarterly usage report" meta="Due 15 Nov" trailing={<Badge tone="red">Overdue</Badge>} />
          </Queue>
          <Queue title="Renewing later" count={1}>
            {contract(4, "Logistics framework", "Blue Dart", "ends 1 Apr 2027", "Active", "green")}
          </Queue>
        </QueueGrid>
      </div>
      <div data-gallery="home-tiles" className={frame}>
        <PageHead title="The floor" actions={<ButtonLink to="/t/new" icon="plus">New booking</ButtonLink>} />
        <TileGrid label="Tables">
          <Tile to="/t/1" title="Table 1" meta={<><span>4 covers</span><span>Seated 19:10</span></>} status={<Badge tone="green">Open</Badge>} />
          <Tile to="/t/2" title="Table 2" meta={<span>2 seats</span>} status={<Badge>Free</Badge>} />
          <Tile to="/t/3" title="Window table with the long name" meta={<><span>6 covers</span><span>Bill requested</span></>} status={<Badge tone="amber">Billing</Badge>} />
          <Tile title="Terrace" meta={<span>Closed today</span>} />
        </TileGrid>
      </div>
      <div data-gallery="home2-schedule" className={frame}>
        <PageStack>
          <PageHead title="Front desk" description="Today · 4 arrivals" actions={<ButtonLink href="/crm/" icon="plus">Open guest list</ButtonLink>} />
          <StatGrid>
            <Stat label="Arrivals waiting" value={4} to="/a" hint="until 18:00" />
            <Stat label="Rooms ready" value="12 of 20" to="/r" progress={{ value: 60, label: "Rooms ready" }} />
            <Stat label="Overdue checkouts" value={0} />
            <Stat label="Net book value" value="₹172,702.10" hint="3 assets" />
          </StatGrid>
          <QueueGrid>
            <Queue title="Arrivals" count={3} link={{ to: "/a", label: "All arrivals" }}>
              <QueueItem to="/g/1" lead="09:30" title="Ana Silva" meta="Room 204 · 2 nights" action={<Button size="sm">Check in</Button>} />
              <QueueItem to="/g/2" lead="11:00" title="Bea Rossi and party of six, corporate offsite booking" meta="Rooms 301 to 306 · arriving from the airport transfer, late checkout requested" trailing={<Badge tone="amber">Deposit due</Badge>} action={<Button size="sm">Check in</Button>} />
              <QueueItem lead="14:15" title="Walk-in" meta="No booking yet" action={<Button size="sm" variant="primary">Find a room</Button>} />
            </Queue>
            <Queue title="Launch the new site" count={5} progress={{ value: 62, label: "Key results done" }}>
              <QueueItem to="/k/1" lead={<span className="inline-block size-10 rounded-(--radius-sm) bg-muted" />} title="Redesign pricing page" trailing={<Badge tone="green">On track</Badge>} />
              <QueueItem to="/k/2" lead={<span className="inline-block size-10 rounded-(--radius-sm) bg-muted" />} title="Cut page weight to 1 MB" trailing={<Badge tone="amber">At risk</Badge>} />
            </Queue>
          </QueueGrid>
        </PageStack>
      </div>
      <div data-gallery="home2-single" className={frame}>
        <PageHead title="Objectives" />
        <QueueGrid>
          <Queue title="Only queue" count={1}>{contract(1, "Cleaning services 2027", "Acme Facilities", "ends 3 Mar 2027", "Active", "green")}</Queue>
        </QueueGrid>
        <div className="h-4" />
        <QueueGrid columns={1}>
          <Queue title="Single column" count={1} progress={{ value: 30 }}>{contract(2, "Rent", "Meridian", "ends 30 Jun 2028", "Active", "green")}</Queue>
        </QueueGrid>
        <div className="h-4" />
        <QueueGrid>
          <Queue title="One" count={0} />
          <Queue title="Two" count={0} />
          <Queue title="Three" count={0} />
          <Queue title="Four" count={0} />
        </QueueGrid>
      </div>
      <div data-gallery="home2-tiles" className={frame}>
        <HomeSection title="Maple Heights" count={3} link={{ to: "/p/1", label: "Open property" }}>
          <TileGrid min="md" label="Units">
            <Tile to="/u/1" title="Block A, ground floor, the unit with the long descriptive name" meta={<span>3 tenants</span>} figures={[{ label: "Worth", value: "₹1,20,000" }, { label: "Certified", value: "₹90,000" }, { label: "Held", value: "₹0" }]} progress={{ value: 75, label: "Certified" }} status={<><Badge tone="green">Let</Badge><Badge tone="amber">Notice served, leaves 1 March</Badge></>} />
            <Tile to="/u/2" title="Block B" meta={<span>Vacant</span>} figures={[{ label: "Worth", value: "₹80,000" }, { label: "Certified", value: "₹0" }]} progress={{ value: 0, label: "Certified" }} status={<Badge>Free</Badge>} />
            <Tile title="Block C" meta={<span>Under repair</span>} progress={{ value: 4, max: 8, label: "Repairs done", }} status={<Badge tone="red">Closed</Badge>} />
          </TileGrid>
        </HomeSection>
        <div className="h-4" />
        <HomeSection title="What posts did" actions={<><Button size="sm">This week</Button><Button size="sm">Export</Button></>} empty="No posts yet" />
        <div className="h-4" />
        <div className="grid max-w-sm gap-3">
          <Progress value={40} label="Plain meter" />
          <Progress value={70} label="Good" tone="good" />
          <Progress value={90} label="Attention" tone="attention" />
          <Progress value={100} label="Danger" tone="danger" />
        </div>
      </div>
      <div data-gallery="home2-file" className={frame}>
        <div className="grid max-w-md gap-4">
          <Field label="Attachment" htmlFor="g-file"><input id="g-file" type="file" className="input" /></Field>
          <Field label="Disabled" htmlFor="g-file2"><input id="g-file2" type="file" className="input" disabled /></Field>
        </div>
      </div>
      <div data-gallery="home3" className={frame}>
        <PageStack>
          <PageHead title="Intranet" actions={<><ButtonLink href="/data.csv" download="data.csv" size="sm" icon="plus">Download data</ButtonLink><ButtonLink href="https://example.test" target="_blank" size="sm">External</ButtonLink></>} />
          <StatGrid min="lg">
            <Stat label="Total invoiced" value="₹1,676,650.75" hint="this year" progress={{ value: 80, label: "Collected", tone: "good" }} />
            <Stat label="Overdue" value="₹12,00,000.00" tone="danger" progress={{ value: 30, label: "Overdue share", tone: "danger" }} />
          </StatGrid>
          <PageSplit
            main={
              <Queue title="Feed" count={2}>
                <QueueItem to="/f/1" title="Quarter close checklist" meta={<span className="num">12 comments · updated 3 Mar, 4:40 pm by the finance team</span>} trailing={<span className="num">₹4,200.00</span>} />
                <QueueItem to="/f/2" title="Office move" meta="Facilities · Friday" trailing={<span className="num">18</span>} />
              </Queue>
            }
            aside={
              <Queue title="Spaces" count={2}>
                <QueueItem to="/s/1" title="Finance" />
                <QueueItem to="/s/2" title="Facilities" />
              </Queue>
            }
          />
          <div data-gallery="touch" className="flex flex-wrap items-center gap-4">
            <div className="segmented" role="group" aria-label="View"><button type="button" aria-pressed="true">List</button><button type="button" aria-pressed="false">Board</button></div>
            <Checkbox aria-label="Done" />
            <Switch aria-label="On" />
            <ShButton size="xs">Extra small</ShButton>
          </div>
        </PageStack>
      </div>
      <div data-gallery="home-loading" className={frame}>
        <HomeSkeleton queues={3} />
      </div>
    </MemoryRouter>
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

      <Section id="menus" title="Menus, pop-ups and dialogs">
        <MenusAndPopups />
      </Section>

      <Section id="toolbar" title="Toolbar and swatch palette">
        <ToolbarExamples />
      </Section>

      <Section id="rich-text" title="Rich text">
        <RichTextExamples />
      </Section>

      <Section id="toast" title="Toast and confirm">
        <Row label="raise">
          <Button onClick={() => toast("Invoice INV-2026-00418 approved")}>Show toast</Button>
          <Button onClick={() => toast("The server did not answer in time.", "error")}>Show error toast</Button>
          <Button onClick={() => toast("3 conversations moved to Trash", "success", { action: { label: "Undo", onSelect: () => toast("Moved back to Inbox") } })}>Show toast with Undo</Button>
          <Button onClick={() => announce("3 conversations moved to Trash")}>Announce only</Button>
          <Button variant="danger" onClick={() => void confirmDialog({ title: "Delete INV-2026-00418?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true })}>Confirm…</Button>
        </Row>
        <PlacementDemo />
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

      <Section id="work-home" title="Work home">
        <WorkHomes />
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
        <div data-gallery="selection-folding" className="relative">
          <SelectionToolbar
            label="Actions for the 4 invoices selected"
            count={4}
            onClear={() => {}}
            actions={[
              { id: "archive", label: "Archive", icon: "file", onSelect: () => {} },
              { id: "assign", label: "Assign to…", icon: "user", onSelect: () => {} },
              { id: "export", label: "Export", icon: "download", onSelect: () => {} },
              { id: "print", label: "Print", icon: "printer", onSelect: () => {} },
              { id: "share", label: "Share by link", icon: "external", onSelect: () => {} },
              { id: "delete", label: "Delete", icon: "trash", danger: true, priority: true, onSelect: () => {} },
            ]}
          />
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

/** Every shadcn/Radix overlay the kit owns, each with a trigger of its own, and the combinations that went wrong: a menu in a dialog, a pop-up in a sheet, a confirm over a dialog. */
function PlacementDemo() {
  const [at, setAt] = useState<ToastPlacement | null>(null);
  return (
    <div data-gallery="toast-placement" className="flex flex-col gap-3">
      <Row label="placement">
        {(["bottom-start", "top-end"] as const).map((p) => (
          <Button key={p} onClick={() => setAt(at === p ? null : p)}>{at === p ? `Stop asking for ${p}` : `Ask for ${p}`}</Button>
        ))}
        <span className="text-sm text-muted-foreground">Phones keep notices at the top.</span>
      </Row>
      {at && <ComposeStack placement={at} />}
    </div>
  );
}

const HUES = [0, 30, 55, 140, 175, 200, 230, 255, 285, 330];
// Swatches are data a caller owns (a document's colours), not tokens: ten hues in three shades, from the hue angle.
// ui-lint-allow colour: a palette's swatches are the caller's data
const SWATCHES: Swatch[] = [90, 70, 45].flatMap((l, s) => HUES.map((h, i) => ({ color: `hsl(${h} ${s === 0 ? 60 : 75}% ${l}%)`, label: `Hue ${i + 1}, shade ${s + 1}` })));

function ToolbarExamples() {
  const [on, setOn] = useState<Record<string, boolean>>({ bold: true });
  const flip = (k: string) => () => setOn({ ...on, [k]: !on[k] });
  const [colour, setColour] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const bar = (
    <Toolbar label="Formatting">
      <ToolbarGroup id="history">
        <ToolbarButton label="Undo" shortcut="Mod-z" icon={<Undo2Icon />} onPress={() => {}} />
        <ToolbarButton label="Redo" shortcut="Mod-Shift-z" icon={<Redo2Icon />} disabled onPress={() => {}} />
      </ToolbarGroup>
      <ToolbarGroup id="marks" keep>
        <ToolbarButton label="Bold" shortcut="Mod-b" icon={<BoldIcon />} pressed={!!on.bold} onPress={flip("bold")} />
        <ToolbarButton label="Italic" shortcut="Mod-i" icon={<ItalicIcon />} pressed={!!on.italic} onPress={flip("italic")} />
        <ToolbarButton label="Underline" shortcut="Mod-u" icon={<UnderlineIcon />} pressed={!!on.underline} onPress={flip("underline")} />
        <ToolbarButton label="Strikethrough" icon={<StrikethroughIcon />} pressed={!!on.strike} onPress={flip("strike")} />
      </ToolbarGroup>
      <ToolbarGroup id="align">
        <ToolbarButton label="Align left" icon={<AlignLeftIcon />} pressed onPress={() => {}} />
        <ToolbarButton label="Align centre" icon={<AlignCenterIcon />} onPress={() => {}} />
        <ToolbarButton label="Align right" icon={<AlignRightIcon />} onPress={() => {}} />
      </ToolbarGroup>
      <ToolbarGroup id="lists">
        <ToolbarButton label="Bullet list" icon={<ListIcon />} onPress={() => {}} />
        <ToolbarButton label="Numbered list" icon={<ListOrderedIcon />} onPress={() => {}} />
        <ToolbarSeparator />
        <ToolbarButton label="Link" shortcut="Mod-k" icon={<LinkIcon />} onPress={() => {}} />
      </ToolbarGroup>
    </Toolbar>
  );
  return (
    <div data-gallery="toolbar" className="flex flex-col gap-4">
      {[720, 420, 260].map((w) => (
        <div key={w} data-gallery={`toolbar-${w}`} className="rounded-lg border border-border bg-surface" style={{ width: w, maxWidth: "100%" }}>
          {bar}
        </div>
      ))}
      <div data-gallery="swatch-palette" className="w-fit rounded-lg border border-border bg-popover p-3">
        <SwatchPalette label="Text colour" swatches={SWATCHES} value={colour} noneLabel="Automatic" recent={recent} onChange={(c) => { setColour(c); if (c) setRecent(rememberColor(recent, c)); }} />
      </div>
    </div>
  );
}

/** A page that occupies the bottom end (a compose window) asks the toaster to move for as long as it is mounted. */
function ComposeStack({ placement }: { placement: ToastPlacement }) {
  useToastPlacement(placement);
  return <div data-gallery="compose-stack" className="rounded-md border border-border bg-surface px-3 py-2 text-sm">Compose window (asks for {placement})</div>;
}

function MenusAndPopups() {
  const [dlg, setDlg] = useState(false);
  const [dlg2, setDlg2] = useState(false);
  const [share, setShare] = useState(false);
  const many = Array.from({ length: 40 }, (_, i) => `Action ${i + 1}`);
  const menu = (label: string, long = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ShButton variant="outline" size="sm">{label}</ShButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(long ? many : ["Open", "Rename", "Move to…"]).map((m) => (
          <DropdownMenuItem key={m}>{m}</DropdownMenuItem>
        ))}
        {!long && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>By link</DropdownMenuItem>
              <DropdownMenuItem>With a person</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const pop = (label: string) => (
    <Popover>
      <PopoverTrigger asChild>
        <ShButton variant="outline" size="sm">{label}</ShButton>
      </PopoverTrigger>
      <PopoverContent aria-label="Date range">Pick a date range.</PopoverContent>
    </Popover>
  );
  return (
    <div data-gallery="menus" className="flex flex-col gap-3">
      <Row label="menu">{menu("Dropdown menu")}{menu("Long menu", true)}</Row>
      <Row label="popover">{pop("Popover")}</Row>
      <Row label="select">
        <Select>
          <SelectTrigger className="w-40" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="tooltip, card">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild><ShButton variant="outline" size="sm">Tooltip</ShButton></TooltipTrigger>
            <TooltipContent>Bold (Ctrl+B)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <HoverCard openDelay={0}>
          <HoverCardTrigger asChild><ShButton variant="outline" size="sm">Hover card</ShButton></HoverCardTrigger>
          <HoverCardContent>{PEOPLE[0]}, Finance</HoverCardContent>
        </HoverCard>
        <ContextMenu>
          <ContextMenuTrigger className="rounded-md border border-dashed border-border px-3 py-1 text-sm">Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Copy</ContextMenuItem>
            <ContextMenuItem>Paste</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Row>
      <Row label="kit Menu at the edges">
        <div data-gallery="menu-edges" className="flex w-full justify-between gap-2">
          <Menu label="Start edge" align="end">{(close) => ["Open", "Rename", "Move to…"].map((m) => <MenuItem key={m} onSelect={close}>{m}</MenuItem>)}</Menu>
          <Menu label="Long list" align="start">{(close) => many.map((m) => <MenuItem key={m} onSelect={close}>{m}</MenuItem>)}</Menu>
          <Menu label="End edge" align="start">{(close) => ["Open", "Rename", "Move to…"].map((m) => <MenuItem key={m} onSelect={close}>{m}</MenuItem>)}</Menu>
        </div>
      </Row>
      <Row label="in a sheet">
        <Sheet>
          <SheetTrigger asChild><ShButton variant="outline" size="sm">Open sheet</ShButton></SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>A pop-up opened from a sheet.</SheetDescription>
            </SheetHeader>
            <div className="flex gap-2 p-4">{menu("Menu in a sheet")}{pop("Popover in a sheet")}<Button variant="danger" onClick={() => void confirmDialog({ title: "Clear the filters?", confirmLabel: "Clear", danger: true })}>Confirm in a sheet</Button></div>
          </SheetContent>
        </Sheet>
      </Row>
      <Row label="dialog from a menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><ShButton variant="outline" size="sm">Row menu</ShButton></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setShare(true)}>Share…</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
        <Menu label="Kit row menu">{(close) => <MenuItem onSelect={() => { close(); setShare(true); }}>Share…</MenuItem>}</Menu>
      </Row>
      <Dialog open={share} onClose={() => setShare(false)} title="Share “Contracts”"><p>Dialog opened from a menu item.</p></Dialog>
      <Row label="in a dialog">
        <Button onClick={() => setDlg(true)}>Dialog with a menu</Button>
        <Button onClick={() => setDlg2(true)}>Confirm over a dialog</Button>
      </Row>
      <Dialog open={dlg} onClose={() => setDlg(false)} title="Move INV-2026-00418">
        <div className="flex gap-2">{menu("Menu in a dialog")}{pop("Popover in a dialog")}<Menu label="Kit menu in a dialog">{(close) => ["Open", "Rename", "Move to…"].map((m) => <MenuItem key={m} onSelect={close}>{m}</MenuItem>)}</Menu></div>
      </Dialog>
      <Dialog open={dlg2} onClose={() => setDlg2(false)} title="Edit INV-2026-00418" footer={<Button onClick={() => setDlg2(false)}>Close</Button>}>
        <Button variant="danger" data-gallery="confirm-opener" onClick={() => void confirmDialog({ title: "Discard the changes?", message: "Your edits to INV-2026-00418 are lost.", confirmLabel: "Discard", danger: true })}>Discard changes…</Button>
      </Dialog>
    </div>
  );
}

export function Gallery() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24">
      <Controls />
      <h1 className="py-4 text-2xl font-semibold">Ferrum gallery</h1>
      <Sections />
    </main>
  );
}

// ui-lint-allow raw-color: a highlight colour inside sample content, which is the content's own
const LETTER = `<h2>Delivery schedule for November</h2><p>Dear ${PEOPLE[0]},</p><p>Thank you for order <strong>SO-2026-00418</strong>. The goods leave our <em>Pune</em> warehouse on <mark data-color="#fff475" style="background-color: #fff475; color: inherit">Thursday 19 November</mark>; please check:</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>the delivery address</p></li><li data-type="taskItem" data-checked="false"><p>who signs for the goods</p></li></ul><table><tbody><tr><th><p>Item</p></th><th><p>Quantity</p></th></tr><tr><td><p>Field tablet 10"</p></td><td><p>24</p></td></tr></tbody></table><blockquote><p>Payment within 30 days of the invoice.</p></blockquote><p>See <a href="https://example.com/terms">our terms</a>.</p>`;
const MESSAGE = `<p>Hello {{ customer_name }},</p><p>Please find invoice <strong>{{ number }}</strong> attached, due on {{ due_date }}.</p><ol><li><p>Pay by bank transfer, or</p></li><li><p>reply to this e-mail with any question.</p></li></ol><p>Kind regards</p>`;
const FIELDS: MergeField[] = [
  { name: "customer_name", label: "Customer name" },
  { name: "number", label: "Invoice number" },
  { name: "due_date", label: "Due date" },
  { name: "grand_total", label: "Grand total" },
];
const ARABIC = "<p>مرحبًا فاطمة،</p><p>نرسل إليك الفاتورة <strong>INV-2026-00418</strong> المستحقة في ٣٠ نوفمبر.</p><ul><li><p>الدفع بالتحويل المصرفي</p></li><li><p>أو الرد على هذه الرسالة</p></li></ul>";

function RichTextExamples() {
  const [full, setFull] = useState(LETTER);
  const [compact, setCompact] = useState(MESSAGE);
  const [minimal, setMinimal] = useState("<p>Looks good to me. <strong>Ship it</strong> after the review.</p>");
  const [bad, setBad] = useState("");
  const [rtl, setRtl] = useState(ARABIC);
  const [scope, setScope] = useState("<p>Install <strong>24 field tablets</strong> at the Pune site:</p><ul><li><p>mount and power each unit</p></li><li><p>pair it with the site gateway</p></li></ul>");
  const block = (id: string, label: string, editor: React.ReactNode) => (
    <div data-rte={id} className="flex max-w-3xl flex-col gap-1.5">
      <span id={`rte-${id}`} className="field-label">
        {label}
      </span>
      {editor}
    </div>
  );
  return (
    <div className="flex flex-col gap-8">
      {block("full", "Letter (full)", <RichTextEditor toolbar="full" fonts value={full} onChange={setFull} labelledBy="rte-full" wordCount status="Saved" images="inline" />)}
      {block("compact", "Message with merge fields (compact)", <RichTextEditor toolbar="compact" value={compact} onChange={setCompact} labelledBy="rte-compact" mergeFields={FIELDS} placeholder="Write a message…" />)}
      {block("minimal", "Comment (minimal)", <RichTextEditor toolbar="minimal" value={minimal} onChange={setMinimal} labelledBy="rte-minimal" placeholder="Add a comment…" maxLength={500} />)}
      {block("invalid", "Description (invalid)", <RichTextEditor toolbar="compact" id="rte-invalid-ed" value={bad} onChange={setBad} labelledBy="rte-invalid" placeholder="Describe the fault…" invalid="Describe the fault before you send it." />)}
      {block("disabled", "Disabled", <RichTextEditor toolbar="compact" value={MESSAGE} labelledBy="rte-disabled" mergeFields={FIELDS} disabled />)}
      {block("rtl", "Right to left (Arabic)", <RichTextEditor toolbar="compact" value={rtl} onChange={setRtl} labelledBy="rte-rtl" />)}
      <div data-rte="field" className="flex max-w-3xl flex-col gap-4">
        <span className="text-sm text-muted-foreground">A record field declared <code>widget: rich_text</code> (widgets.tsx), editable and read-only</span>
        <Field label="Scope of work" htmlFor="g-rich-field">
          <FieldControl field={{ name: "scope", label: "Scope of work", type: "text", widget: "rich_text" } as never} id="g-rich-field" value={scope} onChange={(v) => setScope(String(v ?? ""))} />
        </Field>
        <Field label="Scope of work (submitted)" htmlFor="g-rich-field-ro">
          <FieldControl field={{ name: "scope", label: "Scope of work (submitted)", type: "text", widget: "rich_text" } as never} id="g-rich-field-ro" value={scope} disabled onChange={() => {}} />
        </Field>
      </div>
      <div data-rte="read" className="flex max-w-3xl flex-col gap-1.5">
        <span className="field-label">Read-only (RichText)</span>
        <RichText html={MESSAGE} mergeFields={FIELDS} />
      </div>
    </div>
  );
}
