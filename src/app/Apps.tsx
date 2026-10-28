// Apps: what this workspace has installed, the store, and uploads (docs/plan/apps.md).
// Installing always goes through a plan (dependencies, permissions) and an explicit consent.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useMe } from "../lib/meta";
import { Alert, Badge, Button, confirmDialog, Dialog, EmptyState, ErrorState, Icon, PageLoading, TabPanel, Tabs, toast } from "../ui/kit";

export interface AppSummary {
  id: string;
  name: string;
  version: string;
  runtime: "native" | "wasm" | "meta";
  summary: string;
  categories?: string[];
  publisher?: string;
  verified?: boolean;
  icon_url?: string | null;
  source?: string;
  private?: boolean;
}
interface Installed extends AppSummary {
  enabled: boolean;
  installed_at: string;
  update?: { version: string } | null;
  settings_url?: string | null;
}
interface AppsResponse {
  installed: Installed[];
  available: AppSummary[];
  uploads: "off" | "private" | "cluster";
  platform: string;
  stores: { url: string; ok: boolean; error?: string | null }[];
}
/** What the store or upload says an app may do; rendered generically, section by section. */
export type Permissions = Record<string, unknown>;
interface Plan {
  app: AppSummary & { description?: string | null; license?: string | null; homepage?: string | null };
  steps: { id: string; version: string; action: "install" | "upgrade" | "already"; source: string }[];
  permissions: Permissions;
  digest: string;
  increases?: string[];
  warnings?: string[];
  uninstall?: "keep" | "ask";
}

const RUNTIME_LABEL = { native: "Built in", wasm: "Sandboxed", meta: "No code" } as const;

