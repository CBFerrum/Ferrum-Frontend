// Reports, rendered generically: parameters from /api/reports, then columns/rows/totals with
// tree indentation (`_indent`), bold rows (`_bold`) and CSV download of the result.

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { api, saveBlob } from "../lib/api";
import { formatDate, formatValue, humanize, isDecimalString, NUMERIC_TYPES, todayIso } from "../lib/format";
import { useMe, useReports, type Me, type ReportDef, type ReportParam } from "../lib/meta";
import { Alert, Button, EmptyState, ErrorState, Field as FieldWrap, PageLoading } from "../ui/kit";
import { LinkInput } from "./widgets";

interface Column {
  name: string;
  label?: string;
  type?: string;
}
type Row = Record<string, unknown> & { _indent?: number; _bold?: boolean; _titles?: Record<string, string> };
interface ReportResult {
  name?: string;
  label?: string;
  columns: Column[];
  rows: Row[];
  totals?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export function ReportView() {
  const { name = "" } = useParams();
  const reports = useReports();
  const me = useMe();
  if (reports.isLoading || me.isLoading) return <PageLoading />;
  const def = reports.data?.reports.find((r) => r.name === name);
  return <ReportInner key={name} name={name} def={def} catalogError={reports.error} me={me.data} />;
}

/** Default keywords the server resolves itself when the parameter is omitted. */
const SERVER_DEFAULTS: Record<string, string> = { today: "today", fiscal_year_start: "the start of the fiscal year" };

function defaultFor(p: ReportParam, me: Me | undefined): string {
  if (p.default !== undefined && p.default !== null) {
    if (typeof p.default === "string" && p.default in SERVER_DEFAULTS) return ""; // omitted: the server applies it
    if (typeof p.default === "boolean") return p.default ? "true" : "";
    return String(p.default);
  }
  if (p.type === "link" && p.to === "Company" && me?.default_company) return me.default_company;
  return "";
}

function ReportInner({ name, def, catalogError, me }: { name: string; def?: ReportDef; catalogError: unknown; me?: Me }) {
  const [sp, setSp] = useSearchParams();
  const params = def?.params ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p.name, sp.get(p.name) ?? defaultFor(p, me)])),
  );
  const ran = sp.has("run");
  const runParams: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (k !== "run") runParams[k] = v;
  });

  const result = useQuery({
    queryKey: ["report", name, runParams],
    queryFn: ({ signal }) => api.get<ReportResult>(`/api/reports/${encodeURIComponent(name)}`, runParams, signal),
    enabled: ran,
  });

  const run = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams({ run: "1" });
    for (const [k, v] of Object.entries(values)) if (v) next.set(k, v);
    setSp(next);
    if (ran && next.toString() === sp.toString()) void result.refetch();
  };

  const title = def?.label ?? result.data?.label ?? humanize(name);
  const data = result.data;

  const downloadCsv = () => {
    if (!data) return;
    saveBlob(new Blob(["﻿" + toCsv(data)], { type: "text/csv;charset=utf-8" }), `${name}-${todayIso()}.csv`);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="crumbs">Report</p>
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="page-actions">
          {data && data.rows.length > 0 && (
            <Button icon="download" onClick={downloadCsv}>
              Download CSV
            </Button>
          )}
        </div>
      </div>

      {!def && (
        <Alert tone={catalogError ? "warning" : "info"}>
          {catalogError ? "Could not load the report catalogue. " : "This report publishes no parameters. "}
          You can still run it.
        </Alert>
      )}

      <form className="card card-pad" onSubmit={run} style={{ marginBottom: 16 }} aria-label="Report parameters">
        {params.length > 0 && (
          <div className="form-grid" style={{ ["--cols" as string]: 3, marginBottom: 14 }}>
            {params.map((p) => (
              <ParamInput key={p.name} param={p} value={values[p.name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))} />
            ))}
          </div>
        )}
        <Button type="submit" variant="primary" loading={result.isFetching}>
          Run report
        </Button>
      </form>

      {!ran ? (
        <div className="card">
          <EmptyState title="Set the parameters and run the report" icon="chart" />
        </div>
      ) : result.error ? (
        <div className="card">
          <ErrorState error={result.error} onRetry={() => result.refetch()} title="The report could not be run" />
        </div>
      ) : !data ? (
        <div className="card">
          <PageLoading label="Running report…" />
        </div>
      ) : (
        <ReportTable data={data} />
      )}
    </div>
  );
}

