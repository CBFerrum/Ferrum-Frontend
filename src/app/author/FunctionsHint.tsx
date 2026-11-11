// "Functions": what an expression may call (docs/builder/expressions.md), one example each, folded away until wanted.
// The browser does not evaluate them: the server does when the customization is saved and run.

import { t as tr } from "@ferrum/client";

const GROUPS: [() => string, [string, string][]][] = [
  [() => tr("Dates"), [
    ["addDays, addMonths, addYears", "addDays(doc.due, 30)"], ["startOfMonth, endOfMonth", "doc.due <= endOfMonth(today)"], ["weekday", "weekday(doc.visit) < 6"],
    ["daysBetween, monthsBetween", "daysBetween(doc.ordered, doc.delivered) > 14"], ["year, month, day", "month(doc.posting_date) == 3"], ["formatDate", "formatDate(doc.due, '%d %B %Y')"],
  ]],
  [() => tr("Text"), [
    ["lower, upper", "lower(doc.stage) == 'check'"], ["trim", "doc.name.trim() != ''"], ["replace", "doc.phone.replace(' ', '')"], ["substring, indexOf", "doc.number.substring(0, 3)"],
    ["split, join", "doc.tags.split(',')"], ["padStart, padEnd", "padStart(string(doc.seq), 5, '0')"], ["concat", "concat(doc.first, ' ', doc.last)"],
  ]],
  [() => tr("Empty and settings"), [
    ["isEmpty", "isEmpty(doc.valid_months)"], ["coalesce", "coalesce(doc.discount, 0)"], ["settings", "settings.XClaimPolicy.limit"],
  ]],
];

/** A collapsible list of the functions; the browser checks none of them. */
export function FunctionsHint() {
  return (
    <details className="field-hint">
      <summary>{tr("Functions")}</summary>
      {GROUPS.map(([title, rows]) => (
        <div key={title()}>
          <strong>{title()}</strong>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {rows.map(([names, example]) => (
              <li key={names}>
                <code className="mono" dir="ltr">{names}</code>: <code className="mono" dir="ltr">{example}</code>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}
