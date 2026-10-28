// Installable app: service worker registration, the browser's install prompt, online state.

import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setupPwa(): void {
  // Development serves modules unbundled; caching them would only get in the way.
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // offered from the account menu instead of the browser's banner
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
}

/** Shows the install prompt; null when the browser does not offer one (or it is installed). */
export function useInstall(): (() => Promise<void>) | null {
  const available = useSyncExternalStore(subscribe, () => deferred !== null);
  if (!available) return null;
  return async () => {
    const p = deferred;
    deferred = null;
    notify();
    await p?.prompt();
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
