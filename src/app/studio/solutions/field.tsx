// The kit's field for the solution and run pages: it names the single control it holds to assistive
// technology whatever that control is (the kit's names only a native element). Every control these pages put
// in a field (Input, Textarea, a native select) takes an id, so the label always reaches it.

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { fieldAria, Field as KitField } from "@/ui/kit";

export function Field({ label, hint, required, error, className, children }: { label: ReactNode; hint?: ReactNode; required?: boolean; error?: string; className?: string; children: ReactNode }) {
  const auto = useId();
  const only = isValidElement<Record<string, unknown>>(children) ? children : null;
  const id = (only?.props.id as string | undefined) ?? auto;
  // Told what the label shows besides its name: required, invalid, and its error or hint.
  const control = only ? cloneElement(only as ReactElement<Record<string, unknown>>, { id, ...fieldAria(only.props, id, { required, error, hint }) }) : children;
  return (
    <KitField label={label} hint={hint} required={required} error={error} className={className} htmlFor={only ? id : undefined}>
      {control}
    </KitField>
  );
}
