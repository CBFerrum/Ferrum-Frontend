// Bringing a spreadsheet in: choose a file, say which column is which field, see what is wrong before
// anything is saved, then watch it go. Rows go in small batches, each row on its own: one bad row
// never stops the rest, and whatever failed comes back as a file to fix and bring in again.

import { useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useMemo, useState } from "react";
import { api, docPath, errorMessage, saveBlob } from "../../lib/api";
import { parseCsv, toCsv } from "../../lib/csv";
import { buildRecords, type Built, guessMapping, importable, missingRequired, type Problem } from "../../lib/importing";
import type { Doc, EntityMeta, Field, ListResponse } from "../../lib/meta";
import { Alert, Button, Dialog, Icon, Spinner } from "../../ui/kit";

const BATCH = 200;
const MAX_SHOWN = 20;

type Step = "file" | "map" | "checking" | "review" | "sending" | "done";

interface Failure {
  row: number;
  why: string;
}

/** Each title a link column names, found among the records it links to. */
async function resolveLinks(fields: Field[], rows: string[][], mapping: (string | null)[]) {
  const out: Record<string, Map<string, string>> = {};
  for (const [column, name] of mapping.entries()) {
    const f = fields.find((x) => x.name === name);
    if (!f || f.type !== "link" || !f.to) continue;
    const found = new Map<string, string>();
    const meta = await api.get<EntityMeta>(`/api/meta/${encodeURIComponent(f.to)}`);
    const title = meta.title_field ?? "name";
    const wanted = [...new Set(rows.map((r) => (r[column] ?? "").trim()).filter(Boolean))];
    for (let i = 0; i < wanted.length; i += 100) {
      const page = await api.get<ListResponse>(docPath(f.to), { filters: JSON.stringify([[title, "in", wanted.slice(i, i + 100)]]), fields: title, limit: 500 });
      for (const r of page.rows as Doc[]) found.set(String(r[title]).toLowerCase(), String(r.id));
    }
    out[f.name] = found;
  }
  return out;
}

function why(e: { error?: string; message?: string; fields?: { field: string; message: string }[] }): string {
  if (e.fields?.length) return e.fields.map((f) => `${f.field}: ${f.message}`).join("; ");
  return e.message ?? e.error ?? "refused";
}

