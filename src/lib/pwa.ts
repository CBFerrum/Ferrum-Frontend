// The browser's install prompt, online state, and whether a newer version has been deployed since
// this page loaded.

import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
let outdated = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// Apps' interfaces run under the shell, whose runtime tells them of a new release. (Tests load this
// without a window.)
if (typeof window !== "undefined") {
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

/** True once a newer version of the app is deployed than the one this page runs. */
export function useOutdated(): boolean {
  return useSyncExternalStore(subscribe, () => outdated);
}
