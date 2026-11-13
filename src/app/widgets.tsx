// Field widgets driven by field metadata: one control per field type, the link autocomplete,
// the editable child-table grid, attachments and read-only cell rendering.

import { useQuery } from "@tanstack/react-query";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Link } from "react-router";
import { api, ApiError, docPath, download, errorMessage, newKey, type FieldError } from "../lib/api";
import { asRows } from "../lib/doc";
import { comparedFields, isFrom, resolveLinkFilters, type LinkScope } from "../lib/linkFilters";
import { t } from "../lib/i18n";
import { cn } from "../lib/utils";
import { stateTone, stateWords } from "../lib/targetDraft";
import { docstatusTone } from "../lib/statusTones";
import { formatValue, fromZonedInput, humanize, NUMERIC_TYPES, shortId, toZonedInput, zoneLabel } from "../lib/format";
import { uploadFile } from "../lib/files";
import { RichText, RichTextEditor } from "../ui/richtext";
import {
  DOCSTATUS_LABEL,
  fieldState,
  recordTitle,
  useEntityMeta,
  type ChildTable,
  type EntityMeta,
  type Doc,
  type Field,
  type ListResponse,
} from "../lib/meta";
import { Badge, Button, confirmDialog, Dialog, EmptyState, Field as FieldWrap, Icon, Spinner, StatusBadge, toast, useDebounced, useDismiss } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";

export interface ControlProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown, title?: string) => void;
  id: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Known display title of a link value. */
  title?: string;
  currencyPrecision?: number;
  /** Rendered inside a grid cell: no visible label, so `label` becomes the accessible name. */
  compact?: boolean;
  label?: string;
  /** Owning record, for attachment uploads. */
  entity?: string;
  recordId?: string;
  /** The record in the form (and the parent's, in a child table's row): what a link's `{ from }` filter reads. */
  scope?: LinkScope;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
// Studio's builder, loaded only by a form that has a query to build.
const QueryInput = lazy(() => import("./QueryInput"));
const orNull = (s: string) => (s === "" ? null : s);

/** Kinds that keep their own read-only form: a tick, a link with its open button, a preview, a picker, a secret. */
const NOT_AS_TEXT = new Set(["check", "link", "json", "attach", "color", "secret", "table"]);
const MULTILINE = new Set(["text", "markdown", "code"]);
/** Where a rich-text field's pictures come from besides https: the workspace's own stored files. */
const RICH_FILES = { imageSources: ["/files/"] };

/** What a field the person cannot edit looks like: its value as text, in the field's own grid cell (numbers end-aligned). Not tabbable, so Tab skips the figures; a click selects and copies. */
function ReadOnlyValue({ field: f, value, id, invalid, describedBy, compact, label, currencyPrecision }: ControlProps) {
  const common = {
    id,
    readOnly: true,
    tabIndex: -1,
    placeholder: "—",
    value: formatValue(f, value, { currencyPrecision }),
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    "aria-label": compact ? label : undefined,
  };
  return MULTILINE.has(f.type) ? (
    <textarea className={`textarea read-value ${f.type === "code" ? "mono" : ""}`} rows={1} {...common} />
  ) : (
    <input className={`input read-value ${NUMERIC_TYPES.has(f.type) ? "num" : ""}`} {...common} />
  );
}

/** A date or moment as the person's locale writes it, for the printed page only: the browser's own date box prints in its own
 *  format and mask, so a draft and a submitted record (which shows this same text as a value) would print two styles. */
function PrintValue({ field, value }: { field: Field; value: unknown }) {
  return <span className="print-value" aria-hidden="true">{formatValue(field, value)}</span>;
}

