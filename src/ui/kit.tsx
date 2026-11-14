// The design system: small, accessible building blocks styled by styles.css.

import { isolate, refusal as reason, setStepUpHandler } from "@ferrum/client";
import {
  cloneElement,
  Component,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, b64, errorMessage, request } from "../lib/api";
import { arrowStep, t } from "../lib/i18n";
import { PortalContainer } from "../lib/portal";
import { rememberFocus, trackFocus } from "../lib/focusReturn";
import { placeMenu } from "./menuPlacement";
import { cn } from "../lib/utils";
import { knownStatusTone } from "../lib/statusTones";

// ── icons ──

const ICONS: Record<string, string> = {
  menu: "M3 6h18M3 12h18M3 18h18",
  x: "M18 6 6 18M6 6l12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  plus: "M12 5v14M5 12h14",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  up: "m18 15-6-6-6 6",
  down: "m6 9 6 6 6-6",
  trash: "M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14",
  download: "M12 3v12m0 0 5-5m-5 5-5-5M5 21h14",
  upload: "M12 21V9m0 0 5 5m-5-5-5 5M5 3h14",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  user: "M20 21a8 8 0 1 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  check: "M20 6 9 17l-5-5",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  board: "M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z",
  calendar: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  timeline: "M3 6h8M7 12h10M13 18h8",
  left: "m15 18-6-6 6-6",
  apps: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  space: "M3 3h18v18H3zM3 9h18M9 21V9",
  store: "M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  video: "M16 10.5 21.2 7.4a.5.5 0 0 1 .8.4v8.4a.5.5 0 0 1-.8.4L16 13.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
};

/** Icons that point along the line, so right to left they point the other way (styles.css). */
const ALONG_THE_LINE = new Set(["chevronRight", "left"]);

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg className={ALONG_THE_LINE.has(name) ? "icon icon-dir" : "icon"} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[name] ?? ICONS.file} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── buttons, badges, spinners ──

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  icon?: string;
  loading?: boolean;
};

export function Button({ variant = "default", size = "md", icon, loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className ?? ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner small /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ small, label }: { small?: boolean; label?: string }) {
  return <span className={`spinner ${small ? "spinner-sm" : ""}`} role={label ? "status" : undefined} aria-label={label} />;
}

export type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** The badge tone of a state. `tones` maps exact stored state ids to a tone (the owner of the tone: the field's own
 *  declaration); a value it has wins. Otherwise only well-known whole state ids get a tone (lib/statusTones.ts); any other
 *  value, a negated phrase or translated text is neutral. Never guessed from the words. */
export function statusTone(value: unknown, tones?: Readonly<Record<string, Tone>>): Tone {
  const s = String(value ?? "");
  if (tones && Object.prototype.hasOwnProperty.call(tones, s)) return tones[s];
  return knownStatusTone(s) ?? "neutral";
}

/** A state as a badge: the tone from its state id (`value`, never the label), the words from `label` (default: the value). */
export function StatusBadge({ value, tones, label, title }: { value: unknown; tones?: Readonly<Record<string, Tone>>; label?: ReactNode; title?: string }) {
  return (
    <Badge tone={statusTone(value, tones)} title={title}>
      {label ?? isolate(String(value ?? ""))}
    </Badge>
  );
}

// ── form field wrapper ──

/** What assistive technology is told about a field's control beyond its name, as its label shows it: that it is
 *  required, that it is invalid, and its error or hint. What the control already says is kept. */
