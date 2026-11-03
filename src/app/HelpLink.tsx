// The way from a list or a form to what its records are for (the shell's help center, /help/).

import type { EntityMeta } from "../lib/meta";
import { Icon } from "../ui/kit";

export function HelpLink({ meta }: { meta: Pick<EntityMeta, "name" | "label_plural"> }) {
  return (
    <a className="help-link" href={`/help/${encodeURIComponent(meta.name)}`} title={`Help: ${meta.label_plural}`} aria-label={`Help: ${meta.label_plural}`}>
      <Icon name="help" size={16} />
    </a>
  );
}
