// Administration → Addresses: the addresses a workspace answers on, what each one opens, and its short paths (docs/operations.md,
// "Addresses of a workspace" and "Custom domains"; the server's docs/plan/topology.md D7). GET and POST /api/admin/domains, PATCH and
// DELETE /api/admin/domains/{host}, PUT …/primary, POST …/check, GET and PUT /api/admin/paths (docs/api.md), in the shapes of
// server/src/controllers/domains.rs and server/tests/addresses_it.rs. The server judges every change; this screen checks what it can
// before sending (a name's form, a reserved name, a short path's form and what is taken) and shows the server's refusal where it belongs.
// What an address shows is never a wall, and zones and the operator's own addresses are the operator's: both are said where they matter.

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { bootstrap, isolate, t as tr } from "@ferrum/client";
import { api, ApiError, errorMessage, type FieldError } from "../lib/api";
import { formatMoment } from "../lib/format";
import { placed } from "../lib/placed";
import { Alert, Badge, Button, confirmDialog, Dialog, Field, Icon, Menu, MenuItem, ScrollRegion, toast, type Tone } from "../ui/kit";
import { failureKind, ListSkeleton, LoadFailed, StatePanel, TableSkeleton } from "../ui/patterns";

type Status = "verified" | "pending" | "failing" | "leaving" | "released";

/** An address as GET /api/admin/domains lists it (`listed` in server/src/controllers/domains.rs). */
export interface Address {
  host: string;
  /** `subdomain`: the workspace's own, or a name under the base (with `base_name`); `custom`: a domain of its own; `operator`: the operator's. */
  kind: "subdomain" | "custom" | "operator";
  /** `shell` (the workspace), `portal` or `site:{app}`. */
  target: string;
  /** The main address of its target. */
  primary: boolean;
  status: Status;
  verified_at: string | null;
  released_at: string | null;
  /** A removed address goes on serving the people signed in there until then. */
  leaving_until: string | null;
  /** The zone the operator put it in; nobody else sets it. */
  zone: string | null;
  /** What a `shell` address shows: the app `/` lands on, the apps the bar lists (null: every app), its name in the bar. */
  home: string | null;
  apps: string[] | null;
  label: string | null;
  base_name: string | null;
  can: { edit: boolean; remove: boolean; make_primary: boolean };
}

export interface Listing {
  domains: Address[];
  /** Where a domain of the workspace's own should point (the cluster's address), or null. */
  point_to: string | null;
  sites: { app: string; title: string }[];
  base: string | null;
  /** `{name}--acme.ferrum.cloud`: what a name under the base becomes; null without a base. */
  name_form: string | null;
  reserved_names: string[];
  /** The apps an address may land on or list (those with a page of their own that the administrator's zone shows). */
  homes: { id: string; name: string; route: string }[];
  limits: { addresses: number; paths: number };
  used: { addresses: number; paths: number };
}

interface PathList {
  paths: { alias: string; target: string; works: boolean }[];
  limit: number;
  /** First parts of a path that a short path may not take: the service's own and every app's. */
  taken: string[];
}

const TONE: Record<Status, Tone> = { verified: "green", pending: "amber", failing: "red", leaving: "amber", released: "neutral" };
const STATUS = (): Record<Status, string> => ({
  verified: tr("Working"),
  pending: tr("Waiting for the domain"),
  failing: tr("Not reaching this workspace"),
  leaving: tr("Leaving"),
  released: tr("Removed"),
});

const at = (host: string) => `/api/admin/domains/${encodeURIComponent(host)}`;
/** An address as a link, on this page's scheme and port (a development server's port; none in production). */
const link = (host: string) => `${location.protocol}//${host}${location.port ? `:${location.port}` : ""}/`;
const code = (text: string) => (
  <span className="mono" dir="ltr">
    {text}
  </span>
);