export function fieldAria(props: Record<string, unknown>, id: string | undefined, f: { required?: boolean; error?: string; hint?: ReactNode }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.required && props["aria-required"] === undefined) out["aria-required"] = true;
  if (f.error && props["aria-invalid"] === undefined) out["aria-invalid"] = true;
  const said = id && (f.error ? `${id}-error` : f.hint ? `${id}-hint` : undefined);
  if (said) out["aria-describedby"] = [props["aria-describedby"], said].filter(Boolean).join(" ");
  return out;
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // A single control without an id gets one, so the label names it to assistive technology, and it is told what
  // the label shows besides: required, invalid, and its error or hint.
  const auto = useId();
  const only = !htmlFor && isValidElement<Record<string, unknown>>(children) && typeof children.type === "string" ? children : null;
  const id = htmlFor ?? (only ? ((only.props.id as string | undefined) ?? auto) : undefined);
  const control = only ? cloneElement(only as ReactElement<Record<string, unknown>>, { id, ...fieldAria(only.props, id, { required, error, hint }) }) : children;
  return (
    <div className={`field ${error ? "field-invalid" : ""} ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <p className="field-error" id={id ? `${id}-error` : undefined}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={id ? `${id}-hint` : undefined}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ── dialog (native <dialog>: focus trap, Escape, inert background for free) ──

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** One quiet line under the title: what this is about or what happens next. */
  description?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [self, setSelf] = useState<HTMLDialogElement | null>(null);
  useEffect(() => trackFocus(), []);
  // A dialog that is mounted only while it is wanted (`{asking && <Dialog open …/>}`) never sees `open` turn false: it is removed, and focus is given back as it goes.
  useEffect(
    () => () => {
      giveBack.current?.();
      giveBack.current = null;
    },
    [],
  );
  const giveBack = useRef<(() => void) | null>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !giveBack.current) giveBack.current = rememberFocus(); // (React's strict mode runs the unmount cleanup below once at mount: remember again)
    if (open && !d.open) {
      d.showModal();
      // showModal() would focus the header's close button; prefer the marked or first field instead.
      const first = d.querySelector<HTMLElement>("[data-autofocus]") ?? d.querySelector<HTMLElement>(".dialog-body :is(input, select, textarea):not([disabled])");
      first?.focus();
    } else if (!open && d.open) {
      d.close();
      // The browser returns focus to what had it; where that is gone (the menu a dialog was opened from has unmounted) focus goes to the menu's trigger, else to the page's heading, never the body.
      giveBack.current?.();
      giveBack.current = null;
    }
  }, [open]);
  // Opened over a Radix sheet or dialog (a confirmation from inside one): that layer marks every sibling of itself aria-hidden, this <dialog>
  // included, so the question was hidden from assistive technology (and from role locators) although it is the one thing in reach. And its
  // Escape handler, on the document, would close the sheet below, not this. Both are put right while this dialog is open.
  useEffect(() => {
    const d = ref.current;
    if (!open || !d) return;
    const visible = () => d.removeAttribute("aria-hidden");
    visible();
    const watch = new MutationObserver(visible);
    watch.observe(d, { attributes: true, attributeFilter: ["aria-hidden"] });
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && e.target instanceof Node && d.contains(e.target) && document.querySelector("[role=dialog][data-state=open]")) e.stopPropagation();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      watch.disconnect();
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <dialog
      ref={(el) => {
        ref.current = el;
        setSelf(el);
      }}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
    >
      {open && (
        <div className="dialog-inner">
          <header className="dialog-header">
            <div className="dialog-heading">
              <h2 id={titleId}>{title}</h2>
              {description && (
                <p id={descId} className="dialog-description">
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label={t("Close")} onClick={onClose}>
              <Icon name="x" />
            </button>
          </header>
          {/* Menus and pop-ups opened inside are drawn inside the dialog: the page behind it is inert, so a portal to <body> would be dimmed and dead. */}
          <PortalContainer container={self}>
            <div className="dialog-body">{children}</div>
            {footer && <footer className="dialog-footer">{footer}</footer>}
          </PortalContainer>
        </div>
      )}
    </dialog>
  );
}

// ── a frame that scrolls sideways ──

/** A table's frame (`.table-wrap`): a table wider than it scrolls inside it, and only then does the frame take the
 *  keyboard (a focusable region with a name, so the arrow keys reach what is cut off). */
export function ScrollRegion({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setWide(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("table-wrap", className)} {...(wide ? { role: "region", tabIndex: 0, "aria-label": label ?? t("Table") } : {})}>
      {children}
    </div>
  );
}

// ── tabs (WAI-ARIA tabs pattern with arrow-key navigation) ──

export function Tabs({
  id,
  tabs,
  value,
  onChange,
}: {
  id: string;
  tabs: { id: string; label: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Narrow screens scroll the strip sideways: bring the selected tab into view (a link to a later tab).
  useEffect(() => {
    const s = strip.current;
    const t = s?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!s || !t) return;
    const [sr, tr] = [s.getBoundingClientRect(), t.getBoundingClientRect()];
    if (tr.left < sr.left || tr.right > sr.right) s.scrollLeft += tr.left - sr.left - 16;
  }, [value]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    const step = arrowStep(e);
    const next = step !== null ? i + step : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onChange(t.id);
    document.getElementById(`${id}-tab-${t.id}`)?.focus();
  };
  return (
    <div role="tablist" className="tabs" ref={strip} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${id}-tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`${id}-panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {typeof t.label === "string" ? isolate(t.label) : t.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, tab, children }: { id: string; tab: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} className="tabpanel">
      {children}
    </div>
  );
}

