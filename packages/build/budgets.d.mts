export const ENTRY_JS: number;
export const CSS: number;
export function measure(dir: string, name?: string): { line: string; over: boolean; total: { js: number; css: number } };
