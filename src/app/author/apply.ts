// Posting customizations (POST /api/customize), shared by every page that authors one: the
// Customize page, the form and workflow designers, and the editors that come after them.

import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

export type Op = Record<string, unknown>;

/** What posting several operations in order came to: how many went through, and the one refused. */
export interface ApplyOutcome {
  done: number;
  failed: { index: number; op: Op; error: unknown } | null;
}

/** Posts the operations one after another and stops at the first refusal (later ones may rest on it). */
export async function postInOrder(post: (op: Op) => Promise<unknown>, ops: Op[]): Promise<ApplyOutcome> {
  for (let index = 0; index < ops.length; index++) {
    try {
      await post(ops[index]);
    } catch (error) {
      return { done: index, failed: { index, op: ops[index], error } };
    }
  }
  return { done: ops.length, failed: null };
}

/** Posts one customization of `entity` and refreshes what shows it; a refusal is thrown. */
export function useApply(entity: string) {
  const qc = useQueryClient();
  return async (op: Op, note?: string) => {
    await api.post("/api/customize", { entity, op, note: note?.trim() || undefined });
    await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
  };
}

/** Several customizations of `entity`, in order, stopping at the first the server refuses; what went through stays. */
export function useApplyAll(entity: string) {
  const qc = useQueryClient();
  return async (ops: Op[], note?: string): Promise<ApplyOutcome> => {
    const out = await postInOrder((op) => api.post("/api/customize", { entity, op, note: note?.trim() || undefined }), ops);
    if (out.done) await Promise.all([qc.invalidateQueries({ queryKey: ["meta"] }), qc.invalidateQueries({ queryKey: ["customize"] })]);
    return out;
  };
}