// ── states ──

/** A route's fallback: the shape of a page (a title, a line under it, a few rows) in quiet skeletons, named for assistive technology. */
export function PageLoading({ label = t("Loading…") }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="grid gap-4 motion-reduce:[&_[data-slot=skeleton]]:animate-none">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="grid gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 bg-card px-4 py-3">
              <Skeleton className={cn("h-4", ["w-1/4", "w-1/3", "w-1/5", "w-2/5", "w-1/4"][i])} />
              <Skeleton className="ms-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The states share one language: a soft rounded square with the icon, a title, one line of help, one action. */
export function EmptyState({ title, children, icon = "file" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="state">
      <span className="state-icon">
        <Icon name={icon} size={20} />
      </span>
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = t("Something went wrong") }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="state" role="alert">
      <span className="state-icon state-icon-error">
        <Icon name="alert" size={20} />
      </span>
      <p className="state-title">{title}</p>
      <p className="muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button icon="refresh" onClick={onRetry}>
          {t("Try again")}
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "info", children, action }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "success" ? "check" : tone === "info" ? "info" : "alert"} size={16} />
      <div className="alert-body">{children}</div>
      {action}
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn("UI error", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

// ── tiny global stores (toasts, confirm) ──

function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      subs.forEach((s) => s());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

type ToastItem = { id: number; message: string; tone: "success" | "error" | "info"; action?: ToastAction; duration: number };
/** A button in the toast ("Undo"): pressing it dismisses the toast and calls `onSelect` once. */
export interface ToastAction {
  label: string;
  onSelect: () => void;
}
export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds it stays. A toast with an action stays at least `ACTION_TOAST_MS` (8 s), so Undo can be reached. */
  duration?: number;
}
export const ACTION_TOAST_MS = 8000;
const toasts = createStore<ToastItem[]>([]);
let toastSeq = 0;

/** Shows a short message. `opts.action` adds one button (Undo); every destructive or filing action offers Undo for at least 8 seconds. */
export function toast(message: string, tone: ToastItem["tone"] = "success", opts: ToastOptions = {}): void {
  const id = ++toastSeq;
  const base = opts.duration ?? (tone === "error" ? 9000 : 4000);
  const duration = opts.action ? Math.max(base, ACTION_TOAST_MS) : base;
  toasts.set([...toasts.get(), { id, message, tone, action: opts.action, duration }].slice(-5));
}

function dismissToast(id: number) {
  toasts.set(toasts.get().filter((t) => t.id !== id));
}

// A sentence for assistive technology only, spoken by the toaster's live region. The key makes the same sentence speak again.
const spoken = createStore<{ text: string; n: number }>({ text: "", n: 0 });
/** Speaks a sentence politely without showing anything ("3 conversations moved to Trash"). Needs `Toaster` on the page. */
export function announce(message: string): void {
  spoken.set({ text: message, n: spoken.get().n + 1 });
}

// Where the stack sits: the bottom end unless a page says that corner is occupied. A page declares it with `useToastPlacement` (scoped
// to the component that mounts it: the last one mounted wins and the one before comes back when it unmounts) or, in markup, with
// `data-toast-placement="bottom-start | top-end"` on any element (styles.css).
export type ToastPlacement = "bottom-end" | "bottom-start" | "top-end";
const placements = createStore<{ id: number; value: ToastPlacement }[]>([]);
let placementSeq = 0;