export function FieldControl(p: ControlProps) {
  const { field: f, value, onChange, disabled } = p;
  const common = {
    id: p.id,
    disabled,
    required: p.required,
    "aria-invalid": p.invalid || undefined,
    "aria-describedby": p.describedBy,
    "aria-label": p.compact ? p.label : undefined,
  };
  // The state a service target keeps: a badge with its word (never colour alone), not a box to type in.
  if (f.kept_by_target && (f.type === "select" || f.type === "data")) {
    const v = text(value);
    return <output id={p.id} aria-describedby={p.describedBy}>{v && <Badge tone={stateTone(v)}>{isolate(stateWords()[v] ?? v)}</Badge>}</output>;
  }
  // A tick the person cannot change is a word in its place ("Yes" / "No"), named by its label like any value.
  if (f.type === "check" && disabled) {
    return <output id={p.id} aria-describedby={p.describedBy} aria-label={p.compact ? p.label : undefined} className={cn("read-text", value !== true && "read-text-off")}>{value === true ? t("Yes") : t("No")}</output>;
  }
  // A long text declared as rich text (`widget: rich_text`): the kit's editor (compact) to write it, the same typography to read and print it.
  if (f.type === "text" && f.widget === "rich_text") {
    if (disabled) {
      return (
        <div id={p.id} role="group" aria-label={p.label ?? f.label} aria-describedby={p.describedBy} className="read-rich">
          {text(value) ? <RichText html={text(value)} options={RICH_FILES} /> : <span className="faint">—</span>}
        </div>
      );
    }
    return (
      <RichTextEditor
        toolbar="compact"
        id={p.id}
        label={p.label ?? f.label}
        describedBy={p.describedBy}
        invalid={p.invalid}
        maxLength={f.max_length}
        value={text(value)}
        onChange={(v) => onChange(orNull(v))}
        imageSources={RICH_FILES.imageSources}
        onUploadImage={async (file) => {
          const stored = await uploadFile(file, p.entity && p.recordId ? { entity: p.entity, id: p.recordId } : undefined);
          return { src: stored.url, alt: stored.file_name.replace(/\.[^.]+$/, "") };
        }}
        minHeight="7rem"
      />
    );
  }
  // A value the person cannot edit is shown as text (an input that is readOnly, so it stays selectable and named by its label), not as a greyed box.
  if (disabled && !NOT_AS_TEXT.has(f.type)) return <ReadOnlyValue {...p} />;
  switch (f.type) {
    case "check":
      return <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "select": {
      const options = f.options ?? [];
      const v = text(value);
      return (
        <select className="select" {...common} value={v} onChange={(e) => onChange(orNull(e.target.value))}>
          <option value="">{disabled ? "" : "—"}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {isolate(o)}
            </option>
          ))}
          {v && !options.includes(v) && <option value={v}>{isolate(v)}</option>}
        </select>
      );
    }
    case "link":
      return (
        <LinkInput
          to={f.to ?? ""}
          value={typeof value === "string" ? value : null}
          title={isolate(p.title)}
          onChange={onChange}
          linkFilters={f.link_filters}
          scope={p.scope}
          id={p.id}
          disabled={disabled}
          invalid={p.invalid}
          describedBy={p.describedBy}
          label={p.compact ? p.label : undefined}
          required={p.required}
        />
      );
    case "date":
      return (
        <>
          <input type="date" className="input" {...common} value={text(value)} onChange={(e) => onChange(orNull(e.target.value))} />
          <PrintValue field={f} value={value} />
        </>
      );
    case "datetime": {
      // On the workspace's clock; its zone is named beside the box when the browser's is another.
      const zone = zoneLabel();
      const input = (
        <>
          <input
            type="datetime-local"
            className="input"
            {...common}
            title={zone ? tr("On the workspace's clock ({zone})", { zone }) : undefined}
            value={toZonedInput(value)}
            onChange={(e) => onChange(fromZonedInput(e.target.value))}
          />
          <PrintValue field={f} value={value} />
        </>
      );
      return zone && !p.compact ? (
        <span className="zoned">
          {input}
          <span className="zoned-name faint">{isolate(zone)}</span>
        </span>
      ) : (
        input
      );
    }
    case "int":
      return (
        <input
          className="input num"
          inputMode="numeric"
          autoComplete="off"
          {...common}
          value={text(value)}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange(v === "" ? null : /^-?\d{1,15}$/.test(v) ? Number(v) : v);
          }}
        />
      );
    case "decimal":
    case "currency":
    case "percent":
      if (disabled) return <input className="input num" {...common} value={formatValue(f, value, { currencyPrecision: p.currencyPrecision })} readOnly />;
      return (
        <input
          className="input num"
          inputMode="decimal"
          autoComplete="off"
          {...common}
          value={text(value)}
          onChange={(e) => onChange(orNull(e.target.value.trim()))}
        />
      );
    case "text":
    case "markdown":
    case "code":
      return (
        <textarea
          className={`textarea ${f.type === "code" ? "mono" : ""}`}
          {...common}
          rows={p.compact ? 1 : f.type === "code" ? 6 : 3}
          maxLength={f.max_length}
          spellCheck={f.type !== "code"}
          autoCapitalize={f.type === "code" ? "none" : undefined}
          autoCorrect={f.type === "code" ? "off" : undefined}
          value={text(value)}
          onChange={(e) => onChange(orNull(e.target.value))}
        />
      );
    case "json":
      return f.widget === "studio_query" ? (
        <Suspense fallback={<Spinner />}>
          <QueryInput {...p} />
        </Suspense>
      ) : (
        <JsonInput {...p} />
      );
    case "attach":
      return <AttachInput {...p} />;
    case "color": {
      const v = text(value);
      return (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            type="color"
            aria-label={tr("{label} colour picker", { label: f.label })}
            disabled={disabled}
            value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"}
            onChange={(e) => onChange(e.target.value)}
          />
          <input className="input" {...common} placeholder={tr("#rrggbb")} value={v} onChange={(e) => onChange(orNull(e.target.value.trim()))} />
        </div>
      );
    }
    case "secret":
      return <SecretInput {...p} />;
    case "table":
      return null; // rendered by TableGrid
    default: {
      const type = f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "url" ? "url" : "text";
      // Record data, not the user's own: keep browser/keyboard autofill of personal details out.
      return (
        <input
          className="input"
          type={type}
          autoComplete="off"
          {...common}
          maxLength={f.max_length}
          value={text(value)}
          onChange={(e) => onChange(orNull(e.target.value))}
        />
      );
    }
  }
}

/** For an entity the workspace does not have (its app, or an add-on of one, is not installed):
 * what it is and where it comes from, rather than an error. */
