// Packs (administrators): take this workspace's setup as a pack, read a pack's plan before anything is
// applied, install it, and the installs on record. The server decides what a pack may hold and say.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, errorMessage, saveBlob } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useMe, useMetaIndex } from "../lib/meta";
import { describePlan, describeResult, packFileName, readPack, travellers, type Pack, type PlanView, type ResultView, type SectionLists } from "../lib/packPlan";
import { Alert, Badge, Button, EmptyState, ErrorState, Field, PageLoading, toast } from "../ui/kit";
import { isolate, t as tr } from "@ferrum/client";

export function PacksPage() {
  const me = useMe();
  if (me.isLoading) return <PageLoading />;
  if (!me.data?.user.is_admin) {
    return (
      <EmptyState title={tr("Administrator access required")} icon="alert">
        <p className="muted">{tr("Only administrators can export and install packs.")}</p>
      </EmptyState>
    );
  }
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/customize">{tr("Customize")}</Link>
          </p>
          <h1 className="page-title">{tr("Packs")}</h1>
        </div>
      </div>
      <p className="muted">{tr("A pack is this workspace's whole setup in one file: customizations, roles, automations, Studio items, reference records and solutions.")}</p>
      <div className="stack">
        <TakePack workspace={me.data.tenant} />
        <InstallPack />
        <Installed />
      </div>
    </div>
  );
}

function TakePack({ workspace }: { workspace: string }) {
  const index = useMetaIndex().data;
  const [name, setName] = useState("workspace");
  const [label, setLabel] = useState(workspace);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const offered = travellers(index?.entities ?? []).sort((a, b) => a.label.localeCompare(b.label));
  const flip = (n: string) => setChosen((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));
  const download = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const pack = await api.get<unknown>("/api/admin/pack", { name: name.trim() || undefined, label: label.trim() || undefined, records: chosen.join(",") || undefined });
      saveBlob(new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }), packFileName(name));
    } catch (e) {
      setRefused(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="pk-take">
      <div className="card-head">
        <h2 id="pk-take">{tr("Take this workspace's setup as a pack")}</h2>
      </div>
      <div className="card-body stack">
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <Field label={tr("Name")} hint={tr("Lower-case letters, digits and dashes.")}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </Field>
          <Field label={tr("Label")}>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
          </Field>
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>{tr("Records that travel as reference data")}</legend>
          <p className="muted">{tr("The server refuses the records of an entity that holds people's details.")}</p>
          {!offered.length ? (
            <p className="muted">{tr("This workspace has no lists of its own whose records could travel.")}</p>
          ) : (
            offered.map((e) => (
              <label key={e.name} className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={chosen.includes(e.name)} onChange={() => flip(e.name)} />
                {isolate(e.label)}
              </label>
            ))
          )}
        </fieldset>
        {refused && <Alert tone="error">{refused}</Alert>}
        <div>
          <Button icon="download" loading={busy} onClick={() => void download()}>
            {tr("Download pack")}
          </Button>
        </div>
      </div>
    </section>
  );
}

type Planned = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; plan: PlanView };

function InstallPack() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; pack: Pack } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [again, setAgain] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);

  useEffect(() => {
    if (!file) return;
    let current = true;
    setPlanned({ state: "loading" });
    api
      .post<unknown>("/api/admin/pack/plan", { pack: file.pack })
      .then((p) => current && setPlanned({ state: "ready", plan: describePlan(p) }))
      .catch((e) => current && setPlanned({ state: "error", message: errorMessage(e) }));
    return () => {
      current = false;
    };
  }, [file, again]);

  const choose = async (f: File) => {
    setResult(null);
    setFailure(null);
    setPlanned(null);
    setFile(null);
    if (f.size > 5 * 1024 * 1024) {
      setRefusal(readPack("", f.size).refusal ?? null);
      return;
    }
    const read = readPack(await f.text(), f.size);
    setRefusal(read.refusal ?? null);
    if (read.pack) setFile({ name: f.name, pack: read.pack });
  };

  const install = async () => {
    if (!file || planned?.state !== "ready") return;
    setInstalling(true);
    setFailure(null);
    try {
      const done = describeResult(await api.post<unknown>("/api/admin/pack/install", { pack: file.pack, digest: planned.plan.digest }));
      setResult(done);
      setFile(null);
      setPlanned(null);
      toast(tr("The pack is installed."));
      await Promise.all(
        [["meta"], ["customize"], ["admin", "automations"], ["admin", "roles"], ["admin", "packs"]].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="card" aria-labelledby="pk-install">
      <div className="card-head">
        <h2 id="pk-install">{tr("Install a pack")}</h2>
      </div>
      <div className="card-body stack">
        <div>
          <Button icon="upload" onClick={() => input.current?.click()}>
            {tr("Choose a pack file")}
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label={tr("Pack file")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void choose(f);
              e.target.value = "";
            }}
          />
          {file && <span className="muted"> {isolate(file.name)}</span>}
        </div>
        {refusal && <Alert tone="error">{refusal}</Alert>}
        {planned?.state === "loading" && <PageLoading label={tr("Working out what installing would do…")} />}
        {planned?.state === "error" && (
          <Alert tone="error" action={<Button size="sm" onClick={() => setAgain((n) => n + 1)}>{tr("Try again")}</Button>}>
            {planned.message}
          </Alert>
        )}
        {planned?.state === "ready" && <PlanBody plan={planned.plan} />}
        {failure && <Alert tone="error">{failure}</Alert>}
        {planned?.state === "ready" && planned.plan.canInstall && (
          <div>
            <Button variant="primary" loading={installing} onClick={() => void install()}>
              {tr("Install")}
            </Button>
          </div>
        )}
        {result && <ResultBody result={result} />}
      </div>
    </section>
  );
}

