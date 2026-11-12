// Hidden fields of one permission rule (BD-40): which fields and child tables of its entity its holders neither see nor change.
// The server refuses what keys or reaches the record (the title, a unique field, a field the rule's `where` or `via` uses); its
// refusal is shown as it words it. Saving makes the rule the workspace's own, which stops its package from rewriting it.

import { useState } from "react";
import { t, isolate } from "@ferrum/client";
import { api, errorMessage } from "../lib/api";
import { useEntityMeta } from "../lib/meta";
import { hideChoices, hideSentence, permissionBody, type Rule } from "../lib/ruleHide";
import { Alert, Badge, Button, Dialog } from "../ui/kit";
import { ListSkeleton, LoadFailed } from "../ui/patterns";

export function HideDialog({ role, rule, entityLabel, onClose, onSaved }: { role: string; rule: Rule; entityLabel: string; onClose: () => void; onSaved: () => void }) {
  const meta = useEntityMeta(rule.entity);
  const [hide, setHide] = useState<string[]>(rule.hide ?? []);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const choices = meta.data ? hideChoices(meta.data) : [];
  const label = (n: string) => choices.find((c) => c.name === n)?.label ?? n;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    try {
      await api.put(`/api/admin/roles/${encodeURIComponent(role)}/permissions`, permissionBody(rule, { hide }));
      onSaved();
    } catch (e) {
      setRefused(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t("Hidden fields: {entity}", { entity: entityLabel })}>
      <div className="stack">
        {rule.packaged && <Alert tone="info">{t("This rule follows its package. Saving it here makes it your own, and releases of the package stop rewriting it.")}</Alert>}
        {refused && <Alert tone="error">{isolate(refused)}</Alert>}
        {meta.isLoading && <ListSkeleton rows={4} />}
        {meta.error && <LoadFailed error={meta.error} onRetry={() => void meta.refetch()} />}
        {meta.data && (
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">{t("Hide from holders of this rule")}</legend>
            {choices.map((c) => (
              <label key={c.name} className="check-field">
                <input type="checkbox" checked={hide.includes(c.name)} onChange={(e) => setHide(e.target.checked ? [...hide, c.name] : hide.filter((x) => x !== c.name))} />
                {isolate(c.label)} {c.kind === "table" && <Badge>{t("table")}</Badge>}
              </label>
            ))}
          </fieldset>
        )}
        <p className="muted" aria-live="polite">{isolate(hideSentence(role, entityLabel, hide, label))}</p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{t("Save")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
