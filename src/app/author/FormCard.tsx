import type { FormEvent, ReactNode } from "react";
import { isolate } from "@ferrum/client";
import { Alert, Button } from "../../ui/kit";

/** A card that is a form: a titled body, the server's refusal above the fields, one submit button. */
export function FormCard({ title, onSubmit, busy, submitLabel, children, error }: { title: string; onSubmit: () => Promise<void>; busy: boolean; submitLabel: string; children: ReactNode; error?: string | null }) {
  const id = title.toLowerCase().replace(/\W+/g, "-");
  return (
    <form
      className="card"
      aria-labelledby={id}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      <div className="card-head">
        <h2 id={id}>{isolate(title)}</h2>
      </div>
      <div className="card-body stack">
        {error && <Alert tone="error">{isolate(error)}</Alert>}
        {children}
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            {isolate(submitLabel)}
          </Button>
        </div>
      </div>
    </form>
  );
}
