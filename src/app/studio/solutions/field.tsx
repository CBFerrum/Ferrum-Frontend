// The kit's field for the solution and run pages: it names the single control it holds to assistive
// technology whatever that control is (the kit's names only a native element). Every control these pages put
// in a field (Input, Textarea, a native select) takes an id, so the label always reaches it.

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Field as KitField } from "@/ui/kit";

export function Field({ label, hint, required, error, className, children }: { label: ReactNode; hint?: ReactNode; required?: boolean; error?: string; className?: string; children: ReactNode }) {
  const auto = useId();
  const only = isValidElement<{ id?: string }>(children) ? children : null;
  const id = only?.props.id ?? auto;
  const control = only && !only.props.id ? cloneElement(only as ReactElement<{ id?: string }>, { id }) : children;
  return (
    <KitField label={label} hint={hint} required={required} error={error} className={className} htmlFor={only ? id : undefined}>
      {control}
    </KitField>
  );
}