/** Words for a permission section key: `entities` → "Entities". */
export function sectionLabel(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lines describing one permission section, whatever its JSON shape. */
export function permissionLines(value: unknown): string[] {
  if (value == null) return [];
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
  const sections = Object.entries(permissions).filter(([, v]) => permissionLines(v).length > 0);
  if (!sections.length) return <p className="muted">This app asks for no access beyond its own records.</p>;
  return (
    <dl className="kv">
      {sections.map(([k, v]) => (
        <div key={k}>
          <dt>{sectionLabel(k)}</dt>
          <dd>
            {permissionLines(v).map((l) => (
              <div key={l}>{l}</div>
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
      {app.name.slice(0, 2)}
    </span>
  );
}

function AppCard({ app, children, onOpen }: { app: AppSummary; children?: ReactNode; onOpen?: () => void }) {
  return (
    <article className="app-card">
      <div className="app-card-head">
        <AppIcon app={app} />
        <div style={{ minWidth: 0 }}>
          <h3 className="app-name">
            {onOpen ? (
              <button type="button" className="link-btn" onClick={onOpen}>
                {app.name}
              </button>
            ) : (
              app.name
            )}
          </h3>
          <div className="faint app-meta">
            v{app.version}
            {app.publisher && <> · {app.publisher}</>}
            {app.verified && (
              <>
                {" "}
                <Badge tone="blue">Verified</Badge>
              </>
            )}
          </div>
        </div>
      </div>
      <p className="muted app-summary">{app.summary}</p>
      <div className="chips">
        <Badge tone={app.runtime === "native" ? "purple" : app.runtime === "wasm" ? "green" : "neutral"}>{RUNTIME_LABEL[app.runtime]}</Badge>
        {app.private && <Badge tone="amber">Private</Badge>}
        {(app.categories ?? []).slice(0, 2).map((c) => (
          <Badge key={c}>{c}</Badge>
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
      <EmptyState title="Administrator access required" icon="alert">
        <p className="muted">Ask an administrator to install or remove apps.</p>
      </EmptyState>
    );
  }
  const tabs = [
    { id: "installed", label: `Installed${q.data ? ` (${q.data.installed.length})` : ""}` },
    { id: "store", label: "Store" },
    ...(q.data && q.data.uploads !== "off" ? [{ id: "upload", label: "Upload" }] : []),
  ];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Apps</h1>
          <p className="page-sub">Add features to this workspace — each app asks before it gets access.</p>
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
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["apps"] }), qc.invalidateQueries({ queryKey: ["meta"] })]);
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
      title: `Remove ${a.name}?`,
      message: "Its menus, roles and automations go away for everyone in this workspace. Records it created are kept unless you also delete its data below.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    const deleteData = await confirmDialog({
      title: `Also delete ${a.name}'s data?`,
      message: "Deleting removes every record this app stores, for this workspace only. This cannot be undone. Choose Keep to leave the data in place.",
      confirmLabel: "Delete data",
      cancelLabel: "Keep data",
      danger: true,
    });
    setBusy(a.id);
    try {
      await api.del(`/api/admin/apps/${a.id}${deleteData ? "?delete_data=true" : ""}`);
      toast(`${a.name} removed`);
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  if (!data.installed.length) {
    return (
      <EmptyState title="No apps installed" icon="apps">
        <p className="muted">Open the Store tab to add CRM, Helpdesk, HR, POS and more.</p>
      </EmptyState>
    );
  }
  return (
    <div className="app-grid">
      {data.installed.map((a) => (
        <AppCard key={a.id} app={a}>
          <label className="check-field" style={{ minHeight: 0 }}>
            <input type="checkbox" checked={a.enabled} disabled={busy === a.id} onChange={() => void toggle(a)} /> Enabled
          </label>
          <span className="spacer" />
          {a.update && (
            <Button size="sm" variant="primary" icon="upload" onClick={() => onInstall({ id: a.id, version: a.update!.version, upgrade: true })}>
              Update to {a.update.version}
            </Button>
          )}
          <Button size="sm" variant="danger" icon="trash" aria-label={`Remove ${a.name}`} disabled={busy === a.id} onClick={() => void uninstall(a)} />
          <span className="faint app-installed">Installed {formatDateTime(a.installed_at)}</span>
        </AppCard>
      ))}
    </div>
  );
}

const CATEGORIES = ["sales", "crm", "support", "hr", "finance", "inventory", "projects", "commerce", "pos", "communication", "productivity", "marketing", "integrations", "localization", "energy", "industry"];

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
          {data.stores
            .filter((s) => !s.ok)
            .map((s) => `${s.url}: ${s.error ?? "unreachable"}`)
            .join("; ")}{" "}
          — showing apps already available on this server.
        </Alert>
      )}
      <form className="row" role="search" onSubmit={submit}>
        <input className="input" type="search" placeholder="Search apps…" aria-label="Search apps" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <Button type="submit" icon="search">
          Search
        </Button>
      </form>
      <div className="chips" role="group" aria-label="Categories">
        <button type="button" className="chip" aria-pressed={!category} onClick={() => setCategory("")}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? "" : c)}>
            {sectionLabel(c)}
          </button>
        ))}
      </div>
      {store.error ? (
        <ErrorState error={store.error} onRetry={() => store.refetch()} />
      ) : store.isLoading ? (
        <PageLoading />
      ) : !store.data?.apps.length ? (
        <EmptyState title="No apps found" icon="search" />
      ) : (
        <div className="app-grid">
          {store.data.apps.map((a) => (
            <AppCard key={a.id} app={a} onOpen={() => onInstall({ id: a.id })}>
              <span className="spacer" />
              {installed.has(a.id) ? (
                <Badge tone="green">Installed</Badge>
              ) : (
                <Button size="sm" variant="primary" icon="plus" onClick={() => onInstall({ id: a.id })}>
                  Install
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
        Upload an app bundle (<span className="mono">.fapp</span>) built with <span className="mono">ferrum-app pack</span>.{" "}
        {data.uploads === "private"
          ? "Uploaded apps stay private to this workspace and run sandboxed; apps that bring their own tables must come from the store."
          : "Uploaded apps become available on this server; you review their permissions before installing."}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <input type="file" accept=".fapp,application/gzip" aria-label="App bundle" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button type="submit" variant="primary" icon="upload" loading={busy} disabled={!file}>
          Upload and review
        </Button>
      </div>
    </form>
  );
}

function InstallDialog({ request, onClose }: { request: { id: string; version?: string; upgrade?: boolean } | null; onClose: () => void }) {
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
    } catch (e) {
      setError(errorMessage(e, false));
    } finally {
      setBusy(false);
    }
  };
  const p = plan.data;
  return (
    <Dialog open={!!request} onClose={close} title={p ? `${request?.upgrade ? "Update" : "Install"} ${p.app.name}` : "App"} wide>
      {plan.isLoading ? (
        <PageLoading label="Checking the app…" />
      ) : plan.error ? (
        <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
      ) : p ? (
        <div className="stack">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <AppIcon app={p.app} />
            <div style={{ minWidth: 0 }}>
              <strong>{p.app.name}</strong> <span className="faint">v{p.app.version}</span>
              <p className="muted">{p.app.summary}</p>
              <div className="chips">
                <Badge tone={p.app.runtime === "native" ? "purple" : p.app.runtime === "wasm" ? "green" : "neutral"}>{RUNTIME_LABEL[p.app.runtime]}</Badge>
                {p.app.license && <Badge>{p.app.license}</Badge>}
                {p.app.publisher && <Badge>{p.app.publisher}</Badge>}
              </div>
            </div>
          </div>
          {p.app.description && <p className="comment-text">{p.app.description}</p>}
          {p.steps.filter((s) => s.action !== "already").length > 1 && (
            <div>
              <h3 className="field-label">Also installs</h3>
              <ul>
                {p.steps
                  .filter((s) => s.action !== "already" && s.id !== p.app.id)
                  .map((s) => (
                    <li key={s.id}>
                      {s.id} {s.version}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {!!p.increases?.length && (
            <Alert tone="warning">
              This version asks for more access: {p.increases.join("; ")}
            </Alert>
          )}
          {(p.warnings ?? []).map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          <div>
            <h3 className="field-label">
              <Icon name="alert" size={14} /> This app will be able to
            </h3>
            <PermissionList permissions={p.permissions} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" icon="check" loading={busy} onClick={() => void install()}>
              {request?.upgrade ? "Allow and update" : "Allow and install"}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
