// A translated sentence whose places hold things that are not text (a code in its own style, a
// link, a key): `placed(t("Point the domain at {host} with a CNAME record."), { host: <code>…</code> })`.
// The sentence goes through t() whole, so a language puts the places where its own order has them.

import { Fragment, type ReactNode } from "react";

export function placed(sentence: string, things: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of sentence.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in things)) continue;
    out.push(sentence.slice(last, m.index));
    out.push(<Fragment key={`${m[1]}-${m.index}`}>{things[m[1]]}</Fragment>);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(sentence.slice(last));
  return <>{out}</>;
}
