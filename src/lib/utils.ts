import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names, letting later Tailwind classes override earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * For a Radix panel's `onInteractOutside`: a click or focus inside one of the app's native modal dialogs (a
 * confirmation opened from the panel) is not outside the panel, so the panel stays open behind it.
 */
export function insideNativeDialog<E extends Event>(handler?: (e: E) => void) {
  return (e: E) => {
    if (e.target instanceof Element && e.target.closest("dialog[open]")) e.preventDefault();
    else handler?.(e);
  };
}
