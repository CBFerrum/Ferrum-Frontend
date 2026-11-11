import type { Plugin, UserConfig } from "vite";
export const web: string;
export const ACTS_ON_LOAD: string[];
export function sideEffects(id: string): boolean;
export function ferrumApp(configUrl: string, options?: { outDir?: string }): UserConfig;
export function preloadNavIcons(): Plugin;
