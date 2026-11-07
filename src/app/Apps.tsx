// Apps: what this workspace has installed, the store, and uploads (docs/plan/apps.md).
// Installing always goes through a plan (dependencies, permissions) and an explicit consent.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, errorMessage } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { useMe } from "../lib/meta";
import { useContributions } from "../lib/screens";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Field, Icon, PageLoading, TabPanel, Tabs, toast } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";

export interface AppSummary {
  id: string;
  name: string;
  version: string;
  runtime: "native" | "wasm" | "meta" | "service";
  summary: string;
  categories?: string[];
  publisher?: string;
  verified?: boolean;
  icon_url?: string | null;
  source?: string;
  private?: boolean;
  /** The app this one is an add-on of. */
  parent?: string | null;
}

/** Apps in order with their add-ons under them (`parent`), and how deep each sits. */
export function byParent<T extends { id: string; parent?: string | null }>(apps: T[]): { app: T; depth: number }[] {
  const ids = new Set(apps.map((a) => a.id));
  const out: { app: T; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of apps.filter((x) => (x.parent && ids.has(x.parent) ? x.parent : null) === parent)) {
      out.push({ app: a, depth });
      if (depth < 4) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
interface Installed extends AppSummary {
  enabled: boolean;
  installed_at: string;
  update?: { version: string } | null;
  settings_url?: string | null;
}
export interface AppsResponse {
  installed: Installed[];
  available: AppSummary[];
  uploads: "off" | "private" | "cluster";
  platform: string;
  stores: { url: string; ok: boolean; error?: string | null }[];
}
/** What the store or upload says an app may do; rendered generically, section by section. */
export type Permissions = Record<string, unknown>;
interface Plan {
  app: AppSummary & {
    description?: string | null;
    license?: string | null;
    homepage?: string | null;
    /** Pictures of the app, where this server or its store serves them. */
    screenshots?: string[];
    /** Its interface runs isolated: a bundle the server does not trust, private to the workspace. */
    isolated?: boolean;
    /** An industrial solution's equipment: what the app describes, not what anyone tried with it. */
    equipment?: { connectors: string[]; profiles: { vendor: string; model: string; scheme: string }[]; acceptance: string[] };
  };
  steps: { id: string; name?: string; version: string; action: "install" | "upgrade" | "already"; source: string }[];
  permissions: Permissions;
  digest: string;
  increases?: string[];
  warnings?: string[];
  uninstall?: "keep" | "ask";
  /** The apps it brings that a store sells: each installs only once its licence is live. */
  licences?: LicenceNeed[];
}

/** A sold app's licence, as its store last said of the one this workspace gave. */
interface LicenceNeed {
  app: string;
  store: string;
  given: boolean;
  live: boolean;
  period_end?: string | null;
  last_error?: string | null;
}

const LICENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The host a store is at, as people read it. */
export function storeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A sold app's licence in the install dialog: live, or a field for the one bought in its store. */
export function LicenceNeeded({ need, onGiven }: { need: LicenceNeed; onGiven: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (need.live) {
    return <p className="muted">{tr("{app}'s licence is live{value}.", { app: need.app, value: need.period_end ? ` until ${formatDate(need.period_end.slice(0, 10))}` : "" })}</p>;
  }
  const give = async (e: FormEvent) => {
    e.preventDefault();
    const licence = value.trim();
    if (!LICENCE.test(licence)) {
      setError("A licence is the id shown on Your purchases in the store, such as 0f2c6a1e-…");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/apps/${need.app}/licence`, { licence });
      toast(tr("{app}'s licence kept", { app: need.app }));
      onGiven();
    } catch (err) {
      setError(errorMessage(err, false));
    } finally {
      setBusy(false);
    }
  };
  const given = need.given ? ` The licence given ${need.last_error ? `could not be checked: ${need.last_error}` : "has lapsed: renew it in the store"}.` : "";
  return (
    <form className="stack" onSubmit={(e) => void give(e)}>
      <Alert tone="info">{tr("{app} is sold in the store at {value}: give the licence you bought for this workspace, from Your purchases there.{given}", { app: need.app, value: storeHost(need.store), given })}</Alert>
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <Field label={tr("Licence for {app}", { app: need.app })}>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} required />
      </Field>
      <div className="row">
        <Button type="submit" icon="check" loading={busy}>
          {tr("Give the licence")}
        </Button>
      </div>
    </form>
  );
}

const RUNTIME_LABEL = { get native() { return tr("Built in"); }, get wasm() { return tr("Sandboxed"); }, get meta() { return tr("No code"); }, get service() { return tr("Runs elsewhere"); } } as const;
const RUNTIME_TONE = { native: "purple", wasm: "green", meta: "neutral", service: "blue" } as const;

/** Words for a permission section key: `entities` → "Entities". */
export function sectionLabel(key: string): string {
  if (key === "native") return "Built into the server";
  if (key === "services") return "Runs outside Ferrum, as an account of its own, at";
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lines describing one permission section, whatever its JSON shape. */
export function permissionLines(value: unknown, key?: string): string[] {
  if (value == null || value === false) return [];
  if (value === true) return [key === "native" ? "It runs in the server itself, not in a sandbox" : "Yes"];
  if (Array.isArray(value)) return value.flatMap((v) => (typeof v === "object" && v ? [describeObject(v as Record<string, unknown>)] : [String(v)]));
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? describeObject(v as Record<string, unknown>) : String(v)}`);
  return [String(value)];
}

function describeObject(o: Record<string, unknown>): string {
  const name = o.entity ?? o.path ?? o.host ?? o.name ?? o.topic ?? o.id;
  const flags = Object.entries(o)
    .filter(([k, v]) => k !== "entity" && k !== "path" && k !== "host" && k !== "name" && k !== "topic" && k !== "id" && v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k} ${Array.isArray(v) ? v.join("/") : String(v)}`));
  return [name, flags.join(", ")].filter(Boolean).join(" — ");
}

export function PermissionList({ permissions }: { permissions: Permissions }) {
  const sections = Object.entries(permissions).filter(([k, v]) => permissionLines(v, k).length > 0);
  if (!sections.length) return <p className="muted">{tr("This app asks for no access beyond its own records.")}</p>;
  return (
    <dl className="kv">
      {sections.map(([k, v]) => (
        <div key={k}>
          <dt>{isolate(sectionLabel(k))}</dt>
          <dd>
            {permissionLines(v, k).map((l) => (
              <div key={l}>{isolate(l)}</div>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AppIcon({ app }: { app: AppSummary }) {
  if (app.icon_url) return <img className="app-icon" src={app.icon_url} alt="" />;
  return (
    <span className="app-icon app-icon-letter" aria-hidden="true">
      {isolate(app.name.slice(0, 2))}
    </span>
  );
}

export function AppCard({ app, children, onOpen, addonOf }: { app: AppSummary; children?: ReactNode; onOpen?: () => void; addonOf?: string }) {
  return (
    <article className={addonOf ? "app-card app-addon" : "app-card"}>
      <div className="app-card-head">
        <AppIcon app={app} />
        <div style={{ minWidth: 0 }}>
          <h3 className="app-name">
            {onOpen ? (
              <button type="button" className="link-btn" onClick={onOpen}>
                {isolate(app.name)}
              </button>
            ) : (
              app.name
            )}
          </h3>
          <div className="faint app-meta">
            v{isolate(app.version)}
            {app.publisher && <> · {isolate(app.publisher)}</>}
            {app.verified && (
              <>
                {isolate(" ")}
                <Badge tone="blue">{tr("Verified")}</Badge>
              </>
            )}
          </div>
        </div>
      </div>
      {addonOf && <div className="faint app-meta">{tr("Add-on of {addonOf}", { addonOf })}</div>}
      <p className="muted app-summary">{isolate(app.summary)}</p>
      <div className="chips">
        <Badge tone={RUNTIME_TONE[app.runtime] ?? "neutral"}>{RUNTIME_LABEL[app.runtime] ?? app.runtime}</Badge>
        {app.private && <Badge tone="amber">{tr("Private")}</Badge>}
        {(app.categories ?? []).slice(0, 2).map((c) => (
          <Badge key={c}>{isolate(c)}</Badge>
        ))}
      </div>
      {children && <div className="row app-actions">{children}</div>}
    </article>
  );
}

export function AppsPage() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const tab = ["installed", "store", "upload"].includes(sp.get("tab") ?? "") ? (sp.get("tab") as string) : "installed";
  const q = useQuery({ queryKey: ["apps"], queryFn: ({ signal }) => api.get<AppsResponse>("/api/admin/apps", undefined, signal) });
  const [planFor, setPlanFor] = useState<{ id: string; version?: string; upgrade?: boolean } | null>(null);

  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Ask an administrator to install or remove apps.")}</p>
      </EmptyState>
    );
  }
  const tabs = [
    { id: "installed", label: tr("Installed{value}", { value: q.data ? ` (${q.data.installed.length})` : "" }) },
    { id: "store", label: tr("Store") },
    ...(q.data && q.data.uploads !== "off" ? [{ id: "upload", label: tr("Upload") }] : []),
  ];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{tr("Apps")}</h1>
          <p className="page-sub">{tr("Add features to this workspace — each app asks before it gets access.")}</p>
        </div>
      </div>
      <Tabs id="apps" tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      <TabPanel id="apps" tab={tab}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <PageLoading />
        ) : tab === "installed" ? (
          <InstalledApps data={q.data} onInstall={setPlanFor} />
        ) : tab === "store" ? (
          <Store data={q.data} onInstall={setPlanFor} />
        ) : (
          <Upload data={q.data} onUploaded={(id, version) => setPlanFor({ id, version })} />
        )}
      </TabPanel>
      <InstallDialog request={planFor} onClose={() => setPlanFor(null)} />
    </div>
  );
}

function InstalledApps({ data, onInstall }: { data: AppsResponse; onInstall: (r: { id: string; version?: string; upgrade?: boolean }) => void }) {
  const qc = useQueryClient();
  // Sold apps whose store no longer says their licence is live: what is installed stays, not upgraded.
  const licences = useQuery({
    queryKey: ["apps", "licences"],
    queryFn: ({ signal }) => api.get<{ licences: (LicenceNeed & { app: string })[] }>("/api/admin/apps/licences", undefined, signal),
  });
  const lapsed = new Map((licences.data?.licences ?? []).filter((l) => !l.live).map((l) => [l.app, l.last_error ?? "Its store says the licence has lapsed: renew it there."]));
  const [busy, setBusy] = useState<string | null>(null);
  const settings = new Set((useContributions("ui.settings").data ?? []).map((c) => c.app));
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["apps"] }), qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["contributions"] })]);
  const toggle = async (a: Installed) => {
    setBusy(a.id);
    try {
      await api.post(`/api/admin/apps/${a.id}/${a.enabled ? "disable" : "enable"}`);
      toast(`${a.name} ${a.enabled ? "disabled" : "enabled"}`);
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const uninstall = async (a: Installed) => {
    const ok = await confirmDialog({
      title: tr("Remove {name}?", { name: a.name }),
      message: tr("Its menus, roles and automations go away for everyone in this workspace. Records it created are kept unless you also delete its data below."),
      confirmLabel: tr("Remove"),
      danger: true,
    });
    if (!ok) return;
    const deleteData = await confirmDialog({
      title: tr("Also delete {name}'s data?", { name: a.name }),
      message: tr("Deleting removes every record this app stores, for this workspace only. This cannot be undone. Choose Keep to leave the data in place."),
      confirmLabel: tr("Delete data"),
      cancelLabel: tr("Keep data"),
      danger: true,
    });
    setBusy(a.id);
    try {
      const r = await api.del<{ leftovers?: string[] }>(`/api/admin/apps/${a.id}${deleteData ? "?delete_data=true" : ""}`);
      toast(tr("{name} removed", { name: a.name }));
      // What it brought in (a suite's members) and nothing else needs: offered for removal too.
      const left = r?.leftovers ?? [];
      const name = (id: string) => data.installed.find((x) => x.id === id)?.name ?? id;
      if (
        left.length &&
        (await confirmDialog({
          title: tr("Also remove what {name} brought in?", { name: a.name }),
          message: tr("Nothing else needs {value}. Their records are kept.", { value: left.map(name).join(", ") }),
          confirmLabel: tr("Remove them"),
          cancelLabel: tr("Keep them"),
          danger: true,
        }))
      ) {
        for (const id of left) {
          await api.del(`/api/admin/apps/${id}`);
        }
        toast(tr("{value} removed", { value: left.map(name).join(", ") }));
      }
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  if (!data.installed.length) {
    return (
      <EmptyState title={tr("No apps installed")} icon="apps">
        <p className="muted">{tr("Open the Store tab to add CRM, Helpdesk, HR, POS and more.")}</p>
      </EmptyState>
    );
  }
  return (
    <div className="app-grid">
      {byParent(data.installed).map(({ app: a, depth }) => (
        <AppCard key={a.id} app={a} addonOf={depth ? (data.installed.find((p) => p.id === a.parent)?.name ?? a.parent ?? undefined) : undefined}>
          <label className="check-field" style={{ minHeight: 0 }}>
            <input type="checkbox" checked={a.enabled} disabled={busy === a.id} onChange={() => void toggle(a)} /> {tr("Enabled")}
          </label>
          {lapsed.has(a.id) && (
            <Badge tone="amber" title={lapsed.get(a.id)}>
              {tr("Licence lapsed")}
            </Badge>
          )}
          <span className="spacer" />
          {a.enabled && settings.has(a.id) && (
            <Link className="btn btn-default btn-sm" to={`/apps/${a.id}/settings`}>
              {tr("Settings")}
            </Link>
          )}
          {a.update && (
            <Button size="sm" variant="primary" icon="upload" onClick={() => onInstall({ id: a.id, version: a.update!.version, upgrade: true })}>
              {tr("Update to {version}", { version: a.update.version })}
            </Button>
          )}
          <Button size="sm" variant="danger" icon="trash" aria-label={tr("Remove {name}", { name: a.name })} disabled={busy === a.id} onClick={() => void uninstall(a)} />
          <span className="faint app-installed">{tr("Installed {value}", { value: formatDateTime(a.installed_at) })}</span>
        </AppCard>
      ))}
    </div>
  );
}

const CATEGORIES = [
  "suite",
  "sales",
  "crm",
  "support",
  "hr",
  "finance",
  "inventory",
  "projects",
  "commerce",
  "pos",
  "communication",
  "productivity",
  "marketing",
  "integrations",
  "connector",
  "localization",
  "energy",
  "industry",
];

function Store({ data, onInstall }: { data: AppsResponse; onInstall: (r: { id: string; version?: string }) => void }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const installed = new Set(data.installed.map((a) => a.id));
  const store = useQuery({
    queryKey: ["apps", "store", query, category],
    queryFn: ({ signal }) => api.get<{ apps: AppSummary[] }>("/api/admin/apps/store", { q: query || undefined, category: category || undefined }, signal),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(text.trim());
  };
  return (
    <div className="stack">
      {data.stores.some((s) => !s.ok) && (
        <Alert tone="warning">
          {isolate(data.stores
            .filter((s) => !s.ok)
            .map((s) => `${s.url}: ${s.error ?? "unreachable"}`)
            .join("; "))}{isolate(" ")}
          {tr("— showing apps already available on this server.")}
        </Alert>
      )}
      <form className="row" role="search" onSubmit={submit}>
        <input className="input" type="search" placeholder={tr("Search apps…")} aria-label={tr("Search apps")} value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <Button type="submit" icon="search">
          {tr("Search")}
        </Button>
      </form>
      <div className="chips" role="group" aria-label={tr("Categories")}>
        <button type="button" className="chip" aria-pressed={!category} onClick={() => setCategory("")}>
          {tr("All")}
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? "" : c)}>
            {isolate(sectionLabel(c))}
          </button>
        ))}
      </div>
      {store.error ? (
        <ErrorState error={store.error} onRetry={() => store.refetch()} />
      ) : store.isLoading ? (
        <PageLoading />
      ) : !store.data?.apps.length ? (
        <EmptyState title={tr("No apps found")} icon="search" />
      ) : (
        <div className="app-grid">
          {store.data.apps.map((a) => (
            <AppCard key={a.id} app={a} onOpen={() => onInstall({ id: a.id })}>
              <span className="spacer" />
              {installed.has(a.id) ? (
                <Badge tone="green">{tr("Installed")}</Badge>
              ) : (
                <Button size="sm" variant="primary" icon="plus" onClick={() => onInstall({ id: a.id })}>
                  {tr("Install")}
                </Button>
              )}
            </AppCard>
          ))}
        </div>
      )}
    </div>
  );
}

function Upload({ data, onUploaded }: { data: AppsResponse; onUploaded: (id: string, version: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return setError("App bundles are limited to 50 MB.");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("bundle", file);
      const r = await api.post<{ app: AppSummary }>("/api/admin/apps/upload", fd);
      onUploaded(r.app.id, r.app.version);
    } catch (err) {
      setError(errorMessage(err, false));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card stack" style={{ padding: 16, maxWidth: 640 }} onSubmit={submit}>
      <p>
        {tr("Upload an app bundle (")}<span className="mono">{tr(".fapp")}</span>{tr(") built with")} <span className="mono">{tr("ferrum-app pack")}</span>.{isolate(" ")}
        {data.uploads === "private"
          ? tr("Uploaded apps stay private to this workspace and run sandboxed; apps that bring their own tables must come from the store.")
          : tr("Uploaded apps become available on this server; you review their permissions before installing.")}
      </p>
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <input type="file" accept=".fapp,application/gzip" aria-label={tr("App bundle")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button type="submit" variant="primary" icon="upload" loading={busy} disabled={!file}>
          {tr("Upload and review")}
        </Button>
      </div>
    </form>
  );
}

export function InstallDialog({
  request,
  onClose,
  onInstalled,
}: {
  request: { id: string; version?: string; upgrade?: boolean } | null;
  onClose: () => void;
  onInstalled?: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = useQuery({
    queryKey: ["apps", "plan", request?.id, request?.version],
    enabled: !!request,
    queryFn: ({ signal }) => api.get<Plan>(`/api/admin/apps/${request!.id}/plan`, { version: request!.version }, signal),
    staleTime: 0,
    gcTime: 0,
  });
  const close = () => {
    setError(null);
    onClose();
  };
  const install = async () => {
    if (!request || !plan.data) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/apps/${request.id}/${request.upgrade ? "upgrade" : "install"}`, { version: plan.data.app.version, consent: plan.data.digest });
      toast(`${plan.data.app.name} ${request.upgrade ? "updated" : "installed"}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ["apps"] }), qc.invalidateQueries({ queryKey: ["meta"] })]);
      close();
      onInstalled?.();
    } catch (e) {
      setError(errorMessage(e, false));
    } finally {
      setBusy(false);
    }
  };
  const p = plan.data;
  const unlicensed = (p?.licences ?? []).filter((l) => !l.live);
  return (
    <Dialog open={!!request} onClose={close} title={p ? `${request?.upgrade ? "Update" : "Install"} ${p.app.name}` : tr("App")} wide>
      {plan.isLoading ? (
        <PageLoading label={tr("Checking the app…")} />
      ) : plan.error ? (
        <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
      ) : p ? (
        <div className="stack">
          {error && <Alert tone="error">{isolate(error)}</Alert>}
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <AppIcon app={p.app} />
            <div style={{ minWidth: 0 }}>
              <strong>{isolate(p.app.name)}</strong> <span className="faint">v{isolate(p.app.version)}</span>
              <p className="muted">{isolate(p.app.summary)}</p>
              <div className="chips">
                <Badge tone={RUNTIME_TONE[p.app.runtime] ?? "neutral"}>{RUNTIME_LABEL[p.app.runtime] ?? p.app.runtime}</Badge>
                {p.app.license && <Badge>{isolate(p.app.license)}</Badge>}
                {p.app.publisher && <Badge>{isolate(p.app.publisher)}</Badge>}
                {p.app.isolated && (
                  <Badge tone="amber" title={tr("Its interface runs in a frame of its own, without your session")}>
                    {tr("Isolated")}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {!!p.app.screenshots?.length && (
            <div className="app-shots" role="list" aria-label={tr("Pictures of {name}", { name: p.app.name })}>
              {p.app.screenshots.map((src, i) => (
                <a key={src} role="listitem" href={src} target="_blank" rel="noopener noreferrer">
                  <img src={src} alt={tr("{name}, picture {value}", { name: p.app.name, value: i + 1 })} loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {p.app.description && <p className="comment-text">{isolate(p.app.description)}</p>}
          {p.app.equipment && (
            <div>
              <h3 className="field-label">{tr("Equipment it describes")}</h3>
              <ul>
                {p.app.equipment.profiles.map((e) => (
                  <li key={`${e.vendor}|${e.model}|${e.scheme}`}>
                    {isolate(e.vendor)} {isolate(e.model)} <span className="faint">({isolate(e.scheme)})</span>
                  </li>
                ))}
              </ul>
              {p.app.equipment.acceptance.length > 0 && (
                <p className="muted">{tr("Before a device of these is commissioned, it passes on site: {value}.", { value: p.app.equipment.acceptance.join(", ") })}</p>
              )}
              <p className="faint">{tr("What the app describes, not what anyone tried with it.")}</p>
            </div>
          )}
          {p.steps.filter((s) => s.action !== "already").length > 1 && (
            <div>
              <h3 className="field-label">{tr("Also installs")}</h3>
              <ul>
                {p.steps
                  .filter((s) => s.action !== "already" && s.id !== p.app.id)
                  .map((s) => (
                    <li key={s.id}>
                      {s.name || s.id} {isolate(s.version)}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {!!p.increases?.length && (
            <Alert tone="warning">
              {tr("This version asks for more access: {value}", { value: p.increases.join("; ") })}
            </Alert>
          )}
          {(p.warnings ?? []).map((w) => (
            <Alert key={w} tone="warning">
              {isolate(w)}
            </Alert>
          ))}
          {(p.licences ?? []).map((l) => (
            <LicenceNeeded key={l.app} need={l} onGiven={() => void plan.refetch()} />
          ))}
          <div>
            <h3 className="field-label">
              <Icon name="alert" size={14} /> {tr("This app will be able to")}
            </h3>
            <PermissionList permissions={p.permissions} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={close}>{tr("Cancel")}</Button>
            <Button
              variant="primary"
              icon="check"
              loading={busy}
              disabled={unlicensed.length > 0}
              title={unlicensed.length ? tr("Give its licence first") : undefined}
              onClick={() => void install()}
            >
              {request?.upgrade ? tr("Allow and update") : tr("Allow and install")}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