/** Why a name under the base cannot be given, or null; `name` as the server takes it, trimmed and in lower case (crates/kernel/src/shell.rs `name_under_base`). */
export function nameProblem(name: string, form: string, reserved: string[]): string | null {
  if (name.length > 30 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return tr("Use 1 to 30 lowercase letters, digits or single hyphens, not at either end.");
  if (reserved.includes(name)) return tr("This name is kept for the service's own addresses.");
  if (form.split(".")[0]!.replace("{name}", name).length > 63) return tr("This name is too long for this workspace's addresses: use a shorter one.");
  return null;
}

/** Why a domain of the workspace's own cannot be added, or null (crates/kernel/src/shell.rs `normalize_host`; the base's own names are given as names). */
export function domainProblem(host: string, base: string | null): string | null {
  const parts = host.split(".");
  if (parts.length < 2 || host.length > 253 || !parts.every((p) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) return tr("Write the domain alone, such as erp.example.com.");
  // On a developer's machine a name under `localhost` is a domain of its own, working at once.
  if (base && base !== "localhost" && (host === base || host.endsWith(`.${base}`))) return tr("This is under {base}, this service's own domain: give a name instead.", { base: isolate(base) });
  return null;
}

/** Changes are refused (403) while the workspace is closed or restricted, and GET /api/admin/domains does not say so: its account state does. */
function useFrozen() {
  const usage = useQuery({ queryKey: ["admin", "usage"], queryFn: ({ signal }) => api.get<{ state?: string }>("/api/admin/usage", undefined, signal), retry: false });
  const frozen = usage.data?.state === "restricted" || usage.data?.state === "closed";
  // Changes are offered once the state is known; when it cannot be read the server's refusal says it.
  return { frozen, canChange: usage.isError || (usage.isSuccess && !frozen) };
}

export function Addresses() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "domains"], queryFn: ({ signal }) => api.get<Listing>("/api/admin/domains", undefined, signal) });
  const { frozen, canChange } = useFrozen();
  // Refused outright (not an administrator, or a zone that keeps administration out): one panel, never what exists.
  if (q.error && !q.data && failureKind(q.error) === "denied") return <LoadFailed error={q.error} />;
  return (
    <div className="stack">
      {frozen && <Alert tone="info">{tr("While this workspace is closed or restricted, its addresses and short paths keep working and cannot be changed.")}</Alert>}
      <AddressList q={q} canChange={canChange} refresh={() => qc.invalidateQueries({ queryKey: ["admin", "domains"] })} />
      <ShortPaths canChange={canChange} />
    </div>
  );
}