function ProblemList({ problems, total }: { problems: Problem[]; total: number }) {
  return (
    <div className="import-problems">
      <table className="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Column</th>
            <th>Problem</th>
          </tr>
        </thead>
        <tbody>
          {problems.slice(0, MAX_SHOWN).map((p, i) => (
            <tr key={i}>
              <td className="num">{p.row}</td>
              <td>{p.field}</td>
              <td>{p.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > MAX_SHOWN && <p className="muted">And {total - MAX_SHOWN} more.</p>}
    </div>
  );
}

export function ImportDialog({ meta, onClose }: { meta: EntityMeta; onClose: () => void }) {
  const qc = useQueryClient();
  const fields = useMemo(() => importable(meta.fields), [meta]);
  const [step, setStep] = useState<Step>("file");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [sent, setSent] = useState(0);
  const [created, setCreated] = useState(0);
  const [failed, setFailed] = useState<Failure[]>([]);
  const [header, ...body] = rows;
  const label = meta.label_plural.toLowerCase();

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (/\.xlsx?$/i.test(file.name)) {
      setError("Save the spreadsheet as CSV first: File, Save As, CSV.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setError("That file has no rows under its header.");
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setMapping(guessMapping(parsed[0], fields));
    setStep("map");
  };

  const check = async () => {
    setStep("checking");
    setError(null);
    try {
      setBuilt(buildRecords(body, mapping, fields, await resolveLinks(fields, body, mapping)));
      setStep("review");
    } catch (e) {
      setError(errorMessage(e));
      setStep("map");
    }
  };

  const send = async () => {
    if (!built) return;
    setStep("sending");
    let done = 0;
    const lost: Failure[] = [];
    for (let i = 0; i < built.records.length; i += BATCH) {
      const batch = built.records.slice(i, i + BATCH);
      try {
        const r = await api.post<{ created: number; errors: { row: number; error?: string; message?: string; fields?: { field: string; message: string }[] }[] }>(docPath(meta.name, "_import"), batch.map((b) => b.doc));
        done += r.created;
        lost.push(...r.errors.map((e) => ({ row: batch[e.row].row, why: why(e) })));
      } catch (e) {
        // The batch may not have gone at all: say so for each row, so it can be sent again.
        lost.push(...batch.map((b) => ({ row: b.row, why: errorMessage(e) })));
      }
      setSent(Math.min(i + BATCH, built.records.length));
      setCreated(done);
    }
    setFailed(lost);
    setStep("done");
    void qc.invalidateQueries({ queryKey: ["list", meta.name] });
  };

  /** What did not go in, as a file to fix and bring in again. */
  const saveFailures = () => {
    const reasons = new Map<number, string>();
    for (const p of built?.problems ?? []) reasons.set(p.row, [reasons.get(p.row), `${p.field}: ${p.message}`].filter(Boolean).join("; "));
    for (const f of failed) reasons.set(f.row, f.why);
    const lines = [...reasons.keys()].sort((a, b) => a - b).map((row) => [...(rows[row - 1] ?? []), reasons.get(row) ?? ""]);
    saveBlob(new Blob([toCsv([[...header, "Why it did not import"], ...lines])], { type: "text/csv" }), `${meta.name}-to-fix.csv`);
  };

  const missing = missingRequired(fields, mapping);
  const problemRows = new Set(built?.problems.map((p) => p.row)).size;
  const footer =
    step === "map" ? (
      <>
        <Button onClick={() => setStep("file")}>Back</Button>
        <Button variant="primary" disabled={missing.length > 0 || !mapping.some(Boolean)} onClick={() => void check()}>
          Check {body.length.toLocaleString()} {body.length === 1 ? "row" : "rows"}
        </Button>
      </>
    ) : step === "review" ? (
      <>
        <Button onClick={() => setStep("map")}>Back</Button>
        <Button variant="primary" disabled={!built?.records.length} onClick={() => void send()}>
          Import {built?.records.length.toLocaleString()} {built?.records.length === 1 ? "row" : "rows"}
        </Button>
      </>
    ) : step === "done" ? (
      <>
        {(failed.length > 0 || problemRows > 0) && (
          <Button icon="download" onClick={saveFailures}>
            Download what needs fixing
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </>
    ) : undefined;

  return (
    <Dialog open wide onClose={onClose} title={`Import ${label}`} footer={footer}>
      {error && <Alert tone="error">{error}</Alert>}
      {step === "file" && (
        <label className="import-drop">
          <Icon name="upload" size={22} />
          <strong>Choose a CSV file</strong>
          <span className="muted">The first row holds the column names.</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void choose(e)} />
        </label>
      )}
      {step === "map" && (
        <div className="stack">
          <p className="muted">
            {fileName}: {body.length.toLocaleString()} {body.length === 1 ? "row" : "rows"}. Say which field each column fills.
          </p>
          {missing.length > 0 && <Alert tone="warning">Every {meta.label.toLowerCase()} needs {missing.map((f) => f.label).join(", ")}: choose a column for it.</Alert>}
          <table className="table import-map">
            <thead>
              <tr>
                <th>Column</th>
                <th>Example</th>
                <th>Field</th>
              </tr>
            </thead>
            <tbody>
              {(header ?? []).map((h, i) => (
                <tr key={i}>
                  <td>{h || <span className="faint">Column {i + 1}</span>}</td>
                  <td className="muted">{body.find((r) => r[i]?.trim())?.[i]}</td>
                  <td>
                    <select
                      className="select"
                      aria-label={`Field for ${h || `column ${i + 1}`}`}
                      value={mapping[i] ?? ""}
                      onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? e.target.value || null : v === e.target.value ? null : v)))}
                    >
                      <option value="">Skip this column</option>
                      {fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}
                          {f.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {step === "checking" && <Spinner label="Checking the rows" />}
      {step === "review" && built && (
        <div className="stack">
          {built.records.length > 0 && (
            <Alert tone="success">
              {built.records.length.toLocaleString()} {built.records.length === 1 ? "row is" : "rows are"} ready.
            </Alert>
          )}
          {built.problems.length > 0 ? (
            <>
              <Alert tone="warning">
                {problemRows.toLocaleString()} {problemRows === 1 ? "row needs" : "rows need"} fixing and will be left out. You can download them afterwards.
              </Alert>
              <ProblemList problems={built.problems} total={built.problems.length} />
            </>
          ) : (
            <p className="muted">Nothing is wrong with this file.</p>
          )}
        </div>
      )}
      {step === "sending" && built && (
        <div className="stack" role="status">
          <progress className="import-progress" max={built.records.length} value={sent} aria-label="Imported so far" />
          <p className="muted">
            {sent.toLocaleString()} of {built.records.length.toLocaleString()}
          </p>
        </div>
      )}
      {step === "done" && (
        <div className="stack" role="status">
          <Alert tone={created ? "success" : "warning"}>
            {created.toLocaleString()} {created === 1 ? meta.label.toLowerCase() : label} imported.
          </Alert>
          {failed.length > 0 && <ProblemList problems={failed.map((f) => ({ row: f.row, field: "", message: f.why }))} total={failed.length} />}
          {problemRows > 0 && <p className="muted">{problemRows.toLocaleString()} more were left out when checking.</p>}
        </div>
      )}
    </Dialog>
  );
}
