// Edit history for the builders: undo/redo over whole snapshots (typing into one field coalesces
// into one step), and the three-way merge that rebases unsaved edits onto a version someone else
// saved in the meantime.

import { useCallback, useEffect, useState } from "react";

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The last change's coalescing key and time: typing in one field is one undo step. */
  key?: string;
  at?: number;
}

const LIMIT = 100;
const COALESCE_MS = 1000;

/** JSON with object keys sorted: equal values give equal text whatever order their keys were built in. */
export const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x)) ?? "";
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

export const start = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Records a new state; a change with the same `key` within a second replaces the last step. */
export function record<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (same(next, h.present)) return h;
  if (key && key === h.key && h.at !== undefined && now - h.at < COALESCE_MS) return { ...h, present: next, future: [], at: now };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [], key, at: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/** A value with undo/redo; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) outside text fields when `keys`. */
export function useHistory<T>(initial: T | (() => T), keys = true) {
  const [h, setH] = useState<History<T>>(() => start(typeof initial === "function" ? (initial as () => T)() : initial));
  const set = useCallback((next: T | ((prev: T) => T), key?: string) => setH((cur) => record(cur, typeof next === "function" ? (next as (p: T) => T)(cur.present) : next, key)), []);
  const reset = useCallback((value: T) => setH(start(value)), []);
  const back = useCallback(() => setH(undo), []);
  const forward = useCallback(() => setH(redo), []);
  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        setH(e.shiftKey ? redo : undo);
      } else if (k === "y" && !e.shiftKey) {
        e.preventDefault();
        setH(redo);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys]);
  return { value: h.present, set, reset, undo: back, redo: forward, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

export interface Merged<T> {
  value: T;
  /** Fields both sides changed (mine were kept). */
  conflicts: string[];
}

/**
 * Three-way merge of a record's fields: a field I changed keeps my value, one only they changed
 * takes theirs. `custom` merges particular fields itself (a dashboard's layout, widget by widget).
 */
export function mergeRecord<T extends object>(
  base: T,
  mine: T,
  theirs: T,
  custom: { [K in keyof T]?: (base: T[K], mine: T[K], theirs: T[K]) => T[K] } = {},
): Merged<T> {
  const b = base as Record<string, unknown>;
  const m = mine as Record<string, unknown>;
  const t = theirs as Record<string, unknown>;
  const out: Record<string, unknown> = { ...t };
  const conflicts: string[] = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    const own = (custom as Record<string, ((x: unknown, y: unknown, z: unknown) => unknown) | undefined>)[k];
    if (own) out[k] = own(b[k], m[k], t[k]);
    else if (!same(m[k], b[k])) {
      out[k] = m[k];
      if (!same(t[k], b[k]) && !same(t[k], m[k])) conflicts.push(k);
    }
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { value: out as T, conflicts };
}
