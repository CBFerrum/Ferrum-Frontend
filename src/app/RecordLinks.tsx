// The signed links issued on a record (BD-23, BD-38): who each was for, when it expires, whether it was opened and used, and
// revoke. The address itself is shown only when it is issued, so it is not here. Loaded when opened.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t, isolate } from "@ferrum/client";
import { api, docPath, errorMessage } from "../lib/api";
import { canRevoke, linkState, LINK_STATES, type IssuedLink } from "../lib/actionLinks";
import { formatMoment } from "../lib/format";
import { Alert, Badge, Button, confirmDialog, toast } from "../ui/kit";
import { ListSkeleton, LoadFailed } from "../ui/patterns";
import { useLinkTitle } from "./widgets";

const when = (v?: string | null) => (v ? formatMoment(v, { dateStyle: "medium", timeStyle: "short" }) : "");
const Person = ({ id }: { id: string }) => <>{isolate(useLinkTitle("User", id) ?? "…")}</>;

export function LinksTable({ entity, id }: { entity: string; id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["record-links", entity, id], queryFn: ({ signal }) => api.get<{ links: IssuedLink[] }>(docPath(entity, id, "links"), undefined, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  const revoke = async (l: IssuedLink) => {
    if (busy) return;
    if (!(await confirmDialog({ title: t("Revoke this link?"), message: t("Whoever has it can no longer use it. This cannot be undone."), confirmLabel: t("Revoke"), danger: true }))) return;
    setBusy(l.id);
    setError(null);
    try {
      await api.del(`/api/links/${l.id}`);
      toast(t("Link revoked"));
      await qc.invalidateQueries({ queryKey: ["record-links", entity, id] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const links = q.data.links;
  if (!links.length) return <p className="muted">{t("No link has been issued for this record.")}</p>;
  return (
    <div className="stack">
      {error && <Alert tone="error">{isolate(error)}</Alert>}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t("For")}</th><th>{t("Lets them")}</th><th>{t("State")}</th><th>{t("Expires")}</th><th>{t("Opened")}</th><th className="num">{t("Used")}</th><th>{t("Issued by")}</th><th><span className="sr-only">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => {
              const s = linkState(l);
              return (
                <tr key={l.id}>
                  <td>{l.recipient ? isolate(l.recipient) : <span className="faint">{t("Anyone with it")}</span>}{l.code && <> <Badge>{t("code first")}</Badge></>}</td>
                  <td>{isolate(l.actions.join(", "))}</td>
                  <td><Badge tone={LINK_STATES[s].tone}>{LINK_STATES[s].label}</Badge></td>
                  <td>{when(l.expires_at)}</td>
                  <td>{l.opened_at ? when(l.opened_at) : t("Not yet")}</td>
                  <td className="num">{l.uses} / {l.max_uses}</td>
                  <td>{l.issued_by ? <Person id={l.issued_by} /> : ""}</td>
                  <td className="num">{canRevoke(s) && <Button size="sm" variant="danger" loading={busy === l.id} disabled={!!busy} onClick={() => void revoke(l)}>{t("Revoke")}</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A closed disclosure on a record page: nothing is asked until it is opened. */
export function RecordLinks({ entity, id }: { entity: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card stack" aria-labelledby="record-links-h">
      <h2 id="record-links-h" className="h3">
        <button type="button" className="link-btn" aria-expanded={open} aria-controls="record-links-body" onClick={() => setOpen(!open)}>
          {open ? t("Hide the links issued") : t("Links issued for this record")}
        </button>
      </h2>
      <div id="record-links-body" hidden={!open}>{open && <LinksTable entity={entity} id={id} />}</div>
    </section>
  );
}
