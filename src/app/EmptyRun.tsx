import { useState, type ReactNode } from "react";
import { isolate, t as tr } from "@ferrum/client";
import { Icon } from "../ui/kit";

/** Read-only fields with nothing in them, folded into one quiet line ("Not set: A, B, C") that opens, by click or Enter, to the fields as they are. */
export function EmptyRun({ labels, children }: { labels: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="empty-run span-all" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
        <span className="empty-run-text">{open ? tr("Hide empty fields") : tr("Not set: {labels}", { labels: labels.map((l) => isolate(l)).join(", ") })}</span>
      </button>
      {open && children}
    </>
  );
}
