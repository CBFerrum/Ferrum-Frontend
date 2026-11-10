import { useQuery } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";
import { api } from "../../lib/api";
import { ErrorState } from "../../ui/kit";

/** The workspace's roles (the list Administration shows). */
export const useRoleNames = () =>
  useQuery({
    queryKey: ["admin", "roles"],
    queryFn: ({ signal }) => api.get<{ roles: { name: string; description?: string | null }[] }>("/api/admin/roles", undefined, signal),
  });

/** A group of checkboxes with a legend: a few of many (roles, fields), by name. `options` that the value names
 *  and the list lacks stay shown, so a package's own choice is not lost by editing. */
export function CheckGroup({ legend, options, value, onChange, empty }: { legend: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; empty?: string }) {
  const known = new Set(options.map((o) => o.value));
  const all = [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="field-label">{legend}</legend>
      {!all.length ? (
        <p className="faint">{empty ?? ""}</p>
      ) : (
        <div className="row" style={{ flexWrap: "wrap", columnGap: 16 }}>
          {all.map((o) => (
            <label key={o.value} className="check-field">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              {isolate(o.label)}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Which of the workspace's roles: a multi-select. */
export function RoleSelect({ legend, value, onChange }: { legend: string; value: string[]; onChange: (v: string[]) => void }) {
  const roles = useRoleNames();
  if (roles.error) return <ErrorState error={roles.error} onRetry={() => roles.refetch()} title={tr("Could not load the roles")} />;
  return <CheckGroup legend={legend} options={(roles.data?.roles ?? []).map((r) => ({ value: r.name, label: r.name }))} value={value} onChange={onChange} empty={roles.isLoading ? tr("Loading…") : tr("No roles defined yet.")} />;
}
