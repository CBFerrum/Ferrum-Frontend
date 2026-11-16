export type Finding = { rule: string; file: string; line: number; text: string; hint: string };
export type LintOptions = { dirs?: string[]; files?: string[]; app?: boolean };
export function lintUi(root: string, options?: LintOptions): Finding[];
export function runLint(root: string, options?: LintOptions & { label?: string }): number;
