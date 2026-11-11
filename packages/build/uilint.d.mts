export type Finding = { rule: string; file: string; line: number; text: string; hint: string };
export type Baseline = Record<string, Record<string, number>>;
export type LintOptions = { dirs?: string[]; files?: string[]; app?: boolean };
export type RatchetEntry = { rule: string; file: string; count: number; allowed: number };
export function lintUi(root: string, options?: LintOptions): Finding[];
export function counts(findings: Finding[]): Baseline;
export function ratchet(findings: Finding[], baseline: Baseline): { over: RatchetEntry[]; improved: RatchetEntry[] };
export function baselineText(findings: Finding[]): string;
export function runLint(root: string, baselinePath: string, options?: LintOptions & { update?: boolean; label?: string }): number;
