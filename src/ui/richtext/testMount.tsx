// Shared by the editor's tests: draws a tree, waits for the editor's lazy chunk and for `onEditor` to have fired.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

export async function mount(ui: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(ui));
  for (let i = 0; i < 400 && !host.querySelector(".ProseMirror"); i++) await act(() => new Promise((r) => setTimeout(r, 20)));
  await act(() => new Promise((r) => setTimeout(r, 20)));
  return { host, unmount: () => act(() => root.unmount()) };
}
