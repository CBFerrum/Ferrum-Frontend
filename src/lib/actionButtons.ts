// Which of a record's actions are buttons, and which of those are pressed in vain: the pure part of FormView's row of buttons.

import { evaluate } from "./expr";
import type { ActionDef } from "./meta";

export interface ButtonState {
  action: ActionDef;
  /** Why pressing it would be refused (a `refuse_if` that holds on this record), or null when it can be pressed. */
  refusal: string | null;
}

export interface ButtonContext {
  doc: Record<string, unknown>;
  user: unknown;
  docstatus: number;
  /** The old test of the caller's rights, used when the server sends no `may_run`. */
  permitted: (a: ActionDef) => boolean;
}

/** The buttons to show, in order. A button the server says the caller may not press (`may_run` false) is left out;
 *  an older server says nothing, and the caller's rights are judged by `permitted`. A refusal whose expression the
 *  browser cannot evaluate does not count: the server decides when the button is pressed. */
export function actionButtons(actions: ActionDef[], c: ButtonContext): ButtonState[] {
  const out: ButtonState[] = [];
  for (const a of actions) {
    if (a.hidden) continue;
    if (a.docstatus?.length && !a.docstatus.includes(c.docstatus)) continue;
    if (a.may_run === undefined ? !c.permitted(a) : a.may_run === false) continue;
    if (a.condition && evaluate(a.condition, { doc: c.doc, user: c.user }) === false) continue;
    const refused = (a.refuse_if ?? []).find((r) => r.when && evaluate(r.when, { doc: c.doc, user: c.user, params: {} }) === true);
    out.push({ action: a, refusal: refused ? refused.message : null });
  }
  return out;
}