function ParamInput({ param: p, value, onChange }: { param: ReportParam; value: string; onChange: (v: string) => void }) {
  const id = `rp-${p.name}`;
  const label = p.label ?? humanize(p.name);
  if (p.type === "check") {
    return (
      <div className="field">
        <div className="check-field">
          <input type="checkbox" id={id} checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "")} />
          <label htmlFor={id}>{label}</label>
        </div>
      </div>
    );
  }
  const hint = typeof p.default === "string" && SERVER_DEFAULTS[p.default] ? `Defaults to ${SERVER_DEFAULTS[p.default]}` : undefined;
  return (
    <FieldWrap label={label} htmlFor={id} required={p.required} hint={hint}>
      {p.type === "link" && p.to ? (
        <LinkInput to={p.to} id={id} value={value || null} required={p.required} onChange={(v) => onChange(v ?? "")} />
      ) : p.type === "select" ? (
        <select id={id} className="select" value={value} required={p.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(p.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} className="input" type={p.type === "date" ? "date" : "text"} value={value} required={p.required} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldWrap>
  );
}

const isNumeric = (c: Column) => NUMERIC_TYPES.has(c.type ?? "");

function display(c: Column, row: Row | Record<string, unknown>, key = c.name): string {
  const v = row[key];
  const titles = (row as Row)._titles;
  if (titles?.[key]) return titles[key];
  return formatValue({ type: c.type ?? "data" }, v);
}

/** Totals keyed by column go in the footer; any other totals and scalar `meta` become a summary. */
function splitTotals(data: ReportResult) {
  const names = new Set((data.columns ?? []).map((c) => c.name));
  const totals = data.totals ?? {};
  const aligned = Object.keys(totals).some((k) => names.has(k));
  const extra = Object.entries(totals).filter(([k]) => !names.has(k));
  const meta = Object.entries(data.meta ?? {}).filter(([k, v]) => k !== "truncated" && (v === null || typeof v !== "object"));
  return { aligned, extra, meta };
}

function summaryValue(v: unknown, money: boolean): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (isDecimalString(v)) return formatValue({ type: money ? "currency" : "decimal" }, v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return v === null || v === undefined ? "" : String(v);
}

function ReportTable({ data }: { data: ReportResult }) {
  const cols = data.columns ?? [];
  const { aligned, extra, meta } = splitTotals(data);
  if (!data.rows.length) {
    return (
      <div className="card">
        <EmptyState title="No rows for these parameters" icon="chart" />
      </div>
    );
  }
  return (
    <div className="card">
      {data.meta?.truncated === true && (
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Alert tone="warning">The result was truncated: only the first rows are shown. Narrow the parameters to see everything.</Alert>
        </div>
      )}
      {(extra.length > 0 || meta.length > 0) && (
        <dl className="summary">
          {extra.map(([k, v]) => (
            <div key={`t-${k}`}>
              <dt>{humanize(k)}</dt>
              <dd className="num">{summaryValue(v, true)}</dd>
            </div>
          ))}
          {meta.map(([k, v]) => (
            <div key={`m-${k}`}>
              <dt>{humanize(k)}</dt>
              <dd>{summaryValue(v, false)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="table-wrap">
        <table className="table report">
          <caption className="sr-only">{data.label ?? data.name}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.name} scope="col" className={isNumeric(c) ? "num" : undefined}>
                  {c.label ?? humanize(c.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className={r._bold ? "bold" : undefined}>
                {cols.map((c, j) => (
                  <td
                    key={c.name}
                    className={isNumeric(c) ? "num" : undefined}
                    style={j === 0 && r._indent ? { paddingLeft: `${0.75 + Number(r._indent) * 1.25}rem` } : undefined}
                  >
                    {display(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {aligned && (
            <tfoot>
              <tr>
                {cols.map((c, j) => (
                  <td key={c.name} className={isNumeric(c) ? "num" : undefined}>
                    {data.totals?.[c.name] == null ? (j === 0 ? "Total" : "") : display(c, data.totals ?? {})}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** CSV of the raw (unformatted, exact) values, guarded against spreadsheet formula injection. */
function toCsv(data: ReportResult): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !isDecimalString(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = data.columns ?? [];
  const lines = [cols.map((c) => cell(c.label ?? c.name)).join(",")];
  for (const r of data.rows) {
    lines.push(cols.map((c, j) => cell(j === 0 && r._indent ? `${"  ".repeat(Number(r._indent))}${r[c.name] ?? ""}` : r[c.name])).join(","));
  }
  const { aligned, extra, meta } = splitTotals(data);
  if (aligned) lines.push(cols.map((c, j) => cell(data.totals?.[c.name] ?? (j === 0 ? "Total" : ""))).join(","));
  if (extra.length || meta.length) lines.push("");
  for (const [k, v] of [...extra, ...meta]) lines.push(`${cell(humanize(k))},${cell(v)}`);
  return lines.join("\r\n");
}