/** What the pack is, what it needs, and what installing would do, section by section. */
export function PlanBody({ plan }: { plan: PlanView }) {
  return (
    <div className="stack" aria-live="polite">
      <div>
        <h3>{isolate(plan.label || plan.name)}</h3>
        <p className="muted">
          <span className="mono">{isolate(plan.name)}</span>
          {plan.version !== null && <> · {tr("version {version}", { version: plan.version })}</>}
        </p>
        {plan.needs.length > 0 && (
          <p>
            {tr("Needs")}: {plan.needs.map(([p, v]) => `${p} ${v}`).join(", ")}
          </p>
        )}
      </div>
      {!plan.canInstall && (
        <Alert tone="warning">
          <p>{tr("This workspace cannot take the pack yet.")}</p>
          {plan.missing.length > 0 && (
            <ul>
              {plan.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {plan.canInstall && <Sections sections={plan.sections} />}
      {plan.warnings.length > 0 && (
        <Alert tone="warning">
          <ul>
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

/** What the install did, and what did not arrive. */
export function ResultBody({ result }: { result: ResultView }) {
  return (
    <div className="stack">
      <Alert tone={result.failed.length ? "warning" : "success"}>
        {tr("Installed {name}.", { name: isolate(result.name) })}
        {result.failed.length > 0 && <> {tr("{n} did not arrive.", { n: result.failed.length })}</>}
      </Alert>
      {result.failed.length > 0 && (
        <Alert tone="error">
          <p>{tr("These solutions did not import:")}</p>
          <ul>
            {result.failed.map((f) => (
              <li key={f.solution}>
                <strong>{isolate(f.solution)}</strong>: {f.error}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Sections sections={result.sections} />
      <p className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        {result.touched && <Link to="/customize">{tr("Look at the entities")}</Link>}
        {result.draft && <Link to="/studio/solutions">{tr("Review the solution drafts in Studio")}</Link>}
      </p>
    </div>
  );
}

function Sections({ sections }: { sections: SectionLists[] }) {
  if (!sections.length) return <p className="muted">{tr("The pack holds nothing.")}</p>;
  return (
    <div className="stack">
      {sections.map((s) => (
        <section key={s.key} aria-label={s.label}>
          <h4>
            {s.label} <Badge>{s.created.length + s.changed.length + s.unchanged.length}</Badge>
          </h4>
          <Names title={tr("Will be created")} names={s.created} tone="green" />
          <Names title={tr("Will be changed")} names={s.changed} tone="amber" />
          <Names title={tr("Already there")} names={s.unchanged} tone="neutral" />
        </section>
      ))}
    </div>
  );
}

function Names({ title, names, tone }: { title: string; names: string[]; tone: "green" | "amber" | "neutral" }) {
  if (!names.length) return null;
  return (
    <details open={names.length <= 5}>
      <summary>
        <Badge tone={tone}>{names.length}</Badge> {title}
      </summary>
      <ul>
        {names.map((n, i) => (
          <li key={`${i}-${n}`}>{isolate(n)}</li>
        ))}
      </ul>
    </details>
  );
}

interface Installed {
  id: string;
  name: string;
  version: number;
  installed_by: string | null;
  installed_at: string;
}

function Installed() {
  const q = useQuery({ queryKey: ["admin", "packs"], queryFn: ({ signal }) => api.get<{ packs: Installed[] }>("/api/admin/packs", undefined, signal) });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: ({ signal }) => api.get<{ users: { id: string; email: string; full_name: string }[] }>("/api/admin/users", undefined, signal) });
  const who = (id: string | null) => {
    const u = users.data?.users.find((x) => x.id === id);
    return u ? u.full_name || u.email : "";
  };
  return (
    <section className="card" aria-labelledby="pk-done">
      <div className="card-head">
        <h2 id="pk-done">{tr("Installed packs")}</h2>
      </div>
      <div className="card-body">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <PageLoading />
        ) : !q.data.packs.length ? (
          <p className="muted">{tr("No pack has been installed here yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tr("Pack")}</th>
                  <th scope="col">{tr("Version")}</th>
                  <th scope="col">{tr("When")}</th>
                  <th scope="col">{tr("By")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.packs.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{isolate(p.name)}</td>
                    <td>{p.version}</td>
                    <td>{formatDateTime(p.installed_at)}</td>
                    <td>{isolate(who(p.installed_by))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
