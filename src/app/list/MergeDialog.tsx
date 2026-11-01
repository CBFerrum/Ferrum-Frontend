// Merging two records that turned out to be one. Pick which record stays and, where they differ,
// which value does; the server then moves every link onto the record that stays, whole or not at
// all. A merge cannot be undone, so it asks why, and the reason goes in the record's history.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, docPath, errorMessage } from "../../lib/api";
import { defaultPicks, differing, mergedValues, type Pick } from "../../lib/merging";
import { recordTitle, type Doc, type EntityMeta, type Field } from "../../lib/meta";
import { Alert, Button, Dialog, ErrorState, Field as FieldWrap, Spinner, toast } from "../../ui/kit";
import { CellValue, LinkInput } from "../widgets";

interface Props {
  meta: EntityMeta;
  first: string;
  /** The other record, when already chosen. */
  second?: string;
  onClose: () => void;
  /** The merge is done; `id` stayed. */
  onDone: (id: string) => void;
}

function Value({ field, doc }: { field: Field; doc: Doc }) {
  const v = doc[field.name];
  return v === null || v === undefined || v === "" ? <span className="faint">Empty</span> : <CellValue field={field} value={v} title={doc._titles?.[field.name]} />;
}

function Compare({ meta, a, b, onClose, onDone }: { meta: EntityMeta; a: Doc; b: Doc; onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const reasonId = useId();
  const [keepId, setKeepId] = useState(String(a.id));
  const keep = String(a.id) === keepId ? a : b;
  const other = keep === a ? b : a;
  const fields = differing(meta.fields, a, b);
  const [picks, setPicks] = useState<Record<string, Pick>>(() => defaultPicks(fields, keep));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = (doc: Doc) => {
    setKeepId(String(doc.id));
    setPicks(defaultPicks(fields, doc));
  };
  const merge = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const values = mergedValues(fields, other, picks);
      if (Object.keys(values).length) await api.patch(docPath(meta.name, keepId), values, { ifMatch: keep.version });
      const done = await api.post<{ links_moved: number }>(docPath(meta.name, keepId, "merge"), { duplicate: String(other.id), reason: reason.trim() });
      toast(`Merged. ${done.links_moved} ${done.links_moved === 1 ? "link" : "links"} moved to ${recordTitle(meta, keep)}.`);
      void qc.invalidateQueries({ queryKey: ["list", meta.name] });
      void qc.invalidateQueries({ queryKey: ["view", meta.name] });
      void qc.invalidateQueries({ queryKey: ["peek", meta.name] });
      onDone(keepId);
    } catch (e) {
      setProblem(errorMessage(e));
      setBusy(false);
    }
  };

  const side = (doc: Doc) => (
    <label key={String(doc.id)} className="merge-side" data-on={doc === keep || undefined}>
      <input type="radio" name="merge-keep" checked={doc === keep} onChange={() => choose(doc)} />
      <span>
        <strong>{recordTitle(meta, doc)}</strong>
        <span className="faint">{doc === keep ? "This one stays" : "This one goes"}</span>
      </span>
    </label>
  );
  return (
    <div className="merge-form">
      <div className="merge-sides">{[a, b].map(side)}</div>
      {fields.length ? (
        <table className="merge-table">
          <caption className="faint">Where they differ, choose what stays.</caption>
          <tbody>
            {fields.map((f) => (
              <tr key={f.name}>
                <th scope="row">{f.label}</th>
                {[keep, other].map((doc) => {
                  const pick: Pick = doc === keep ? "keep" : "other";
                  return (
                    <td key={String(doc.id)}>
                      <label className="merge-value">
                        <input type="radio" name={`merge-${f.name}`} aria-label={`${f.label} from ${recordTitle(meta, doc)}`} checked={picks[f.name] === pick} onChange={() => setPicks((p) => ({ ...p, [f.name]: pick }))} />
                        <Value field={f} doc={doc} />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="faint">Nothing you can change differs between them.</p>
      )}
      <FieldWrap label="Why are you merging them?" htmlFor={reasonId} required>
        <input id={reasonId} className="input" maxLength={500} autoComplete="off" value={reason} placeholder="Entered twice" onChange={(e) => setReason(e.target.value)} />
      </FieldWrap>
      <Alert tone="warning">A merge cannot be undone. Everything linked to “{recordTitle(meta, other)}” moves to “{recordTitle(meta, keep)}”.</Alert>
      {problem && <Alert tone="error">{problem}</Alert>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void merge()}>
          Merge
        </Button>
      </div>
    </div>
  );
}

export function MergeDialog({ meta, first, second, onClose, onDone }: Props) {
  const [other, setOther] = useState(second ?? null);
  const pickerId = useId();
  const load = (id: string | null) => ({
    queryKey: ["peek", meta.name, id],
    enabled: !!id,
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Doc>(docPath(meta.name, id!), { titles: true }, signal),
  });
  const a = useQuery(load(first));
  const b = useQuery(load(other));
  const error = a.error ?? b.error;
  return (
    <Dialog open onClose={onClose} title={`Merge ${meta.label_plural.toLowerCase()}`} wide>
      {error ? (
        <ErrorState error={error} onRetry={() => void (a.error ? a.refetch() : b.refetch())} />
      ) : !other ? (
        <div className="merge-form">
          <FieldWrap label={`Which ${meta.label.toLowerCase()} is the same as this one?`} htmlFor={pickerId}>
            <LinkInput to={meta.name} id={pickerId} value={null} onChange={(v) => setOther(v === first ? null : v)} />
          </FieldWrap>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : a.data && b.data ? (
        <Compare key={String(other)} meta={meta} a={a.data} b={b.data} onClose={onClose} onDone={onDone} />
      ) : (
        <Spinner label="Loading" />
      )}
    </Dialog>
  );
}
