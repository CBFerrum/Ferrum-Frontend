// The number card builder: one measure (count, sum, average, minimum, maximum) over a period,
// its format (whole number, decimal, money, percent), the change since the previous period, a
// trend line, an accent colour and the records behind it, with a live preview from the server.
// Opens as a page (/studio/cards/:id) or inside a dashboard's editor (`NumberCardBuilder`).

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Copy, Ellipsis, ListTree, Trash2 } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { formatDecimal } from "@/lib/format";
import { useEntityMeta } from "@/lib/meta";
import { cn } from "@/lib/utils";
import {
  BUCKET_LABEL,
  emptyDraft,
  fieldIssues,
  isSafeColor,
  issuesAt,
  studio,
  useCardPreview,
  useDeleteStudioRecord,
  useStudioFields,
  useStudioRecord,
  type Bucket,
  type CardFormat,
  type CardRecord,
  type SpecDraft,
} from "@/lib/studio";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast, useDebounced } from "@/ui/kit";
import { LinkInput } from "../widgets";
import type { BuilderContext } from "./ChartBuilder";
import { BuilderToolbar, ConflictNotice, duplicateOf, specPart, StandardNotice, useBuilder } from "./dashboard/builder";
import { DrillDownSheet } from "./dashboard/DrillDownSheet";
import type { DrillTarget } from "./dashboard/drill";
import { NumberCardView } from "./dashboard/NumberCardView";
import { EntityPicker } from "./dashboard/pickers";
import { asRecordIssue, blankCard, cardDraft, cardIssuesLocal, cardRecord } from "./dashboard/records";
import { QueryEditor } from "./dashboard/QueryEditor";
import { AcceptsEditor, LabelFields, SharingFields } from "./dashboard/RecordFields";
import { ErrorBlock, goBack, LoadingBlock, Messages, PageHeader, Section, SheetState, UnsavedGuard, useConfirm } from "./dashboard/ui";
import { t, isolate } from "@ferrum/client";

const NO_CONTEXT: BuilderContext = { filterDefs: [], values: {} };
const FORMATS: { value: CardFormat; label: string }[] = [
  { value: "int", get label() { return t("Whole number"); } },
  { value: "decimal", get label() { return t("Decimal"); } },
  { value: "currency", get label() { return t("Money"); } },
  { value: "percent", get label() { return t("Percent"); } },
];
const SPARK: Bucket[] = ["day", "week", "month", "quarter", "year", "fiscal_quarter", "fiscal_year"];
const NONE = "__none";

const toDraft = cardDraft;
const toRecord = cardRecord;

export function NumberCardBuilderPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const existing = useStudioRecord("cards", isNew ? undefined : id);
  if (!isNew && existing.error) return <ErrorBlock error={existing.error} onRetry={() => existing.refetch()} title={t("Could not open this number card")} />;
  if (!isNew && !existing.data) return <LoadingBlock rows={4} />;
  return (
    <CardEditor
      key={id ?? "new"}
      initial={isNew ? blankCard(sp) : existing.data!}
      context={NO_CONTEXT}
      onSaved={(saved, created) => created && navigate(`/studio/cards/${saved.id}`, { replace: true })}
      onClose={() => goBack(navigate, "/studio/dashboards?tab=cards")}
    />
  );
}

/** The builder inside a dashboard's editor: a card by id, or a new one; `onSaved` gets the saved record. */
export function NumberCardBuilder({
  id,
  context,
  onSaved,
  onClose,
  cancelRef,
}: {
  id?: string;
  context: BuilderContext;
  onSaved: (r: CardRecord) => void;
  onClose: () => void;
  /** Set to the builder's cancel (it asks before discarding changes), for the sheet's Escape key. */
  cancelRef?: { current: (() => void) | null };
}) {
  const existing = useStudioRecord("cards", id);
  if (id && !existing.data) {
    if (cancelRef) cancelRef.current = onClose;
    return (
      <SheetState title={t("Number card")} onClose={onClose}>
        {existing.error ? <ErrorBlock error={existing.error} onRetry={() => existing.refetch()} title={t("Could not open this number card")} /> : <LoadingBlock rows={4} />}
      </SheetState>
    );
  }
  return <CardEditor key={id ?? "new"} initial={id ? existing.data! : blankCard()} context={context} embedded cancelRef={cancelRef} onSaved={(r) => onSaved(r)} onClose={onClose} />;
}

