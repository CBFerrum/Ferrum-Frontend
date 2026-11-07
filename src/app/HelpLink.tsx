// The way from a list or a form to what its records are for (the shell's help center, /data/help/).

import type { EntityMeta } from "../lib/meta";
import { Icon } from "../ui/kit";
import { t } from "@ferrum/client";

export function HelpLink({ meta }: { meta: Pick<EntityMeta, "name" | "label_plural"> }) {
  return (
    <a className="help-link" href={`/data/help/${encodeURIComponent(meta.name)}`} title={t("Help: {label_plural}", { label_plural: meta.label_plural })} aria-label={t("Help: {label_plural}", { label_plural: meta.label_plural })}>
      <Icon name="help" size={16} />
    </a>
  );
}
