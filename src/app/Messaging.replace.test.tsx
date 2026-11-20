// @vitest-environment jsdom
// Turning on a connection where another of its kind is on (TP-2): the 409 names the other one; the person is asked, and a yes saves again
// with `replace: true`; a no sends nothing more and leaves the form as it was.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newChannel } from "../lib/channelDraft";
import { ConfirmHost } from "../ui/kit";
import { ChannelDialog } from "./Messaging";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));
const conflict = json(409, { error: "conflict", message: 'the text channel "Old gateway" is enabled: turn it off first, or save this one with replace to turn it off' });
const press = async (name: string) => {
  await act(async () => [...document.querySelectorAll("button")].filter((b) => b.textContent === name).at(-1)!.click());
  await flush();
};
const bodies = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));

async function open(answers: Response[]) {
  const fetchMock = vi.fn(async () => answers.shift()!);
  vi.stubGlobal("fetch", fetchMock);
  const onDone = vi.fn();
  const start = { ...newChannel("text"), name: "New gateway", url: "https://sms.example/send", form: [{ key: "k", name: "to", value: "{{ to }}" }] };
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ChannelDialog start={start} onClose={() => {}} onDone={onDone} />
        <ConfirmHost />
      </QueryClientProvider>,
    ),
  );
  await press("Save");
  return { fetchMock, onDone };
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("saving a connection that would turn another off", () => {
  it("asks, then saves again with replace", async () => {
    const { fetchMock, onDone } = await open([conflict, json(200, { id: "c9" })]);
    expect(document.body.textContent).toContain("Old gateway is the enabled Text message channel. Turn it off and use this one?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await press("Turn it off and use this one");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = bodies(fetchMock);
    expect(first.replace).toBeUndefined();
    expect(second.replace).toBe(true);
    expect(onDone).toHaveBeenCalled();
  });

  it("sends nothing more when the person cancels, and the form stays open", async () => {
    const { fetchMock, onDone } = await open([conflict]);
    await press("Cancel");
    expect(document.body.textContent).not.toContain("Turn it off and use this one?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Add a connection");
  });
});