function AddressList({ q, canChange, refresh }: { q: UseQueryResult<Listing>; canChange: boolean; refresh: () => Promise<unknown> }) {
  const data = q.data;
  const rows = data?.domains ?? [];
  const [dialog, setDialog] = useState<{ row: Address | null } | null>(null);
  const [problem, setProblem] = useState<{ host: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sending = useRef(false);
  // Where focus goes once the list drawn is the server's answer after a change (`was`: the answer drawn before it): the address changed
  // (always, when it was just added; else only if focus went with the control that had it), or the refusal.
  const answered = Math.max(q.dataUpdatedAt, q.errorUpdatedAt);
  const drawn = useRef(answered);
  drawn.current = answered;
  const [focus, setFocus] = useState<{ host: string; was: number; always?: boolean; problem?: boolean } | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const head = useRef<HTMLHeadingElement>(null);
  const said = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus || dialog || answered === focus.was) return;
    const active = document.activeElement;
    if (focus.problem) said.current?.focus();
    else if (focus.always || !active || active === document.body || !active.isConnected) (links.current.get(focus.host) ?? head.current)?.focus();
    setFocus(null);
  }, [focus, dialog, answered]);

  /** One change at a time; the list comes from the server again after each, whatever its answer. */
  const change = async (d: Address, call: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(d.host);
    setProblem(null);
    let failed = false;
    try {
      await call();
    } catch (e) {
      failed = true;
      setProblem({ host: d.host, text: errorMessage(e) });
    }
    const was = drawn.current;
    await refresh();
    sending.current = false;
    setBusy(null);
    setFocus({ host: d.host, was, problem: failed });
  };
  const check = (d: Address) =>
    change(d, async () => {
      const r = await api.post<{ answers: boolean }>(`${at(d.host)}/check`);
      toast(r.answers ? tr("{host} now opens this workspace", { host: isolate(d.host) }) : tr("{host} does not point here yet", { host: isolate(d.host) }), r.answers ? "success" : "info");
    });
  const primary = (d: Address) =>
    change(d, async () => {
      await api.put(`${at(d.host)}/primary`);
      toast(tr("{host} is now the main address", { host: isolate(d.host) }));
    });
  const mainOf = (target: string, except = "") => rows.find((r) => r.primary && r.target === target && !r.released_at && r.host !== except)?.host;
  const remove = async (d: Address) => {
    const others = rows.some((r) => r.host !== d.host && r.target === d.target && !r.released_at && (r.kind === "subdomain" || r.verified_at));
    const main = mainOf(d.target, d.host);
    const message =
      d.kind === "custom" && !d.verified_at ? tr("It has never reached this workspace, so it is removed at once.")
      : main ? tr("People already signed in on it keep working there until its leaving period ends, and new visitors go to {main} from now on. Then it stops, and for 90 days only sends visitors on.", { main: isolate(main) })
      : others ? tr("People already signed in on it keep working there until its leaving period ends. Another of the workspace's addresses becomes the main one, and new visitors go there. Then it stops, and for 90 days only sends visitors on.")
      : tr("People already signed in on it keep working there until its leaving period ends. No other address can take its place, so new visitors are told the workspace has moved.");
    if (!(await confirmDialog({ title: tr("Remove {host}?", { host: isolate(d.host) }), message, confirmLabel: tr("Remove"), danger: true }))) return;
    await change(d, async () => {
      const r = await api.del<{ host: string; leaving_until: string | null }>(at(d.host));
      toast(
        r.leaving_until
          ? tr("{host} is leaving: people signed in there keep working until {date}", { host: isolate(d.host), date: formatMoment(r.leaving_until, { dateStyle: "medium" }) })
          : tr("{host} is removed", { host: isolate(d.host) }),
      );
    });
  };
  const done = async (host: string, added: boolean) => {
    setDialog(null);
    const was = drawn.current;
    await refresh();
    if (added) setFocus({ host, was, always: true });
  };

  const full = !!data && data.used.addresses >= data.limits.addresses;
  // The addresses an administrator added: without any, the screen says what one is for.
  const own = rows.some((r) => r.kind === "custom" || r.base_name);
  const add = (
    <Button variant="primary" icon="plus" disabled={full} onClick={() => setDialog({ row: null })}>
      {tr("Add an address")}
    </Button>
  );
  const accounts = !!bootstrap()?.api.accounts;
  const appName = (id: string) => data?.homes.find((h) => h.id === id)?.name ?? id;
  const opens = (d: Address) =>
    d.target === "shell" ? (d.home ? tr("The workspace, landing on {app}", { app: appName(d.home) }) : tr("The whole workspace"))
    : d.target === "portal" ? tr("The portal")
    : tr("{title}'s public site", { title: data?.sites.find((s) => `site:${s.app}` === d.target)?.title ?? d.target.slice(5) });
  const detail = (d: Address) => {
    if (d.status === "pending" || d.status === "failing")
      return data?.point_to ? placed(tr("Point it at {address} with a CNAME record, then check it."), { address: code(data.point_to) }) : tr("Point it at this server, then check it.");
    if (d.status === "verified") return null;
    const main = mainOf(d.target);
    const date = d.leaving_until ? formatMoment(d.leaving_until, { dateStyle: "medium" }) : "";
    if (d.status === "leaving")
      return main
        ? placed(tr("Stops on {date}: until then people signed in there keep working, and new visitors go to {address}."), { date, address: code(main) })
        : tr("Stops on {date}: until then people signed in there keep working. Nothing takes its place, so new visitors are told the workspace has moved.", { date });
    return main ? placed(tr("It only sends visitors on to {address}, for 90 days after it stopped."), { address: code(main) }) : tr("Visitors are told the workspace has moved.");
  };

  return (
    <section className="card" aria-labelledby="addresses-head">
      <div className="card-head">
        <h2 id="addresses-head" ref={head} tabIndex={-1}>
          {tr("Addresses")}
        </h2>
        {data && <span className="muted">{tr("{n} of {limit} used", { n: data.used.addresses, limit: data.limits.addresses })}</span>}
        <span className="spacer" />
        {data && canChange && own && add}
      </div>
      {q.isLoading ? (
        <TableSkeleton columns={4} rows={3} />
      ) : !data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="card-body stack">
            <p className="muted">
              {tr("The addresses this workspace answers on, and what each one opens.")}{" "}
              {accounts
                ? tr("People sign in on each address on its own, in one step with no prompt, and each address keeps its own offline work on each device.")
                : tr("People sign in on each address on its own, and each address keeps its own offline work on each device.")}
            </p>
            {full && canChange && <p className="field-hint">{tr("This workspace has all {limit} of its addresses: remove one to add another.", { limit: data.limits.addresses })}</p>}
            {problem && (
              <div ref={said} tabIndex={-1}>
                <Alert tone="error">{tr("{host} was not changed: {reason}", { host: isolate(problem.host), reason: isolate(problem.text) })}</Alert>
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <ScrollRegion label={tr("Addresses")}>
              <table className="table list-table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Address")}</th>
                    <th scope="col">{tr("What it opens")}</th>
                    <th scope="col">{tr("Status")}</th>
                    <th scope="col">
                      <span className="sr-only">{tr("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => {
                    const id = `address-${d.host}`;
                    const more = detail(d);
                    return (
                      <tr key={d.host}>
                        <td className="card-lead">
                          <div className="row" style={{ gap: 8 }}>
                            <a ref={(el) => void (el ? links.current.set(d.host, el) : links.current.delete(d.host))} href={link(d.host)} target="_blank" rel="noopener noreferrer">
                              <span id={id} className="mono" dir="ltr">
                                {d.host}
                              </span>
                              <span className="sr-only"> {tr("(opens in a new tab)")}</span>
                            </a>
                            {d.primary && <Badge tone="blue">{tr("Main")}</Badge>}
                          </div>
                          {d.label && <div>{tr("Shown in the bar as {label}", { label: isolate(d.label) })}</div>}
                          {d.kind === "subdomain" && !d.base_name && <div className="faint">{tr("Made with the workspace; it stays.")}</div>}
                          {d.kind === "operator" && <div className="faint">{tr("Added by whoever runs the installation, who alone can change or remove it.")}</div>}
                          {d.zone && <div className="faint">{tr("In the zone {zone}, which only whoever runs the installation can change.", { zone: isolate(d.zone) })}</div>}
                        </td>
                        <td data-label={tr("What it opens")}>
                          <div>
                            <div>{opens(d)}</div>
                            {d.target === "shell" && d.apps && <div className="muted">{d.apps.length ? tr("Lists only {apps}", { apps: d.apps.map((a) => isolate(appName(a))).join(", ") }) : tr("Lists no apps")}</div>}
                          </div>
                        </td>
                        <td data-label={tr("Status")}>
                          <div>
                            <Badge tone={TONE[d.status]}>{STATUS()[d.status]}</Badge>
                            {more && <div className="muted">{more}</div>}
                          </div>
                        </td>
                        <td>
                          {canChange && (
                            <div className="row-actions">
                              {d.can.edit && (
                                <Button size="sm" aria-describedby={id} disabled={busy === d.host} onClick={() => setDialog({ row: d })}>
                                  {tr("Change")}
                                </Button>
                              )}
                              {d.kind === "custom" && !d.released_at && d.status !== "verified" && (
                                <Button size="sm" aria-describedby={id} loading={busy === d.host} onClick={() => void check(d)}>
                                  {tr("Check now")}
                                </Button>
                              )}
                              {(d.can.make_primary || d.can.remove) && (
                                <Menu ariaLabel={tr("Actions for {name}", { name: isolate(d.host) })} label={<Ellipsis size={16} aria-hidden="true" />} buttonClass="btn btn-ghost btn-md icon-btn">
                                  {(close) => (
                                    <>
                                      {d.can.make_primary && <MenuItem onSelect={() => (close(), void primary(d))}>{tr("Make main")}</MenuItem>}
                                      {d.can.remove && (
                                        <MenuItem danger onSelect={() => (close(), void remove(d))}>
                                          {tr("Remove…")}
                                        </MenuItem>
                                      )}
                                    </>
                                  )}
                                </Menu>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          {!own && (
            <StatePanel kind="empty" title={tr("No addresses of your own yet")} action={canChange ? add : undefined}>
              {tr("Another address can open the workspace for one team, landing on its app with its own name in the bar, or put the portal or an app's public site on a domain of your own.")}
            </StatePanel>
          )}
        </>
      )}
      {dialog && data && <AddressDialog listing={data} row={dialog.row} onClose={() => setDialog(null)} onDone={(host) => void done(host, !dialog.row)} onRefused={() => void refresh()} />}
    </section>
  );
}

/** Adds an address (`row` null) or changes what one shows: where it lands, the apps it lists, its label. A refusal keeps what was typed
 *  and has the list read again (the count beside it may have moved). */
function AddressDialog({ listing, row, onClose, onDone, onRefused }: { listing: Listing; row: Address | null; onClose: () => void; onDone: (host: string) => void; onRefused: () => void }) {
  const id = useId();
  const [way, setWay] = useState<"name" | "host">(listing.name_form ? "name" : "host");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [target, setTarget] = useState(row?.target ?? "shell");
  const [home, setHome] = useState(row?.home ?? "");
  const [only, setOnly] = useState(row?.apps != null);
  const [apps, setApps] = useState<string[]>(row?.apps ?? []);
  const [label, setLabel] = useState(row?.label ?? "");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const sending = useRef(false);
  // Each change sets aside what the server said about the last try.
  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setErrors([]);
    };
  }

  const typedName = name.trim().toLowerCase();
  const typedHost = host.trim().replace(/\.$/, "").toLowerCase();
  const shell = target === "shell";
  const choices = shell && listing.homes.length > 0;
  /** What is wrong before asking the server: as it is typed, and on Add for what is still missing. */
  const local = (strict: boolean): FieldError[] => {
    const out: FieldError[] = [];
    const note = (field: string, message: string | null) => void (message && out.push({ field, message }));
    if (!row && way === "name") note("name", typedName ? nameProblem(typedName, listing.name_form ?? "{name}", listing.reserved_names ?? []) : strict ? tr("Give a name.") : null);
    if (!row && way === "host") note("host", typedHost ? domainProblem(typedHost, listing.base) : strict ? tr("Give a domain.") : null);
    if (choices && only && !apps.length && strict) note("apps", tr("Tick at least one app, or list every app."));
    return out;
  };
  const live = local(false);
  const visible = [...(row ? [] : [way, "target"]), ...(choices ? ["home", "apps"] : []), ...(shell ? ["label"] : [])];
  const error = (field: string) => (live.find((e) => e.field === field) ?? errors.find((e) => e.field === field))?.message;
  const elsewhere = errors.filter((e) => !visible.includes(e.field));
  useEffect(() => {
    if (!tries) return;
    const first = errors.find((e) => visible.includes(e.field))?.field;
    document.getElementById(elsewhere.length || !first ? `${id}-said` : `${id}-${first}`)?.focus();
  }, [tries]); // eslint-disable-line react-hooks/exhaustive-deps -- once per try

  const shape = { home: home || null, apps: only ? apps : null, label: label.trim() || null };
  const sorted = (l: string[] | null) => JSON.stringify(l && [...l].sort());
  // A change sends only what changed: someone else's change to another part stands.
  const patch: Record<string, unknown> = {};
  if (row) {
    if (shape.home !== (row.home ?? null)) patch.home = shape.home;
    if (sorted(shape.apps) !== sorted(row.apps)) patch.apps = shape.apps;
    if (shape.label !== (row.label ?? null)) patch.label = shape.label;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    const wrong = local(true);
    if (wrong.length) {
      setErrors(wrong);
      setTries((n) => n + 1);
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      let r: Address;
      if (row) {
        r = await api.patch<Address>(at(row.host), patch);
        toast(tr("{host} is saved", { host: isolate(r.host) }));
      } else {
        const body: Record<string, unknown> = way === "name" ? { name: typedName, target } : { host: typedHost, target };
        if (shell) for (const [k, v] of Object.entries(shape)) if (v !== null) body[k] = v;
        r = await api.post<Address>("/api/admin/domains", body);
        toast(r.status === "verified" ? tr("{host} is added and works now", { host: isolate(r.host) }) : tr("{host} is added: it works once the domain points here and is checked", { host: isolate(r.host) }));
      }
      onDone(r.host);
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields.length ? err.fields : [{ field: "", message: errorMessage(err) }]);
      setTries((n) => n + 1);
      onRefused();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const pointHere = placed(tr("Use your own address for this workspace, its portal or an app's public site. {p1} Ferrum checks it within a few minutes and serves it with its own certificate."), {
    p1: listing.point_to ? placed(tr("Point the domain at {p1} with a CNAME record;"), { p1: code(listing.point_to) }) : tr("Point the domain at this server;"),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? placed(tr("Change what {address} shows"), { address: code(row.host) }) : tr("Add an address")}
      footer={
        <>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy} disabled={!!row && !Object.keys(patch).length}>
            {row ? tr("Save") : tr("Add")}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className="stack" onSubmit={submit}>
        <div id={`${id}-said`} tabIndex={-1}>
          {elsewhere.length > 0 && <Alert tone="error">{isolate(elsewhere.map((e) => e.message).join(" "))}</Alert>}
        </div>
        {row?.zone && <p className="faint">{tr("In the zone {zone}, which only whoever runs the installation can change.", { zone: isolate(row.zone) })}</p>}
        {!row && listing.name_form && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">{tr("Kind of address")}</legend>
            <div className="stack" style={{ gap: 8 }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name={`${id}-way`} checked={way === "name"} onChange={() => edit(setWay)("name")} />
                {placed(tr("A name under {base}"), { base: code(listing.base ?? "") })}
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name={`${id}-way`} checked={way === "host"} onChange={() => edit(setWay)("host")} />
                {tr("A domain of your own")}
              </label>
            </div>
          </fieldset>
        )}
        {!row && way === "name" && (
          <Field label={tr("Name")} required error={error("name")} hint={placed(tr("The address will be {address}"), { address: code((listing.name_form ?? "{name}").replace("{name}", typedName || "…")) })}>
            <input id={`${id}-name`} data-autofocus className="input mono" dir="ltr" value={name} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="sales" onChange={(e) => edit(setName)(e.target.value)} />
          </Field>
        )}
        {!row && way === "host" && (
          <>
            <Field label={tr("Domain")} required error={error("host")} hint={tr("A name you own, such as erp.example.com")}>
              <input id={`${id}-host`} data-autofocus className="input mono" dir="ltr" value={host} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="erp.example.com" onChange={(e) => edit(setHost)(e.target.value)} />
            </Field>
            <p className="field-hint">{pointHere}</p>
          </>
        )}
        {!row && (
          <Field label={tr("What it opens")} error={error("target")}>
            <select id={`${id}-target`} className="select" value={target} onChange={(e) => edit(setTarget)(e.target.value)}>
              <option value="shell">{tr("The whole workspace")}</option>
              <option value="portal">{tr("The portal (customers, suppliers)")}</option>
              {listing.sites.map((s) => (
                <option key={s.app} value={`site:${s.app}`}>
                  {tr("{title}'s public site", { title: s.title })}
                </option>
              ))}
            </select>
          </Field>
        )}
        {choices && (
          <>
            <Field label={tr("The app it lands on")} error={error("home")} hint={tr("Whoever cannot open that app lands on Home instead.")}>
              <select id={`${id}-home`} className="select" value={home} onChange={(e) => edit(setHome)(e.target.value)}>
                <option value="">{tr("Home")}</option>
                {listing.homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {isolate(h.name)}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">{tr("Apps listed there")}</legend>
              <div className="stack" style={{ gap: 8 }}>
                <label className="row" style={{ gap: 8 }}>
                  <input type="radio" name={`${id}-only`} checked={!only} onChange={() => edit(setOnly)(false)} />
                  {tr("Every app")}
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input id={`${id}-apps`} type="radio" name={`${id}-only`} checked={only} aria-invalid={error("apps") ? true : undefined} onChange={() => edit(setOnly)(true)} />
                  {tr("Only these apps")}
                </label>
                {only && (
                  <div className="stack" style={{ gap: 4, paddingInlineStart: 24 }}>
                    {listing.homes.map((h) => (
                      <label key={h.id} className="row" style={{ gap: 8 }}>
                        <input type="checkbox" checked={apps.includes(h.id)} onChange={(e) => edit(setApps)(e.target.checked ? [...apps, h.id] : apps.filter((a) => a !== h.id))} />
                        {isolate(h.name)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {error("apps") && <p className="field-error">{isolate(error("apps")!)}</p>}
              <p className="field-hint">{tr("Listing only some apps is a convenience, not a lock: other apps still open there through a link. Only whoever runs the installation can keep an app away from an address.")}</p>
            </fieldset>
          </>
        )}
        {shell && (
          <Field label={tr("Label")} error={error("label")} hint={tr("A short name shown beside the workspace's name in the bar, such as Sales.")}>
            <input id={`${id}-label`} className="input" value={label} maxLength={40} autoComplete="off" onChange={(e) => edit(setLabel)(e.target.value)} />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

// ── short paths ──

const ALIAS = /^[a-z][a-z0-9-]{1,29}$/;
type PathRow = { key: number; alias: string; target: string; works: boolean; saved: string };
let rowKey = 0;

/** Why a short path cannot be saved as written, or null; a blank row is dropped. As the server checks it (`put_paths` in
 *  server/src/controllers/domains.rs, `alias_shaped` and `target_shaped` in crates/kernel/src/shell.rs), except which pages a target may
 *  lead to: here only that its first part is the service's or an app's (`taken` holds them all); the server says the rest. */
export function pathProblem(r: { alias: string; target: string; works?: boolean; saved?: string }, i: number, rows: { alias: string }[], taken: string[]): string | null {
  const alias = r.alias.trim();
  const target = r.target.trim();
  if (!alias && !target) return null;
  if (!ALIAS.test(alias)) return tr("Use 2 to 30 lowercase letters, digits or hyphens, starting with a letter.");
  if (r.works === false && alias === r.saved) return `${tr("An app now uses {path}, so its page opens there and this short path does nothing.", { path: isolate(`/${alias}`) })} ${tr("Change it or remove it to save.")}`;
  if (taken.includes(alias)) return tr("{path} is already the address of an app or of the service itself.", { path: isolate(`/${alias}`) });
  if (rows.findIndex((x) => x.alias.trim() === alias) !== i) return tr("{path} is given twice.", { path: isolate(`/${alias}`) });
  const first = target.slice(1).split(/[/?]/)[0] ?? "";
  if (!/^\/(?![/\\])[^\s#\\]*$/.test(target) || target.length > 2000 || (first !== "" && !taken.includes(first))) return tr("Lead it to a page of this workspace, such as /crm/ or /data/.");
  return null;
}

function ShortPaths({ canChange }: { canChange: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "paths"], queryFn: ({ signal }) => api.get<PathList>("/api/admin/paths", undefined, signal) });
  const head = useRef<HTMLHeadingElement>(null);
  const data = q.data;
  const saved = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["admin", "paths"] }), qc.invalidateQueries({ queryKey: ["admin", "domains"] })]);
    head.current?.focus();
  };
  return (
    <section className="card" aria-labelledby="paths-head">
      <div className="card-head">
        <h2 id="paths-head" ref={head} tabIndex={-1}>
          {tr("Short paths")}
        </h2>
        {data && <span className="muted">{tr("{n} of {limit} used", { n: data.paths.length, limit: data.limit })}</span>}
      </div>
      <div className="card-body stack">
        <p className="muted">{tr("A short path such as /sales leads to a page of this workspace on every address that opens it. It sends people on, so the address bar then shows the page's own path.")}</p>
        {q.isLoading ? (
          <ListSkeleton rows={2} />
        ) : !data ? (
          <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
        ) : canChange ? (
          <PathsForm key={JSON.stringify(data.paths)} list={data} onSaved={saved} />
        ) : !data.paths.length ? (
          <p className="muted">{tr("No short paths yet.")}</p>
        ) : (
          <ul className="stack" style={{ gap: 8 }}>
            {data.paths.map((p) => (
              <li key={p.alias}>
                <span className="row" style={{ gap: 8 }}>
                  {code(`/${p.alias}`)}
                  <Icon name="chevronRight" />
                  {code(p.target)}
                </span>
                {!p.works && <p className="field-hint">{tr("An app now uses {path}, so its page opens there and this short path does nothing.", { path: isolate(`/${p.alias}`) })}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The short paths as one list, saved together (PUT replaces it whole). */
function PathsForm({ list, onSaved }: { list: PathList; onSaved: () => Promise<void> }) {
  const id = useId();
  const [rows, setRows] = useState<PathRow[]>(() => list.paths.map((p) => ({ key: ++rowKey, alias: p.alias, target: p.target, works: p.works, saved: p.alias })));
  const [refusal, setRefusal] = useState<{ at: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus]);
  const kept = rows.filter((r) => r.alias.trim() || r.target.trim()).map((r) => ({ alias: r.alias.trim(), target: r.target.trim() }));
  const changed = JSON.stringify(kept) !== JSON.stringify(list.paths.map(({ alias, target }) => ({ alias, target })));
  const problems = rows.map((r, i) => pathProblem(r, i, rows, list.taken));
  const full = rows.length >= list.limit;
  const set = (i: number, change: Partial<PathRow>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
    setRefusal(null);
  };
  const drop = (i: number) => {
    setRows(rows.filter((_, j) => j !== i));
    setRefusal(null);
    setFocus(rows.length > 1 ? `${id}-alias-${Math.min(i, rows.length - 2)}` : `${id}-add`);
  };
  const add = () => {
    setRows([...rows, { key: ++rowKey, alias: "", target: "", works: true, saved: "" }]);
    setRefusal(null);
    setFocus(`${id}-alias-${rows.length}`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending.current || !changed || problems.some(Boolean)) return;
    sending.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      await api.put("/api/admin/paths", { paths: kept });
      toast(tr("Short paths saved"));
      await onSaved();
    } catch (err) {
      const text = err instanceof ApiError && err.fields.length ? err.fields.map((f) => f.message).join(" ") : errorMessage(err);
      // The server names the short path at fault first ("/help must lead to …"): its row shows it.
      const alias = /^\/([a-z][a-z0-9-]*)/.exec(text)?.[1];
      const i = alias ? rows.findIndex((r) => r.alias.trim() === alias) : -1;
      setRefusal({ at: i, text });
      setFocus(i >= 0 ? `${id}-alias-${i}` : `${id}-said`);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} aria-labelledby="paths-head">
      <div id={`${id}-said`} tabIndex={-1}>
        {refusal && refusal.at < 0 && <Alert tone="error">{isolate(refusal.text)}</Alert>}
      </div>
      {!rows.length && <p className="muted">{tr("No short paths yet.")}</p>}
      {rows.map((r, i) => {
        const why = refusal?.at === i ? refusal.text : problems[i];
        return (
          <div key={r.key} className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="row" dir="ltr" style={{ gap: 4, flex: "1 1 160px", flexWrap: "nowrap" }}>
                <span aria-hidden="true">/</span>
                <input
                  id={`${id}-alias-${i}`}
                  className="input mono"
                  style={{ flex: 1, minWidth: 0 }}
                  value={r.alias}
                  placeholder="sales"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-label={tr("Short path {n}", { n: i + 1 })}
                  aria-invalid={why ? true : undefined}
                  aria-describedby={why ? `${id}-why-${i}` : undefined}
                  onChange={(e) => set(i, { alias: e.target.value.replace(/^\/+/, "").toLowerCase() })}
                />
              </span>
              <Icon name="chevronRight" />
              <input
                className="input mono"
                dir="ltr"
                style={{ flex: "2 1 220px", minWidth: 0 }}
                value={r.target}
                placeholder="/crm/"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                aria-label={tr("Where short path {n} leads", { n: i + 1 })}
                onChange={(e) => set(i, { target: e.target.value })}
              />
              <Button size="sm" icon="trash" aria-label={tr("Remove short path {n}", { n: i + 1 })} onClick={() => drop(i)} />
            </div>
            {why && (
              <p id={`${id}-why-${i}`} className="field-error">
                {isolate(why)}
              </p>
            )}
          </div>
        );
      })}
      <div className="row">
        <Button id={`${id}-add`} size="sm" icon="plus" disabled={full} onClick={add}>
          {tr("Add a short path")}
        </Button>
        {full && <span className="field-hint">{tr("This workspace has all {limit} of its short paths.", { limit: list.limit })}</span>}
        <span className="spacer" />
        <Button type="submit" variant="primary" loading={busy} disabled={!changed || problems.some(Boolean)}>
          {tr("Save")}
        </Button>
      </div>
    </form>
  );
}
