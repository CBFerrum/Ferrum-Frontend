// @vitest-environment jsdom
// A space's blocks follow changes on the shell's live channel, which rides the session's cookie: the page holds no
// bearer token, and the old socket that waited for one never connected.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveRefresh } from "./hooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  delete (globalThis as { ferrum?: unknown }).ferrum;
  vi.useRealTimers();
});

describe("live refresh", () => {
  it("subscribes on the shell's channel without any token, and refreshes on a change and after a break", async () => {
    vi.useFakeTimers();
    const off = vi.fn();
    const subscribe = vi.fn((_topics: string | string[], _onChange: (c: Record<string, unknown>) => void, _o?: { resync?: () => void }) => off);
    (globalThis as { ferrum?: unknown }).ferrum = { shell: { live: { subscribe } } };
    const refresh = vi.fn();
    function Blocks() {
      useLiveRefresh(["Customer", "Customer", "SalesInvoice"], refresh, 10);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Blocks />));

    expect(subscribe).toHaveBeenCalledTimes(1);
    const [topics, onChange, o] = subscribe.mock.calls[0]!;
    expect(topics).toEqual(["Customer", "SalesInvoice"]);
    onChange({ event: "Customer.updated", entity: "Customer", id: "c1" });
    onChange({ event: "Customer.updated", entity: "Customer", id: "c2" });
    await act(async () => void vi.advanceTimersByTime(10));
    expect(refresh).toHaveBeenCalledTimes(1);
    o!.resync!();
    await act(async () => void vi.advanceTimersByTime(10));
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    expect(off).toHaveBeenCalledTimes(1);
  });
});