export function NotInstalled({ entity }: { entity: string }) {
  const name = humanize(entity.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
  return (
    <EmptyState title={tr("{name} is not in this workspace", { name })} icon="apps">
      <p className="muted">{tr("The app that adds it is not installed. An administrator can install it from Apps.")}</p>
      <a className="btn btn-default btn-md" href="/store/?tab=store">
        {tr("Open Apps")}
      </a>
    </EmptyState>
  );
}

const reported = new Set<string>();

/** A records page mounted on an address with no entity in it: its route lacks `:entity`. Said plainly, and once in the console,
 *  rather than left on "Loading…" for ever (the first browser walk found CRM's forms so). */
export function MissingEntity({ page }: { page: string }) {
  useEffect(() => {
    if (reported.has(page)) return;
    reported.add(page);
    console.error(`${page} was mounted without an entity in its address: its route needs ":entity" in its path (for example "e/:entity/:id").`);
  }, [page]);
  return (
    <EmptyState title={t("This page was not given a record type")} icon="alert">
      <p className="muted">{t("The address has no record type in it, so there is nothing to show. This is a fault in the app's page, not in your data.")}</p>
    </EmptyState>
  );
}

/** Whether a failed entity lookup means the workspace does not have the entity. */
export const notInstalled = (error: unknown) => error instanceof ApiError && error.status === 404;

// ── link autocomplete ──

/**
 * Viewport-fixed placement under (or above) `anchor`, so the dropdown is never clipped by a
 * scrolling grid or dialog body, shortened to fit the visible area (the visual viewport, which
 * excludes an on-screen keyboard). Follows scrolling and resizing while open.
 */
function useAnchoredStyle(anchor: RefObject<HTMLElement | null>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
      const top = vv?.offsetTop ?? 0;
      const below = (vv ? top + vv.height : window.innerHeight) - r.bottom;
      const above = below < 240 && r.top - top > below;
      setStyle({
        position: "fixed",
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        right: "auto",
        width,
        maxHeight: Math.min(280, (above ? r.top - top : below) - 12),
        // Above: hang from the field's top edge (no viewport-height math, which a keyboard skews).
        ...(above ? { top: r.top - 4, transform: "translateY(-100%)" } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [anchor, open]);
  return open ? style : undefined;
}

/** Title of a linked record: the known title, else fetched once (cached) from the record. */
export function useLinkTitle(to: string, id: string | null | undefined, known?: string): string | undefined {
  const target = useEntityMeta(to || undefined);
  const q = useQuery({
    queryKey: ["record-title", to, id],
    queryFn: ({ signal }) => api.get<Doc>(docPath(to, id ?? ""), { titles: false }, signal),
    enabled: !!to && !!id && !known,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!id) return undefined;
  if (known) return known;
  if (q.data) return recordTitle(target.data, q.data);
  return q.isError ? shortId(id) : undefined;
}

export function LinkTitle({ to, id, title }: { to: string; id: string; title?: string }) {
  const t = useLinkTitle(to, id, title);
  return <Link to={`/e/${to}/${id}`}>{t ?? "…"}</Link>;
}

export function LinkInput({
  to,
  value,
  title,
  onChange,
  linkFilters,
  id,
  disabled,
  invalid,
  describedBy,
  label,
  required,
  placeholder,
  scope,
}: {
  to: string;
  value: string | null;
  title?: string;
  onChange: (id: string | null, title?: string) => void;
  linkFilters?: Record<string, unknown>;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  /** The form this picker is in: what a `{ from }` link filter reads (see lib/linkFilters.ts). */
  scope?: LinkScope;
}) {
  const target = useEntityMeta(to || undefined);
  const resolved = useLinkTitle(to, value, title);
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const listStyle = useAnchoredStyle(input, open);
  const q = useDebounced(typed ?? "", 250);
  const titleField = target.data?.title_field;
  const rf = resolveLinkFilters(linkFilters, scope);
  const filters = Object.keys(rf.applied).length ? JSON.stringify(rf.applied) : undefined;
  // The fields a `from` filter compares (the company): shown under each choice, so same names can be told apart.
  const compared = comparedFields(linkFilters).filter((k) => target.data?.fields.some((f) => f.name === k));
  const results = useQuery({
    queryKey: ["link-search", to, q.trim(), filters, compared.join(",")],
    queryFn: ({ signal }) =>
      api.get<ListResponse>(
        docPath(to),
        { search: q.trim() || undefined, limit: 10, filters, fields: ["id", "number", ...(titleField ? [titleField] : []), ...compared].join(",") },
        signal,
      ),
    enabled: open && !disabled && !!to && !target.isLoading,
    staleTime: 30_000,
  });
  const rows = results.data?.rows ?? [];
  const close = () => {
    setOpen(false);
    setTyped(null);
  };
  useDismiss(wrap, open, close);

  // The field a filter reads changed: a chosen record that no longer matches it is cleared, with a line saying so.
  const requiredKey = JSON.stringify(rf.required);
  const seen = useRef(requiredKey);
  const [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => {
    if (seen.current === requiredKey) return;
    seen.current = requiredKey;
    setCleared(null);
    if (!value || disabled || requiredKey === "{}") return;
    let live = true;
    api
      .get<Doc>(docPath(to, value), { titles: false })
      .then((rec) => {
        if (live && Object.entries(rf.required).some(([k, v]) => String(rec[k] ?? "") !== String(v))) {
          onChange(null, "");
          setCleared(tr("{value} was cleared: it does not belong to the {field} now chosen.", { value: resolved ?? label ?? name, field: rf.waiting[0]?.label ?? sourceLabel(linkFilters, scope) }));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredKey]);

  const choose = (row: Doc | undefined) => {
    if (!row?.id) return;
    onChange(row.id, recordTitle(target.data, row));
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const n = rows.length || 1;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      choose(rows[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // keep an enclosing dialog open
      close();
    } else if (e.key === "Tab") close();
  };

  const name = target.data?.label ?? humanize(to);
  const hintId = `${listId}-hint`;
  const hint = rf.waiting.length ? tr("Choose {field} first to see only its {name}.", { field: rf.waiting.map((w) => w.label).join(", "), name }) : null;
  return (
    <>
    <div className="combo" ref={wrap}>
      <input
        ref={input}
        id={id}
        className={disabled ? "input read-value" : "input"}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, hint || cleared ? hintId : ""].filter(Boolean).join(" ") || undefined}
        aria-label={label}
        aria-required={required || undefined}
        readOnly={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        autoComplete="off"
        placeholder={disabled ? "—" : (placeholder ?? t("Search {name}…", { name }))}
        value={typed ?? resolved ?? (value ? "…" : "")}
        onChange={(e) => {
          setTyped(e.target.value);
          setOpen(true);
          setActive(0);
          if (e.target.value === "" && value) onChange(null, "");
        }}
        onClick={() => !disabled && setOpen(true)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
      />
      {/* Out of the tab order while editable so Tab moves field to field (clear = select + Delete). */}
      <span className="combo-actions">
        {value && !disabled && (
          <button type="button" tabIndex={-1} className="icon-btn icon-btn-sm" aria-label={tr("Clear {value}", { value: label ?? name })} onClick={() => onChange(null, "")}>
            <Icon name="x" size={14} />
          </button>
        )}
        {value && (
          <Link
            className="icon-btn icon-btn-sm"
            tabIndex={disabled ? undefined : -1}
            to={`/e/${to}/${value}`}
            aria-label={tr("Open {value}", { value: resolved ?? name })}
            title={tr("Open {name}", { name })}
          >
            <Icon name="external" size={14} />
          </Link>
        )}
      </span>
      {open && (
        <ul className="listbox" role="listbox" id={listId} aria-label={tr("{name} matches", { name })} style={listStyle}>
          {results.isLoading || target.isLoading ? (
            <li className="option-empty" role="presentation">
              {tr("Searching…")}
            </li>
          ) : results.error ? (
            <li className="option-empty" role="presentation">
              {isolate(errorMessage(results.error))}
            </li>
          ) : !rows.length ? (
            <li className="option-empty" role="presentation">
              {t("No matches")}
            </li>
          ) : (
            rows.map((r, i) => {
              const t = recordTitle(target.data, r);
              return (
                <li
                  key={r.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <span>{isolate(t)}</span>
                  {compared.length ? (
                    <small>{compared.map((k, j) => <Fragment key={k}>{j > 0 && " · "}<ComparedValue entity={target.data} field={k} value={r[k]} /></Fragment>)}</small>
                  ) : r.number && r.number !== t ? (
                    <small>{isolate(String(r.number))}</small>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
    {(hint || cleared) && (
      <p className="field-hint" id={hintId}>
        {isolate(cleared ?? hint ?? "")}
      </p>
    )}
    </>
  );
}

/** A field of the linked record a link filter compares (its company), as the second line of a choice: a link as its title. */
export function ComparedValue({ entity, field, value }: { entity?: EntityMeta; field: string; value: unknown }) {
  const f = entity?.fields.find((x) => x.name === field);
  const to = f?.type === "link" ? f.to : undefined;
  const title = useLinkTitle(to ?? "", typeof value === "string" ? value : null);
  if (value === null || value === undefined || value === "") return null;
  return <>{isolate(to ? (title ?? "…") : String(value))}</>;
}

/** A link in a list column whose picker compares a field of the linked record (its company): that value under the title. */
function LinkWithCompared({ to, id, title, fields }: { to: string; id: string; title: string; fields: string[] }) {
  const target = useEntityMeta(to);
  const rec = useQuery({
    queryKey: ["record-title", to, id],
    queryFn: ({ signal }) => api.get<Doc>(docPath(to, id), { titles: false }, signal),
    staleTime: 10 * 60_000,
    retry: false,
  }).data;
  const known = fields.filter((k) => rec && rec[k] != null && rec[k] !== "");
  return (
    <>
      {title}
      {known.length > 0 && (
        <small className="faint" style={{ display: "block" }}>
          {known.map((k, j) => (
            <Fragment key={k}>
              {j > 0 && " · "}
              <ComparedValue entity={target.data} field={k} value={rec![k]} />
            </Fragment>
          ))}
        </small>
      )}
    </>
  );
}

/** The label a hint names when the source is not in the form's own words. */
const sourceLabel = (filters: Record<string, unknown> | undefined, scope: LinkScope | undefined) => {
  const from = Object.values(filters ?? {}).find(isFrom)?.from ?? "";
  return scope?.labelOf?.(from) ?? from.replace(/^parent\./, "");
};

// ── attachments ──

/** Whether a stored file is a picture, from its content type (a HEAD request, kept: files do not change). */
export const filePicture = (url: string) => ({
  queryKey: ["file-picture", url],
  queryFn: () => fetch(url, { method: "HEAD", credentials: "same-origin" }).then((r) => r.ok && (r.headers.get("content-type") ?? "").startsWith("image/")),
  staleTime: Infinity,
  retry: false,
});

function AttachInput({ value, onChange, id, disabled, invalid, entity, recordId }: ControlProps) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const v = typeof value === "string" ? value : "";
  // A picture is shown as itself, beside the way to download it.
  const picture = useQuery({ ...filePicture(v), enabled: v.startsWith("/files/") }).data === true;

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const r = await uploadFile(file, entity && recordId ? { entity, id: recordId } : undefined);
      setName(r.file_name);
      onChange(r.url);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (v) {
    return (
      <div className="stack attach-value">
        {picture && <img className="attach-picture" src={v} alt={name ?? t("The attached picture")} loading="lazy" />}
        <div className="row" style={{ flexWrap: "nowrap", minHeight: 34 }}>
          {v.startsWith("/files/") ? (
            <button type="button" className="link-btn row" onClick={() => download(v, name ?? "attachment").catch((e) => toast(errorMessage(e), "error"))}>
              <Icon name="download" />
              {name ?? t("Download file")}
            </button>
          ) : (
            <a href={v} target="_blank" rel="noopener noreferrer">
              {isolate(v)}
            </a>
          )}
          {!disabled && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t("Remove")}
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="row" style={{ minHeight: 34 }}>
      <input
        type="file"
        id={id}
        disabled={disabled || busy}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {busy && <Spinner small label={tr("Uploading")} />}
    </div>
  );
}

// ── JSON ──

export function JsonInput({ value, onChange, id, disabled, invalid, describedBy, compact, label }: ControlProps) {
  const pretty = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));
  const [draft, setDraft] = useState(() => pretty(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Follow outside changes (calc, reload) unless the draft already says the same thing.
    setDraft((d) => {
      try {
        if (JSON.stringify(d.trim() ? JSON.parse(d) : null) === JSON.stringify(value ?? null)) return d;
      } catch {
        // invalid draft: replace it
      }
      return pretty(value);
    });
  }, [value]);
  if (disabled) return <pre className="code" id={id} aria-label={label}>{pretty(value) || "—"}</pre>;
  return (
    <>
      <textarea
        id={id}
        className="textarea mono"
        rows={compact ? 1 : 5}
        aria-invalid={invalid || !!error || undefined}
        aria-describedby={describedBy}
        aria-label={compact ? label : undefined}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try {
            onChange(draft.trim() ? JSON.parse(draft) : null);
            setError(null);
          } catch {
            setError(tr("Not valid JSON"));
          }
        }}
      />
      {error && <p className="field-error">{isolate(error)}</p>}
    </>
  );
}

// ── read-only cells (lists, reports) ──

export function CellValue({
  field,
  value,
  title,
  currencyPrecision,
}: {
  field: Pick<Field, "name" | "type"> & Partial<Field>;
  value: unknown;
  title?: string;
  currencyPrecision?: number;
}) {
  if (value === null || value === undefined || value === "") return null;
  if (field.name === "docstatus" && typeof value === "number") {
    const label = DOCSTATUS_LABEL[value] ?? String(value);
    return <Badge tone={docstatusTone(value)}>{isolate(label)}</Badge>;
  }
  if (field.kept_by_target && field.type !== "datetime") return <Badge tone={stateTone(String(value))}>{isolate(stateWords()[String(value)] ?? String(value))}</Badge>;
  if (field.name === "status" || field.name === "workflow_state") return <StatusBadge value={value} />;
  switch (field.type) {
    case "link": {
      const shown = title ?? shortId(value);
      const cmp = comparedFields(field.link_filters);
      return cmp.length && field.to ? <LinkWithCompared to={field.to} id={String(value)} title={shown} fields={cmp} /> : <>{shown}</>;
    }
    case "check":
      return value === true ? (
        <>
          <Icon name="check" />
          <span className="sr-only">{tr("Yes")}</span>
        </>
      ) : (
        <span className="sr-only">{tr("No")}</span>
      );
    case "secret": // write-only: `true` when saved, or a new value typed in this form; never shown
      return (
        <>
          <span aria-hidden="true">••••••••</span>
          <span className="sr-only">{tr("Set")}</span>
        </>
      );
    default:
      return <>{isolate(formatValue(field as Field, value, { currencyPrecision }))}</>;
  }
}

// ── child table grid ──

export function rowKey(r: Doc, i: number): string {
  return String(r.id ?? r._key ?? i);
}

export function withValue(r: Doc, name: string, value: unknown, title?: string): Doc {
  const next: Doc = { ...r, [name]: value };
  if (title !== undefined) next._titles = { ...r._titles, [name]: title };
  return next;
}

function newRow(fields: Field[]): Doc {
  const row: Doc = { _key: newKey() };
  for (const f of fields) if (f.default !== undefined && f.type !== "table") row[f.name] = f.default;
  return row;
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** The edited cell of a lines grid; for a cell in a line's own lines, `field` is that table and `sub` the cell in it. */
export type GridCell = { row: number; field: string; sub?: { row: number; field: string } };

const countText = (n: number) => (n === 1 ? tr("1 row") : tr("{value} rows", { value: n }));

export function TableGrid({
  child,
  rows,
  onChange,
  locked,
  errors,
  parent,
  user,
  precisionOf,
  entity,
  recordId,
  within,
  parentFields,
}: {
  child: ChildTable;
  rows: Doc[];
  /** `cell` names the edited cell so its error can be cleared; structural edits omit it. */
  onChange: (rows: Doc[], cell?: GridCell) => void;
  locked: boolean;
  errors: FieldError[];
  parent: Doc;
  user: unknown;
  precisionOf: (f: Field, row: Doc) => number | undefined;
  entity: string;
  recordId?: string;
  /** Set on the grid of a line's own lines: which line it belongs to ("Tests, row 1"). It has no lines of its own to edit. */
  within?: string;
  /** The parent record's fields, for naming the field a row's picker waits for (`parent.company`). */
  parentFields?: Field[];
}) {
  const gridId = useId();
  const name = within ? tr("{within}: {label}", { within, label: child.label }) : child.label;
  // Phones get one card per row (same breakpoint as records.css) and edit in the row dialog.
  const phone = useMediaQuery("(max-width: 720px)");
  const [editing, setEditing] = useState<number | null>(null);
  const visible = child.fields.filter((f) => f.can_read === true && !f.hidden && f.type !== "table");
  const listed = visible.filter((f) => f.in_list);
  const cols = listed.length ? listed : visible.slice(0, 5);
  // A line's own table shows as a count in the grid and is edited in the row's dialog.
  const subs = within ? [] : child.fields.filter((f) => f.type === "table" && f.can_read === true && !f.hidden && child.children?.[f.name]);
  const span = cols.length + subs.length + 2;
  const ownErrors = (i: number) => errors.filter((e) => e.row?.[1] === i && !e.path);
  const subErrors = (i: number) => errors.filter((e) => e.row?.[1] === i && e.path);
  const subLabel = (name: string) => subs.find((f) => f.name === name)?.label ?? humanize(name);
  const subFieldLabel = (table: string, field: string) => child.children?.[table]?.fields.find((f) => f.name === field)?.label ?? humanize(field);
  // Where an error in a line's own lines is, said on the line: "Evidence, row 2, Title: is required".
  const subText = (e: FieldError) =>
    e.path ? `${tr("{meta} row {value}, {value2}", { meta: subLabel(e.path[1][0]), value: e.path[1][1] + 1, value2: subFieldLabel(e.path[1][0], e.field) })} ${e.message}` : e.message;
  const cellId = (i: number, f: string) => `${gridId}-${i}-${f}`;
  // Focus moves after the re-render that creates/moves the row (not rAF: paused in background tabs).
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const focusCell = (i: number, f?: string) => {
    pendingFocus.current = cellId(i, f ?? cols[0]?.name ?? "");
  };

  // A row's pickers read the row, and `parent.` the record the table is in.
  const scopeOf = (row: Doc): LinkScope => ({
    doc: row,
    parent,
    labelOf: (path) => (path.startsWith("parent.") ? parentFields?.find((f) => f.name === path.slice(7))?.label : child.fields.find((f) => f.name === path)?.label),
  });
  const update = (i: number, name: string, value: unknown, title?: string) =>
    onChange(
      rows.map((r, j) => (j === i ? withValue(r, name, value, title) : r)),
      { row: i, field: name },
    );
  const add = (at = rows.length) => {
    const next = [...rows];
    next.splice(at, 0, newRow(child.fields));
    onChange(next);
    if (phone) setEditing(at);
    else focusCell(at);
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const move = (i: number, d: number, focusField?: string) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (focusField) focusCell(j, focusField);
  };
  const onRowKey = (i: number) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (locked) return;
    const field = (e.target as HTMLElement).id?.slice(`${gridId}-${i}-`.length) || undefined;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(i, e.key === "ArrowUp" ? -1 : 1, field);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      add(i + 1);
    }
  };
  const labelOf = (name: string) => child.fields.find((f) => f.name === name)?.label ?? humanize(name);
  // A failed save opens the dialog of a line whose own lines are wrong (FormView clicks `data-reveal`): land on the field.
  useEffect(() => {
    if (editing !== null) document.querySelector<HTMLElement>('dialog[open] [aria-invalid="true"]')?.focus();
  }, [editing]);
  const subTable = (f: Field, i: number) => {
    const r = rows[i];
    const sub = child.children![f.name];
    const st = fieldState(f, { doc: r, parent, user }, locked);
    const lineName = tr("{label}, row {value}", { label: child.label, value: i + 1 });
    const subErrs = errors.filter((e) => e.row?.[1] === i && e.path?.[1][0] === f.name).map((e): FieldError => ({ field: e.field, message: e.message, row: [f.name, e.path![1][1]] }));
    return (
      <div key={f.name} className="field span-all" role="group" aria-labelledby={`${gridId}-dlg-${f.name}-label`}>
        <div className="field-label" id={`${gridId}-dlg-${f.name}-label`}>
          {isolate(f.label)}
        </div>
        <TableGrid
          child={sub}
          rows={asRows(r[f.name])}
          onChange={(next, cell) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.name]: next } : x)), cell && { row: i, field: f.name, sub: cell })}
          locked={st.disabled}
          errors={subErrs}
          parent={parent}
          user={user}
          precisionOf={precisionOf}
          entity={entity}
          recordId={recordId}
          parentFields={parentFields}
          within={lineName}
        />
      </div>
    );
  };

  return (
    <div>
      <div className="line-grid-wrap">
        {phone ? (
          rows.length ? (
            // List semantics stated explicitly: Safari drops them for unstyled lists.
            <ol className="line-grid-cards" role="list" aria-label={isolate(name)}>
              {rows.map((r, i) => {
                const errs = ownErrors(i);
                const subErrs = subErrors(i);
                const errId = `${gridId}-${i}-errors`;
                return (
                  <li key={rowKey(r, i)} className="line-grid-card">
                    <span className="line-grid-card-idx">{i + 1}</span>
                    <dl>
                      {cols.map(
                        (f) =>
                          fieldState(f, { doc: r, parent, user }, locked).visible && (
                            <div key={f.name} className={NUMERIC_TYPES.has(f.type) ? "num" : undefined}>
                              <dt>{isolate(f.label)}</dt>
                              <dd>
                                <CellValue field={f} value={r[f.name]} title={r._titles?.[f.name]} currencyPrecision={precisionOf(f, r)} />
                              </dd>
                            </div>
                          ),
                      )}
                      {subs.map((f) => (
                        <div key={f.name}>
                          <dt>{isolate(f.label)}</dt>
                          <dd>{countText(asRows(r[f.name]).length)}</dd>
                        </div>
                      ))}
                    </dl>
                    {errs.length + subErrs.length > 0 && (
                      <p className="field-error" id={errId}>
                        {isolate([...errs.map((e) => `${labelOf(e.field)} ${e.message}`), ...subErrs.map(subText)].join(" · "))}
                      </p>
                    )}
                    <div className="line-grid-card-actions">
                      <Button aria-label={(locked ? tr("View row {value2}", { value2: i + 1 }) : tr("Edit row {value2}", { value2: i + 1 }))} aria-describedby={errs.length + subErrs.length ? errId : undefined} data-reveal={subErrs.length ? "" : undefined} onClick={() => setEditing(i)}>
                        {locked ? tr("View") : tr("Edit")}
                      </Button>
                      {!locked && (
                        <>
                          <button type="button" className="icon-btn" aria-label={tr("Move row {value} up", { value: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
                            <Icon name="up" />
                          </button>
                          <button type="button" className="icon-btn" aria-label={tr("Move row {value} down", { value: i + 1 })} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                            <Icon name="down" />
                          </button>
                          <button type="button" className="icon-btn" aria-label={tr("Remove row {value}", { value: i + 1 })} onClick={() => remove(i)}>
                            <Icon name="trash" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="line-grid-empty">{t("No rows yet.")}</p>
          )
        ) : (
          <table className="line-grid" aria-label={isolate(name)}>
            <thead>
              <tr>
                <th className="line-grid-idx" scope="col">
                  #
                </th>
                {cols.map((f) => (
                  <th key={f.name} scope="col" className={NUMERIC_TYPES.has(f.type) ? "num" : undefined}>
                    {isolate(f.label)}
                    {f.required && (
                      <span className="req" aria-hidden="true">
                        *
                      </span>
                    )}
                  </th>
                ))}
                {subs.map((f) => (
                  <th key={f.name} scope="col">
                    {isolate(f.label)}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{t("Row actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const errs = ownErrors(i);
                const subErrs = subErrors(i);
                const other = errs.filter((e) => !cols.some((c) => c.name === e.field));
                const scope = { doc: r, parent, user };
                return (
                  <Fragment key={rowKey(r, i)}>
                    <tr onKeyDown={onRowKey(i)}>
                      <td className="line-grid-idx">{i + 1}</td>
                      {cols.map((f) => {
                        const st = fieldState(f, scope, locked);
                        const err = errs.find((e) => e.field === f.name);
                        return (
                          <td key={f.name}>
                            {st.visible ? (
                              <>
                                <FieldControl
                                  field={f}
                                  id={cellId(i, f.name)}
                                  compact
                                  label={tr("{label}, row {value}", { label: f.label, value: i + 1 })}
                                  value={r[f.name]}
                                  title={r._titles?.[f.name]}
                                  disabled={st.disabled}
                                  required={st.required}
                                  invalid={!!err}
                                  currencyPrecision={precisionOf(f, r)}
                                  entity={entity}
                                  recordId={recordId}
                                  scope={scopeOf(r)}
                                  onChange={(v, t) => update(i, f.name, v, t)}
                                />
                                {err && <div className="cell-error">{isolate(err.message)}</div>}
                              </>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                        );
                      })}
                      {subs.map((f) => (
                        <td key={f.name}>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={tr("{within}: {label}", { within: tr("{label}, row {value}", { label: f.label, value: i + 1 }), label: countText(asRows(r[f.name]).length) })}
                            onClick={() => setEditing(i)}
                          >
                            {countText(asRows(r[f.name]).length)}
                          </Button>
                        </td>
                      ))}
                      <td className="line-grid-actions">
                        <button type="button" className="icon-btn icon-btn-sm" aria-label={tr("Show all fields of row {value}", { value: i + 1 })} title={tr("All fields")} data-reveal={subErrs.length ? "" : undefined} onClick={() => setEditing(i)}>
                          <Icon name="expand" size={14} />
                        </button>
                        {!locked && (
                          <>
                            <button type="button" className="icon-btn icon-btn-sm" aria-label={tr("Move row {value} up", { value: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
                              <Icon name="up" size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn-sm"
                              aria-label={tr("Move row {value} down", { value: i + 1 })}
                              disabled={i === rows.length - 1}
                              onClick={() => move(i, 1)}
                            >
                              <Icon name="down" size={14} />
                            </button>
                            <button type="button" className="icon-btn icon-btn-sm" aria-label={tr("Remove row {value}", { value: i + 1 })} onClick={() => remove(i)}>
                              <Icon name="trash" size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {other.length + subErrs.length > 0 && (
                      <tr className="row-errors">
                        <td colSpan={span}>
                          {tr("Row")} {i + 1}: {isolate([...other.map((e) => `${labelOf(e.field)} ${e.message}`), ...subErrs.map(subText)].join(" · "))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={span} className="line-grid-empty">
                    {t("No rows yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {!locked && (
        <div className="line-grid-foot">
          <Button size="sm" icon="plus" onClick={() => add()}>
            {t("Add row")}
          </Button>
          {!phone && <span className="field-hint">{t("Alt+↑/↓ moves a row · Ctrl+Enter inserts a row below")}</span>}
        </div>
      )}
      <Dialog
        open={editing !== null && !!rows[editing]}
        onClose={() => setEditing(null)}
        title={tr("{label} — row {value}", { label: name, value: (editing ?? 0) + 1 })}
        wide
        footer={
          <Button variant="primary" onClick={() => setEditing(null)}>
            {tr("Done")}
          </Button>
        }
      >
        {editing !== null && rows[editing] && (
          <div className="form-grid">
            {visible.map((f) => {
              const r = rows[editing];
              const st = fieldState(f, { doc: r, parent, user }, locked);
              if (!st.visible) return null;
              const err = ownErrors(editing).find((e) => e.field === f.name);
              const fid = `${gridId}-dlg-${f.name}`;
              const control = (
                <FieldControl
                  field={f}
                  id={fid}
                  value={r[f.name]}
                  title={r._titles?.[f.name]}
                  disabled={st.disabled}
                  required={st.required}
                  invalid={!!err}
                  currencyPrecision={precisionOf(f, r)}
                  entity={entity}
                  recordId={recordId}
                  scope={scopeOf(r)}
                  onChange={(v, t) => update(editing, f.name, v, t)}
                />
              );
              return f.type === "check" ? (
                <div key={f.name} className="field">
                  <div className="check-field">
                    {control}
                    <label htmlFor={fid}>{isolate(f.label)}</label>
                  </div>
                  {err && <p className="field-error">{isolate(err.message)}</p>}
                </div>
              ) : (
                <FieldWrap key={f.name} label={isolate(f.label)} htmlFor={fid} required={st.required} error={err?.message} hint={isolate(f.description)}>
                  {control}
                </FieldWrap>
              );
            })}
            {subs.map((f) => subTable(f, editing))}
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Write-only secrets: the server only says whether one is set (`true`). Text sets it, `null`
 *  removes it, and leaving it alone keeps it. */
function SecretInput({ field: f, value, onChange, disabled, id, invalid, describedBy }: ControlProps) {
  const [editing, setEditing] = useState(false);
  if (value === true && !editing) {
    return (
      <div className="row" style={{ flexWrap: "nowrap", minHeight: 34 }}>
        <span className="mono faint" aria-label={tr("{label} is set", { label: f.label })}>
          ••••••••
        </span>
        <Badge tone="green">{tr("Saved")}</Badge>
        {!disabled && (
          <>
            <Button size="sm" variant="ghost" aria-label={tr("Replace {label}", { label: f.label })} onClick={() => setEditing(true)}>
              {tr("Replace")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={tr("Remove {label}", { label: f.label })}
              onClick={async () => {
                // Ask: once saved, a removed secret is gone, and on a phone a tap meant for Replace can land here.
                const ok = await confirmDialog({ title: tr("Remove {label}?", { label: f.label }), message: tr("It is deleted when you save."), confirmLabel: tr("Remove"), danger: true });
                if (ok) onChange(null);
              }}
            >
              {tr("Remove")}
            </Button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete="new-password"
        autoFocus={editing}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={value === null && !editing ? tr("Not set") : tr("Enter a new value")}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? (editing ? true : null) : e.target.value)}
      />
      {editing && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            onChange(true);
          }}
        >
          {tr("Keep current")}
        </Button>
      )}
    </div>
  );
}