/** While the calling component is mounted, notices sit at `placement` (a compose window at the bottom end asks for "bottom-start"). Phones keep them at the top. */
export function useToastPlacement(placement: ToastPlacement): void {
  useEffect(() => {
    const id = ++placementSeq;
    placements.set([...placements.get(), { id, value: placement }]);
    return () => placements.set(placements.get().filter((p) => p.id !== id));
  }, [placement]);
}

const TOAST_ICON: Record<ToastItem["tone"], string> = { success: "check", error: "alert", info: "info" };

/** One toast; its timer stops while the pointer is over it or focus is inside, and resumes with what was left. */
function ToastView({ n }: { n: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(n.duration);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(n.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, n.id]);
  const select = () => {
    if (!toasts.get().some((x) => x.id === n.id)) return;
    dismissToast(n.id);
    n.action?.onSelect();
  };
  return (
    <div
      className={`toast toast-${n.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
    >
      <span className="toast-icon">
        <Icon name={TOAST_ICON[n.tone]} size={16} />
      </span>
      <span className="toast-message">{n.message}</span>
      {n.action && (
        <Button size="sm" variant="ghost" className="toast-action" onClick={select}>
          {n.action.label}
        </Button>
      )}
      <button type="button" className="icon-btn icon-btn-sm" aria-label={t("Dismiss notification")} onClick={() => dismissToast(n.id)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(toasts.subscribe, toasts.get, toasts.get);
  const say = useSyncExternalStore(spoken.subscribe, spoken.get, spoken.get);
  const asked = useSyncExternalStore(placements.subscribe, placements.get, placements.get);
  return (
    <div className="toaster" role="status" aria-live="polite" data-placement={asked.at(-1)?.value}>
      {say.text && (
        <span key={say.n} className="sr-only">
          {say.text}
        </span>
      )}
      {list.map((n) => (
        <ToastView key={n.id} n={n} />
      ))}
    </div>
  );
}

interface ConfirmRequest {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Only to read: one button, no Cancel. */
  noCancel?: boolean;
  resolve: (ok: boolean) => void;
}
const confirmStore = createStore<ConfirmRequest | null>(null);

/** Asks the user to confirm; resolves to true when they do. */
export function confirmDialog(o: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  confirmStore.get()?.resolve(false);
  return new Promise((resolve) => confirmStore.set({ ...o, resolve }));
}

/** A way the person can confirm it is them, as the server lists theirs (docs/operations.md, "Asking again before sensitive work"). */
type StepUpWay = { way: "passkey" } | { way: "password"; code: boolean } | { way: "provider"; name: string };

/** The ways to offer, in the server's order: a passkey only where this browser can use one (`webauthn`), the password (`code`: the code
 *  from an authenticator app is asked too), signing in again with the provider by its name. Anything else, and a way said twice, is left
 *  out; no list at all (an older server's refusal): the password, as before. As the bar's runtime chooses (server/shell/runtime.js
 *  `stepUpChoices`). */
function stepUpChoices(ways: unknown, webauthn: boolean): StepUpWay[] {
  if (!Array.isArray(ways)) return [{ way: "password", code: false }];
  const out: StepUpWay[] = [];
  for (const w of ways as ({ way?: unknown; code?: unknown; name?: unknown } | null)[]) {
    if (out.some((o) => o.way === w?.way)) continue;
    if (w?.way === "passkey" && webauthn) out.push({ way: "passkey" });
    else if (w?.way === "password") out.push({ way: "password", code: w.code === true });
    else if (w?.way === "provider" && typeof w.name === "string" && w.name.trim()) out.push({ way: "provider", name: w.name.trim() });
  }
  return out;
}

/** The proof the small window's last page (`/api/auth/step-up/provider/done`) posts on the "ferrum-step-up" channel: `{state, code}` only
 *  when it comes from this page's own origin and names the request this dialog made (`dialog`, a value only the server and that page are
 *  told, never the provider), else null. What the bar's runtime checks (server/shell/runtime.js `providerProof`), no less. */
function providerProof(e: MessageEvent, dialog: string): { state: string; code: string } | null {
  const data: unknown = e.data;
  if (dialog.length < 16 || e.origin !== location.origin || data === null || typeof data !== "object") return null;
  const { dialog: named, state, code } = data as Record<string, unknown>;
  const token = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._-]{16,200}$/.test(v);
  return named === dialog && token(state) && token(code) ? { state, code } : null;
}

/** What the browser needs to confirm it is you with a passkey (`POST /api/auth/step-up/passkey/options`), its binary fields base64url. */
interface PasskeyOffer {
  request: string;
  publicKey: Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & { challenge: string; allowCredentials?: (Omit<PublicKeyCredentialDescriptor, "id"> & { id: string })[] };
}

/** Only a web address goes to the provider's window: until then it is this page's own (about:blank), where another kind would run as it. */
const webAddress = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/**
 * The person proves who they are again (docs/operations.md, "Asking again before sensitive work"), in the ways the server says they have,
 * in its order: a passkey, their password (with the code from their authenticator app when the server asks for it), or signing in again
 * with their identity provider in a small window. The ways come from `refusal`, the body of the `403` `step_up` being answered (the
 * kit's `ConfirmHost` passes it), or, opened without one, from `GET /api/auth/step-up/ways`. One way: just that; none: the server's
 * message and Close. While one way is tried the others wait; what went wrong is said in the dialog and every way can be used again.
 * Every step-up call's 401 is its own answer (`noAuthRedirect`), not an ended session. `message` says why where the caller knows; the
 * default is neutral. `onDone` once the server accepted a proof.
 */
export function ConfirmItsYou({ open, onClose, onDone, message, refusal }: { open: boolean; onClose: () => void; onDone: () => void; message?: string; refusal?: unknown }) {
  const formId = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  // `n` makes the same words said again (a second blocked window) a new alert, announced once more.
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<StepUpWay["way"] | null>(null);
  const [fetched, setFetched] = useState<{ ways?: unknown; message?: unknown } | null>(null);
  const [waiting, setWaiting] = useState<{ dialog: string; win: Window } | null>(null);
  const sending = useRef(false);
  const life = useRef<AbortController | null>(null);
  const popup = useRef<Window | null>(null);
  // What takes the focus once drawn: the first way ("first"), when the ways came after the dialog opened; the control of a failed try.
  const focusNext = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const say = (text: string) => setError((e) => ({ text, n: (e?.n ?? 0) + 1 }));
  const given = refusal !== null && typeof refusal === "object" ? (refusal as { ways?: unknown; message?: unknown }) : null;
  const answer = given ?? fetched;

  /** One try at a way: `run` resolves true once the server accepted a proof, false when it waits on something else (the window), or
   *  what to say. While it runs the other ways wait and nothing is sent twice; what went wrong is said once and every way can be used
   *  again. A try still going when the dialog closes is dropped. */
  const attempt = async (way: StepUpWay["way"], run: (signal: AbortSignal) => Promise<boolean | string>) => {
    const signal = life.current?.signal;
    if (sending.current || !signal || signal.aborted) return;
    sending.current = true;
    setBusy(way);
    setError(null);
    setNote(null);
    let said: string | null = null;
    try {
      const r = await run(signal);
      if (r === true && !signal.aborted) done.current();
      else if (typeof r === "string") said = r;
    } catch (e) {
      const name = (e as { name?: unknown } | null)?.name;
      said = e instanceof ApiError ? isolate(reason(e)) : name === "NotAllowedError" || name === "AbortError" ? t("No passkey was used.") : t("Could not confirm it is you. Try again.");
    }
    if (signal.aborted) return;
    sending.current = false;
    setBusy(null);
    if (!said) return;
    focusNext.current ??= `${formId}-${way}`;
    say(said);
  };

  // However the dialog closes (Cancel, Escape, a proof, the page going away), what it started ends: requests, the window, the channel.
  useEffect(() => {
    if (!open) return;
    const now = new AbortController();
    life.current = now;
    return () => {
      now.abort();
      sending.current = false;
      focusNext.current = null;
      try {
        popup.current?.close();
      } catch {
        // a window the provider's pages cut off from this one is not this page's to close
      }
      popup.current = null;
      setPassword("");
      setCode("");
      setNeedsCode(false);
      setError(null);
      setNote(null);
      setBusy(null);
      setFetched(null);
      setWaiting(null);
    };
  }, [open]);

  // Opened by a page itself, with no refusal to answer: the server says which ways the person has. Without its answer, the password.
  useEffect(() => {
    if (!open || given) return;
    const asking = new AbortController();
    const got = (r: { ways?: unknown; message?: unknown } | null) => {
      if (asking.signal.aborted) return;
      focusNext.current = "first";
      setFetched(r ?? {});
    };
    request<{ ways?: unknown; message?: unknown }>("/api/auth/step-up/ways", { noAuthRedirect: true, signal: asking.signal }).then(got, () => got(null));
    return () => asking.abort();
  }, [open, given]);

  // Signing in again: the proof comes on this origin's channel, whether or not the provider's pages cut the window off from this page.
  // Waiting does not hold the dialog (the person can try again, or another way). A closed window is said, and the channel is still heard
  // until the dialog closes: a window cut off from this page reads as closed while the person is still signing in.
  useEffect(() => {
    if (!waiting) return;
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("ferrum-step-up");
      channel.onmessage = (e) => {
        const proof = providerProof(e, waiting.dialog);
        if (!proof) return;
        setWaiting(null);
        void attempt("provider", async (signal) => {
          await api.post("/api/auth/step-up/provider/finish", proof, { noAuthRedirect: true, signal });
          return true;
        });
      };
    } catch {
      say(t("Could not confirm it is you. Try again."));
    }
    const watch = setInterval(() => {
      if (!waiting.win.closed) return;
      clearInterval(watch);
      setNote(null);
      say(t("If you closed the window before signing in again, try again."));
    }, 700);
    return () => {
      channel?.close();
      clearInterval(watch);
    };
  }, [waiting]);

  // The focus follows the ways: to the first once they come, back to the control of a failed try (its words selected) once usable again.
  useEffect(() => {
    const next = focusNext.current;
    if (!next || busy) return;
    focusNext.current = null;
    const el = next === "first" ? form.current?.closest("dialog")?.querySelector<HTMLElement>("[data-autofocus]") : document.getElementById(next);
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  });

  const webauthn = typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;
  const choices = answer ? stepUpChoices(answer.ways, webauthn) : null;
  const pwd = choices?.find((c): c is Extract<StepUpWay, { way: "password" }> => c.way === "password");
  const askCode = needsCode || !!pwd?.code;
  const listed = answer && Array.isArray(answer.ways) ? (answer.ways as unknown[]) : [];
  const server = typeof answer?.message === "string" && answer.message.trim() ? isolate(answer.message) : null;
  // None to offer: why, in the server's words, unless what it lists is a passkey this browser cannot use.
  const why =
    choices?.length !== 0 ? (message ?? t("To continue, confirm it is you."))
    : listed.some((w) => (w as { way?: unknown } | null)?.way === "passkey") ? t("This browser cannot use a passkey, your only way to confirm it is you here. Use another browser, or ask an administrator.")
    : (server ?? t("You have no way to confirm it is you here. Ask an administrator to set one up for you."));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pwd) return;
    void attempt("password", async (signal) => {
      try {
        await api.post("/api/auth/step-up", { password, code: askCode ? code.trim() : undefined }, { noAuthRedirect: true, signal });
        return true;
      } catch (err) {
        // The server asks for the code by refusing without it (422 naming `code`): the field appears and takes the focus.
        const forCode = err instanceof ApiError && err.fields.some((f) => f.field === "code");
        if (forCode) setNeedsCode(true);
        if (!signal.aborted) focusNext.current = `${formId}-${forCode ? "code" : "password"}`;
        throw err;
      }
    });
  };
  const tryPasskey = () =>
    void attempt("passkey", async (signal) => {
      const offer = await api.post<PasskeyOffer>("/api/auth/step-up/passkey/options", undefined, { noAuthRedirect: true, signal });
      const o = offer.publicKey;
      const cred = (await navigator.credentials.get({
        publicKey: { ...o, challenge: b64.decode(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: b64.decode(c.id) })) },
        signal,
      })) as PublicKeyCredential | null;
      if (!cred) return t("No passkey was used.");
      const a = cred.response as AuthenticatorAssertionResponse;
      const response = { clientDataJSON: b64.encode(a.clientDataJSON), authenticatorData: b64.encode(a.authenticatorData), signature: b64.encode(a.signature), userHandle: a.userHandle ? b64.encode(a.userHandle) : null };
      await api.post("/api/auth/step-up/passkey", { request: offer.request, credential: { id: cred.id, rawId: b64.encode(cred.rawId), type: cred.type, response } }, { noAuthRedirect: true, signal });
      return true;
    });
  // The window is opened by the click itself, before anything is awaited (the click is what lets a page open one), and cut off from this
  // page before it goes anywhere. `dialog` is this dialog's own value, which the proof must carry back.
  const trySignInAgain = () => {
    if (sending.current) return;
    const w = window.open("about:blank", "ferrum-step-up", "popup,width=520,height=680");
    if (!w) {
      setNote(null);
      return say(t("The window was blocked. Allow pop-ups for this site, then try again."));
    }
    try {
      w.opener = null;
    } catch {
      // nothing to cut
    }
    popup.current = w;
    const dialog = b64.encode(crypto.getRandomValues(new Uint8Array(18)).buffer);
    void attempt("provider", async (signal) => {
      let url: unknown;
      try {
        url = (await api.post<{ url?: unknown }>("/api/auth/step-up/provider", { dialog }, { noAuthRedirect: true, signal }))?.url;
      } finally {
        if (!webAddress(url)) w.close();
      }
      if (!webAddress(url)) return t("Could not confirm it is you. Try again.");
      if (w.closed) return t("If you closed the window before signing in again, try again.");
      w.location.replace(url);
      setWaiting({ dialog, win: w });
      setNote(t("Finish signing in again in the window that opened."));
      return false;
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Confirm it is you")}
      description={why}
      footer={
        <>
          <Button onClick={onClose} data-autofocus={choices?.length === 0 || undefined}>
            {choices?.length === 0 ? t("Close") : t("Cancel")}
          </Button>
          {pwd && (
            <Button variant={choices?.[0] === pwd ? "primary" : "default"} type="submit" form={formId} loading={busy === "password"} disabled={!!busy}>
              {t("Confirm")}
            </Button>
          )}
        </>
      }
    >
      <form id={formId} ref={form} className="stack" onSubmit={submit}>
        {!choices ? (
          <div role="status" aria-label={t("Loading…")} className="motion-reduce:[&_[data-slot=skeleton]]:animate-none">
            <div aria-hidden="true">
              <Skeleton className="h-(--control-h) w-full" />
            </div>
          </div>
        ) : (
          choices.map((c, i) => (
            <Fragment key={c.way}>
              {i > 0 && <p className="muted text-center">{t("Or")}</p>}
              {c.way === "password" ? (
                <div className="stack">
                  <Field label={t("Password")} htmlFor={`${formId}-password`}>
                    <input id={`${formId}-password`} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={!!busy && busy !== "password"} data-autofocus={i === 0 || undefined} />
                  </Field>
                  {askCode && (
                    <Field label={t("Code from your authenticator app")} htmlFor={`${formId}-code`}>
                      <input id={`${formId}-code`} className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required disabled={!!busy && busy !== "password"} />
                    </Field>
                  )}
                </div>
              ) : (
                <Button id={`${formId}-${c.way}`} className="w-full" variant={i === 0 ? "primary" : "default"} loading={busy === c.way} disabled={!!busy} onClick={c.way === "passkey" ? tryPasskey : trySignInAgain} data-autofocus={i === 0 || undefined}>
                  {c.way === "passkey" ? t("Use a passkey") : t("Sign in again with {name}", { name: c.name })}
                </Button>
              )}
            </Fragment>
          ))
        )}
        {error && (
          <Alert key={error.n} tone="error">
            {error.text}
          </Alert>
        )}
        {note && <Alert tone="info">{note}</Alert>}
      </form>
    </Dialog>
  );
}

/** Answers the client's step-up refusals (403 `step_up`) with one dialog, however many requests were refused, in the ways the first
 *  refusal lists; true when the person proved it. */
function StepUpHost() {
  const [waiting, setWaiting] = useState<{ refusal: unknown; done: (ok: boolean) => void } | null>(null);
  const resolve = useRef(waiting);
  resolve.current = waiting;
  useEffect(() => {
    setStepUpHandler((refusal) => new Promise<boolean>((done) => setWaiting({ refusal, done })));
    return () => {
      setStepUpHandler(null);
      resolve.current?.done(false);
    };
  }, []);
  const close = (ok: boolean) => {
    waiting?.done(ok);
    setWaiting(null);
  };
  return <ConfirmItsYou open={!!waiting} refusal={waiting?.refusal} onClose={() => close(false)} onDone={() => close(true)} />;
}

export function ConfirmHost() {
  const req = useSyncExternalStore(confirmStore.subscribe, confirmStore.get, confirmStore.get);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    confirmStore.set(null);
  };
  return (
    <>
    <Dialog
      open={!!req}
      onClose={() => close(false)}
      title={isolate(req?.title ?? "")}
      footer={
        <>
          {!req?.noCancel && <Button onClick={() => close(false)}>{req?.cancelLabel ?? t("Cancel")}</Button>}
          <Button variant={req?.danger ? "danger" : "primary"} data-autofocus onClick={() => close(true)}>
            {req?.confirmLabel ?? t("Confirm")}
          </Button>
        </>
      }
    >
      {req?.message && <div className="confirm-message">{req.message}</div>}
    </Dialog>
    <StepUpHost />
    </>
  );
}

// ── hooks ──

/** Calls `onDismiss` on a press outside `ref` or on Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    // Pointer, not mouse, events: iOS Safari sends no mousedown for a tap on a non-interactive element.
    // A mouse dismisses on press; touch and pen on release, as a drag that scrolls ends in pointercancel instead.
    const onPointer = (e: PointerEvent) => {
      if ((e.pointerType === "mouse") !== (e.type === "pointerdown")) return;
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("pointerup", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("pointerup", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A button that opens a small menu (user menu, overflow actions). */
export function Menu({
  label,
  ariaLabel,
  icon,
  children,
  align = "end",
  buttonClass = "btn btn-default btn-md",
}: {
  label?: ReactNode;
  /** Accessible name for icon-only menu buttons. */
  ariaLabel?: string;
  icon?: string;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  buttonClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useDismiss(ref, open, () => setOpen(false));
  // The list is placed against the trigger before it is painted (below it or above it, shifted and clamped 8px inside the window, its height
  // capped to the room with its own scroll) and again when the window or any scroller moves, so it never leaves the screen.
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    const btn = trigger.current;
    if (!open || !el || !btn) return;
    const place = () => {
      Object.assign(el.style, { position: "fixed", insetInlineEnd: "auto", insetInlineStart: "auto", right: "auto", bottom: "auto", maxHeight: "none", overflowY: "auto" });
      const r = btn.getBoundingClientRect();
      const p = placeMenu(r, { width: el.offsetWidth, height: el.scrollHeight + (el.offsetHeight - el.clientHeight) }, { width: document.documentElement.clientWidth, height: window.innerHeight }, { align, rtl: getComputedStyle(btn).direction === "rtl" });
      Object.assign(el.style, { left: `${p.left}px`, top: `${p.top}px`, maxHeight: `${p.maxHeight}px` });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);
  // Closing from inside the menu (Escape, choosing an item) hands focus back to the button that opened it, so the keyboard keeps its place
  // and a dialog an item opens returns there when it closes.
  const closeFromInside = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      closeFromInside();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <div className="menu" ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className={buttonClass}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        {icon && <Icon name={icon} />}
        {label}
      </button>
      {open && (
        <div ref={list} className={`menu-list menu-${align}`} role="menu" id={menuId}>
          {children(closeFromInside)}
        </div>
      )}
    </div>
  );
}

/** `refusal`: why it cannot be chosen now. It stays in the menu, reachable by keyboard, says so in words, and does nothing. */
export function MenuItem({ onSelect, children, danger, refusal }: { onSelect: () => void; children: ReactNode; danger?: boolean; refusal?: string | null }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${danger ? "menu-item-danger" : ""}`} aria-disabled={refusal ? true : undefined} onClick={refusal ? undefined : onSelect}>
      {children}
      {refusal && <span className="menu-item-why">{refusal}</span>}
    </button>
  );
}
