// Which of a record's actions are buttons, and which of those are pressed in vain: the pure part of FormView's row of buttons.

import { evaluate } from "./expr";
import type { ActionDef, Workflow } from "./meta";

export interface ButtonState {
  action: ActionDef;
  /** Why pressing it would be refused (a `refuse_if` that holds on this record), or null when it can be pressed. */
  refusal: string | null;
}

export interface ButtonContext {
  doc: Record<string, unknown>;
  user: unknown;
  docstatus: number;
  /** The caller's rights on this record (their own records only, a rule naming the action): `may_run` is about
   *  the entity and the button's roles, not about this record, so both must hold. */
  permitted: (a: ActionDef) => boolean;
}

/** The buttons to show, in order. A button the server says the caller may not press at all (`may_run` false: its
 *  roles, its permission) is left out, and so is one their rights on this record do not reach. A refusal whose expression the
 *  browser cannot evaluate does not count: the server decides when the button is pressed. */
export function actionButtons(actions: ActionDef[], c: ButtonContext): ButtonState[] {
  const out: ButtonState[] = [];
  for (const a of actions) {
    if (a.hidden) continue;
    if (a.docstatus?.length && !a.docstatus.includes(c.docstatus)) continue;
    if (a.may_run === false || !c.permitted(a)) continue;
    if (a.condition && evaluate(a.condition, { doc: c.doc, user: c.user }) === false) continue;
    // A message with {{ }} or {% %} is filled in by the server (MiniJinja), so the browser does not decide that refusal.
    const refused = (a.refuse_if ?? []).find((r) => r.when && !/\{[{%]/.test(r.message) && evaluate(r.when, { doc: c.doc, user: c.user, params: {} }) === true);
    out.push({ action: a, refusal: refused ? refused.message : null });
  }
  return out;
}

type Step = Workflow["transitions"][number];

/** Whether a workflow step is offered to the caller. The server's `may_take` (entity-wide, same function as when the step is
 *  taken) wins when sent; an older server sends none, so the roles are tested here. Either way a step naming no roles needs
 *  the right to change THIS record (`canWrite`), which `may_take` cannot know for own-rows rules. Guard and state: the caller's. */
export function transitionOffered(t: Step, c: { isAdmin: boolean; roles: string[]; canWrite: boolean }): boolean {
  if (t.may_take === false) return false;
  if (!t.roles.length) return c.canWrite;
  return t.may_take === true || c.isAdmin || t.roles.some((r) => c.roles.includes(r));
}
