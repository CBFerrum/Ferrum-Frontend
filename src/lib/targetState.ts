// What a service target's state field holds, in words and tone: kept apart from the target editor so the kit's TargetCard
// need not carry the editor.

import { t as tr } from "@ferrum/client";
import type { Tone } from "../ui/kit";

/** The words a state field holds, in the order people meet them. */
export const STATES = ["running", "paused", "met", "met_late", "breached"] as const;
export const stateWords = (): Record<string, string> => ({ running: tr("Running"), paused: tr("Paused"), met: tr("Met"), met_late: tr("Met late"), breached: tr("Breached") });
export const stateTone = (s: string): Tone => ({ running: "blue", paused: "amber", met: "green", met_late: "amber", breached: "red" } as Record<string, Tone>)[s] ?? "neutral";
