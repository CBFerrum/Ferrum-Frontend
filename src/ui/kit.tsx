// The design system: small, accessible building blocks styled by styles.css.

import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { errorMessage } from "../lib/api";

// ── icons ──

const ICONS: Record<string, string> = {
  menu: "M3 6h18M3 12h18M3 18h18",
  x: "M18 6 6 18M6 6l12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
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
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  check: "M20 6 9 17l-5-5",
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
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

const TONES: [RegExp, Tone][] = [
  [/^(draft|open|pending|not started|to bill|to deliver)/i, "neutral"],
  [/(cancel|reject|overdue|dead|fail|lost|disabled|inactive|locked)/i, "red"],
  [/(unpaid|partly|partial|hold|return|waiting|due)/i, "amber"],
  [/(paid|submitted|completed|closed|delivered|received|approved|active|done|verified)/i, "green"],
];

/** Picks a badge tone for a status-like value. */
export function statusTone(value: unknown): Tone {
  const s = String(value ?? "");
  return TONES.find(([re]) => re.test(s))?.[1] ?? "blue";
}

// ── form field wrapper ──

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
  return (
    <div className={`field ${error ? "field-invalid" : ""} ${className ?? ""}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>
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
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() would focus the header's close button; prefer the marked or first field instead.
      const first = d.querySelector<HTMLElement>("[data-autofocus]") ?? d.querySelector<HTMLElement>(".dialog-body :is(input, select, textarea):not([disabled])");
      first?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby={titleId}
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
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
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
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
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
          {t.label}
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

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state">
      <Spinner label={label} />
      <span className="muted">{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, icon = "file" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="state">
      <span className="state-icon">
        <Icon name={icon} size={28} />
      </span>
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="state" role="alert">
      <span className="state-icon state-icon-error">
        <Icon name="alert" size={28} />
      </span>
      <p className="state-title">{title}</p>
      <p className="muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "info", children, action }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
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

type ToastItem = { id: number; message: string; tone: "success" | "error" | "info" };
const toasts = createStore<ToastItem[]>([]);
let toastSeq = 0;

export function toast(message: string, tone: ToastItem["tone"] = "success"): void {
  const id = ++toastSeq;
  toasts.set([...toasts.get(), { id, message, tone }].slice(-5));
  setTimeout(() => dismissToast(id), tone === "error" ? 9000 : 4000);
}

function dismissToast(id: number) {
  toasts.set(toasts.get().filter((t) => t.id !== id));
}

export function Toaster() {
  const list = useSyncExternalStore(toasts.subscribe, toasts.get);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.message}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
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
  resolve: (ok: boolean) => void;
}
const confirmStore = createStore<ConfirmRequest | null>(null);

/** Asks the user to confirm; resolves to true when they do. */
export function confirmDialog(o: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  confirmStore.get()?.resolve(false);
  return new Promise((resolve) => confirmStore.set({ ...o, resolve }));
}

export function ConfirmHost() {
  const req = useSyncExternalStore(confirmStore.subscribe, confirmStore.get);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    confirmStore.set(null);
  };
  return (
    <Dialog
      open={!!req}
      onClose={() => close(false)}
      title={req?.title ?? ""}
      footer={
        <>
          <Button onClick={() => close(false)}>{req?.cancelLabel ?? "Cancel"}</Button>
          <Button variant={req?.danger ? "danger" : "primary"} data-autofocus onClick={() => close(true)}>
            {req?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {req?.message && <div className="confirm-message">{req.message}</div>}
    </Dialog>
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
  const menuId = useId();
  useDismiss(ref, open, () => setOpen(false));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
        <div className={`menu-list menu-${align}`} role="menu" id={menuId}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, children, danger }: { onSelect: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${danger ? "menu-item-danger" : ""}`} onClick={onSelect}>
      {children}
    </button>
  );
}