function CardEditor({
  initial,
  context,
  embedded = false,
  cancelRef,
  onSaved,
  onClose,
}: {
  initial: CardRecord;
  context: BuilderContext;
  embedded?: boolean;
  cancelRef?: { current: (() => void) | null };
  onSaved: (r: CardRecord, created: boolean) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const leave = useRef(() => {});
  const b = useBuilder({
    kind: "cards",
    initial,
    toDraft,
    toRecord,
    onSaved: (r, created) => {
      if (created) leave.current();
      onSaved(r, created);
    },
    noun: t("number card"),
  });
  const { rec, query } = b.draft;
  const allowLeave = () => leave.current();
  const { confirm, dialog } = useConfirm();
  const remove = useDeleteStudioRecord("cards");
  const [tab, setTab] = useState("data");
  const [showIssues, setShowIssues] = useState(false);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const setRec = (patch: Partial<CardRecord>, key?: string) => b.set((d) => ({ ...d, rec: { ...d.rec, ...patch } }), key);
  const setQuery = (q: SpecDraft, key?: string) => b.set((d) => ({ ...d, query: q }), key);
  const catalog = useStudioFields(query.entity || undefined);
  const entityMeta = useEntityMeta(query.entity || undefined);

  const local = cardIssuesLocal(b.draft, catalog.data);
  const record = b.record;
  const reqKey = local.length ? "" : JSON.stringify({ record: { ...record, label: record.label || t("Preview") }, filter_defs: context.filterDefs, values: context.values });
  const debouncedKey = useDebounced(reqKey, 400);
  const req = useMemo(() => (debouncedKey ? JSON.parse(debouncedKey) : undefined), [debouncedKey]);
  const preview = useCardPreview(req);
  const missingLabel = rec.label.trim() ? [] : [{ path: "label", message: t("Give the number card a title") }];
  const issues = [...b.serverIssues, ...fieldIssues(preview.error).map(asRecordIssue), ...(showIssues ? [...local, ...missingLabel] : [])];
  const ranged = !!(query.period?.from && query.period.to);

  const doSave = async () => {
    const missing = [...missingLabel, ...local];
    if (missing.length) {
      setShowIssues(true);
      if (missingLabel.length) document.getElementById("card-label")?.focus();
      else setTab("data");
      toast(missing[0].message, "error");
      return;
    }
    await b.save();
  };
  const cancel = async () => {
    if (b.dirty && !b.standard && !(await confirm({ title: t("Discard your changes?"), message: t("The number card keeps its last saved settings."), confirmLabel: t("Discard"), danger: true }))) return;
    allowLeave();
    onClose();
  };
  if (cancelRef) cancelRef.current = () => void cancel();
  const duplicate = async () => {
    try {
      const copy = await studio.save("cards", duplicateOf(toRecord(b.draft)));
      toast(t("Copy made"));
      if (embedded) onSaved(copy, true);
      else navigate(`/studio/cards/${copy.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const del = async () => {
    if (!b.base.id) return;
    const ok = await confirm({ title: t("Delete “{label}”?", { label: b.base.label }), message: t("The number card is removed for everyone. Dashboards that show it must drop it first."), confirmLabel: t("Delete"), danger: true });
    if (!ok) return;
    try {
      await remove.mutateAsync({ id: b.base.id, version: b.base.version });
      toast(t("Number card deleted"));
      allowLeave();
      navigate("/studio/dashboards?tab=cards");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const toolbar = (
    <BuilderToolbar
      {...b}
      onSave={() => void doSave()}
      onCancel={() => void cancel()}
      cancelLabel={embedded || b.dirty ? t("Cancel") : t("Back")}
      saveLabel={embedded && !b.base.id ? t("Save and add") : t("Save")}
      extra={
        b.base.id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t("More actions")}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void duplicate()}>
                <Copy /> {t("Make a copy")}
              </DropdownMenuItem>
              {!embedded && !b.standard && (
                <DropdownMenuItem variant="destructive" onSelect={() => void del()}>
                  <Trash2 /> {t("Delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    />
  );

  const data = preview.data;
  const previewPane = (
    <section aria-label={t("Preview")} className="grid gap-3 lg:sticky lg:top-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-medium">{t("Preview")}</h2>
        {preview.isFetching && <Spinner className="text-muted-foreground" aria-label={t("Updating the preview")} />}
      </div>
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]" aria-live="polite">
        {/* The card at two dashboard sizes: a quarter and half of the grid's width. */}
        {(["h-36 max-w-72", "h-40 max-w-md"] as const).map((size, n) => (
          <div key={n} className={cn("flex w-full flex-col rounded-xl border bg-card p-3 shadow-sm", size, n === 1 && "hidden sm:flex")} style={isSafeColor(rec.color) ? { borderTop: `3px solid ${rec.color}` } : undefined}>
            <p className="truncate text-sm font-medium">{rec.label || t("Untitled")}</p>
            <div className="min-h-0 flex-1 pt-1">
              {local.length ? (
                <p className="text-xs text-muted-foreground">{isolate(local[0].message)}</p>
              ) : preview.error && !data ? (
                <p className="text-xs text-destructive" role="alert">
                  {isolate(errorMessage(preview.error))}
                </p>
              ) : !data ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <NumberCardView data={{ ...data, card: { ...data.card, color: rec.color ?? null } }} title={rec.label || t("Preview")} onDrill={() => setDrill({ ...data.drill_down, title: rec.label || t("Records") })} />
              )}
            </div>
          </div>
        ))}
      </div>
      {data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border p-3 text-xs">
          <dt className="text-muted-foreground">{t("Exact value")}</dt>
          <dd className="font-mono tabular-nums">{data.value == null ? "—" : String(data.value)}</dd>
          {data.previous !== undefined && (
            <>
              <dt className="text-muted-foreground">{t("Previous")}</dt>
              <dd className="font-mono tabular-nums">{data.previous == null ? "—" : String(data.previous)}</dd>
              <dt className="text-muted-foreground">{t("Change")}</dt>
              <dd className="font-mono tabular-nums">
                {data.delta ?? "—"}
                {data.delta_percent != null ? ` (${formatDecimal(data.delta_percent)}%)` : ""}
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">{t("Query")}</dt>
          <dd>{t("{value} ms", { value: formatDecimal(data.meta.sql_ms) })}</dd>
          <dd className="col-span-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setDrill({ ...data.drill_down, title: rec.label || t("Records") })}>
              <ListTree /> {t("View the records")}
            </Button>
          </dd>
        </dl>
      )}
      {!!preview.error && !!data && <p className="text-xs text-destructive">{isolate(errorMessage(preview.error, false))}</p>}
    </section>
  );

  return (
    <div className={cn(embedded && "flex h-full min-h-0 flex-col")}>
      {dialog}
      {!embedded && <UnsavedGuard dirty={b.dirty && !b.standard} allowRef={leave} />}
      <DrillDownSheet target={drill} onClose={() => setDrill(null)} />
      <div className={cn(embedded && "border-b p-4 pe-12")}>
        <PageHeader
          eyebrow={
            embedded ? undefined : (
              <Link to="/studio/dashboards?tab=cards" className="text-muted-foreground">
                {t("Number cards")}
              </Link>
            )
          }
          title={rec.label || (b.base.id ? t("Untitled number card") : t("New number card"))}
          description={b.dirty && !b.standard ? t("Unsaved changes") : undefined}
          actions={toolbar}
        />
      </div>
      <div className={cn(embedded && "min-h-0 flex-1 overflow-auto p-4")}>
        {b.standard && <StandardNotice noun={t("number card")} onDuplicate={() => void duplicate()} />}
        {b.conflict && <ConflictNotice conflict={b.conflict} noun={t("number card")} onDismiss={b.dismissConflict} />}
        <div className="grid gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] lg:items-start">
          <div className={cn("order-2 grid gap-4 lg:order-1", b.standard && "pointer-events-none opacity-60")} inert={b.standard || undefined}>
            <LabelFields value={rec} onChange={setRec} issues={issues} labelId="card-label" />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="data">{t("Data")}</TabsTrigger>
                <TabsTrigger value="display">{t("Display")}</TabsTrigger>
                <TabsTrigger value="settings">{t("Settings")}</TabsTrigger>
              </TabsList>
              <TabsContent value="data" className="grid gap-5 pt-3">
                <div className="grid gap-1.5">
                  <Label>{t("Count or add up")}</Label>
                  <EntityPicker value={query.entity || null} label={t("Count or add up")} fallbackLabel={entityMeta.data?.label} onChange={(entity) => setQuery({ ...emptyDraft(entity, "group_by"), period: null })} />
                  <Messages list={issuesAt(issues, "spec.entity")} />
                </div>
                {query.entity && <QueryEditor draft={query} onChange={setQuery} catalog={catalog.data} mode="card" issues={specPart(issues)} />}
                <Messages list={issuesAt(issues, "spec").filter((m) => !specPart(issues).some((i) => i.path && i.message === m))} />
              </TabsContent>
              <TabsContent value="display" className="grid gap-5 pt-3">
                <Section title={t("Format")}>
                  <ToggleGroup type="single" variant="outline" value={rec.format} onValueChange={(f) => f && setRec({ format: f as CardFormat })} aria-label={t("Format")} className="grid w-full grid-cols-2 sm:grid-cols-4">
                    {FORMATS.map((f) => (
                      <ToggleGroupItem key={f.value} value={f.value} className="text-xs sm:text-sm">
                        {isolate(f.label)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {rec.format !== "int" && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="card-precision" className="text-sm font-normal">
                        {t("Decimal places")}
                      </Label>
                      <Input
                        id="card-precision"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={9}
                        placeholder="2"
                        className="h-9 w-20"
                        value={rec.precision ?? ""}
                        onChange={(e) => setRec({ precision: e.target.value === "" ? null : Math.min(Math.max(Math.trunc(Number(e.target.value)) || 0, 0), 9) }, "precision")}
                      />
                    </div>
                  )}
                  {rec.format === "currency" && (
                    <div className="grid gap-1.5">
                      <Label>{t("Currency")}</Label>
                      <div className="[&_.input]:h-9">
                        <LinkInput to="Currency" value={rec.currency ?? null} label={t("Currency")} placeholder={t("The amounts' own currency")} onChange={(currency) => setRec({ currency })} />
                      </div>
                      <Messages list={issuesAt(issues, "currency")} />
                    </div>
                  )}
                  <Messages list={[...issuesAt(issues, "format"), ...issuesAt(issues, "precision")]} />
                </Section>
                <Section title={t("Trend line")} hint={ranged ? t("The same number per period, drawn under it.") : t("Needs a period with a start and an end (Data → Period).")}>
                  <Select value={rec.sparkline ?? NONE} disabled={!ranged} onValueChange={(v) => setRec({ sparkline: v === NONE ? null : (v as Bucket) })}>
                    <SelectTrigger className="h-9 w-full" aria-label={t("Trend line")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("None")}</SelectItem>
                      {SPARK.map((bk) => (
                        <SelectItem key={bk} value={bk}>
                          {t("By {value}", { value: BUCKET_LABEL[bk].toLowerCase() })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Messages list={issuesAt(issues, "sparkline")} />
                </Section>
                <Section title={t("Accent colour")} action={rec.color ? <Button type="button" variant="ghost" size="sm" onClick={() => setRec({ color: null })}>{t("Use the theme")}</Button> : undefined}>
                  <Label className="flex w-fit items-center gap-2 text-sm font-normal">
                    <input type="color" value={rec.color && /^#[0-9a-f]{6}$/i.test(rec.color) ? rec.color : "#2f5bea"} onChange={(e) => setRec({ color: e.target.value.toLowerCase() }, "color")} className="size-8 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={t("Accent colour")} />
                    {rec.color ? rec.color : t("The theme's colour")}
                  </Label>
                  <Messages list={issuesAt(issues, "color")} />
                </Section>
              </TabsContent>
              <TabsContent value="settings" className="grid gap-5 pt-3">
                <AcceptsEditor value={rec.accepts} onChange={(accepts) => setRec({ accepts })} defs={context.filterDefs} catalog={catalog.data} issues={issues} />
                <SharingFields value={rec} onChange={setRec} issues={issues} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="order-1 lg:order-2">{previewPane}</div>
        </div>
      </div>
    </div>
  );
}
