import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { CoeditSession, type SocketLike, backoff, othersIn, socketUrl } from "./coedit";

/** A socket the test drives: what the page sent, and the server's side of the conversation. */
class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  sent: (string | Uint8Array)[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  text(v: unknown) {
    this.onmessage?.({ data: JSON.stringify(v) });
  }
  binary(b: Uint8Array) {
    this.onmessage?.({ data: b.slice().buffer });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  binaries() {
    return this.sent.filter((m): m is Uint8Array => typeof m !== "string");
  }
}

/** The server's copy of the document, answering the page as coedit.rs does. */
function server(doc: Y.Doc) {
  const step1 = () => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 0);
    syncProtocol.writeSyncStep1(e, doc);
    return encoding.toUint8Array(e);
  };
  /** Takes the page's messages: answers its step 1, applies its changes. Returns the answers. */
  const take = (msgs: Uint8Array[]) => {
    const answers: Uint8Array[] = [];
    for (const m of msgs) {
      const d = decoding.createDecoder(m);
      if (decoding.readVarUint(d) !== 0) continue;
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, 0);
      syncProtocol.readSyncMessage(d, e, doc, "page");
      if (encoding.length(e) > 1) answers.push(encoding.toUint8Array(e));
    }
    return answers;
  };
  return { step1, take };
}

const ready = { ready: true, access: "write", user: { id: "u1", name: "Ana Rao", color: "#1d4ed8" } };
const words = (doc: Y.Doc) => doc.getText("t").toString();

describe("documents edited together", () => {
  let sockets: FakeSocket[];
  let session: CoeditSession;
  const open = () => {
    session = new CoeditSession("ws://erp.test/ws/docs/drive/d1", () => "token-1", (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    });
    return sockets[sockets.length - 1];
  };
  /** Connects as the server would: ready, its step 1, its answer to the page's step 1. */
  const connect = (ws: FakeSocket, srv: ReturnType<typeof server>, access = "write") => {
    ws.open();
    ws.text({ ...ready, access });
    ws.binary(srv.step1());
    for (const a of srv.take(ws.binaries())) ws.binary(a);
  };

  beforeEach(() => {
    sockets = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    session?.destroy();
    vi.useRealTimers();
  });

  it("signs in with the first message, never in the address", () => {
    const ws = open();
    expect(ws.url).toBe("ws://erp.test/ws/docs/drive/d1");
    ws.open();
    expect(ws.sent).toEqual([JSON.stringify({ auth: "token-1" })]);
    expect(socketUrl("drive", "a b", { protocol: "https:", host: "erp.test" })).toBe("wss://erp.test/ws/docs/drive/a%20b");
  });

  it("loads the server's content and is saved once the server says so", () => {
    const remote = new Y.Doc();
    remote.getText("t").insert(0, "Hello");
    const srv = server(remote);
    const ws = open();
    connect(ws, srv);
    expect(words(session.doc)).toBe("Hello");
    expect(session.state).toMatchObject({ online: true, loaded: true, access: "write", me: ready.user });
    expect(session.state.unsaved).toBe(true);
    ws.text({ stored: 1 });
    expect(session.state.unsaved).toBe(false);
    session.doc.getText("t").insert(5, " world");
    expect(session.state.unsaved).toBe(true);
    srv.take(ws.binaries());
    expect(words(remote)).toBe("Hello world");
    ws.text({ stored: 2 });
    expect(session.state.unsaved).toBe(false);
  });

  it("keeps changes made offline and sends them when the connection is back", () => {
    const remote = new Y.Doc();
    const srv = server(remote);
    const ws = open();
    connect(ws, srv);
    ws.text({ stored: 1 });
    session.doc.getText("t").insert(0, "sent but not stored ");
    ws.drop();
    expect(session.state).toMatchObject({ online: false, unsaved: true });
    session.doc.getText("t").insert(0, "offline ");
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(2);
    const again = sockets[1];
    connect(again, srv);
    expect(words(remote)).toBe(words(session.doc));
    expect(words(remote)).toBe("offline sent but not stored ");
    expect(session.state.unsaved).toBe(true);
    again.text({ stored: 1 });
    expect(session.state.unsaved).toBe(false);
  });

  it("stops for good when the document is gone or access ended", () => {
    const ws = open();
    ws.open();
    ws.drop(4404);
    expect(session.state).toMatchObject({ closed: true, online: false });
    expect(session.state.error).toMatch(/does not exist/);
    vi.advanceTimersByTime(120_000);
    expect(sockets.length).toBe(1);
  });

  it("says when changes cannot be saved because access is now view only", () => {
    const srv = server(new Y.Doc());
    const ws = open();
    connect(ws, srv);
    ws.drop();
    session.doc.getText("t").insert(0, "typed while away");
    vi.advanceTimersByTime(30_000);
    connect(sockets[1], srv, "read");
    expect(session.state.access).toBe("read");
    expect(session.state.error).toMatch(/not saved/);
  });

  it("sends only its own cursor, and notices a connection that died silently", () => {
    const ws = open();
    connect(ws, server(new Y.Doc()));
    const before = ws.sent.length;
    const other = new awarenessProtocol.Awareness(new Y.Doc());
    other.setLocalState({ user: { id: "u2", name: "Raj Patel", color: "#047857" } });
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 1);
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(other, [other.clientID]));
    ws.binary(encoding.toUint8Array(e));
    expect(othersIn(session.awareness).map((p) => p.name)).toEqual(["Raj Patel"]);
    expect(ws.sent.length, "someone else's cursor is not sent back").toBe(before);
    session.awareness.setLocalStateField("cursor", 3);
    expect(ws.sent.length).toBe(before + 1);
    vi.advanceTimersByTime(20_000);
    expect(ws.sent.length, "a question keeps the line checked").toBe(before + 2);
    vi.advanceTimersByTime(40_000);
    expect(session.state.online).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(sockets.length).toBe(2);
    other.destroy();
  });

  it("waits longer after each failure, up to 30 seconds", () => {
    expect([0, 1, 2, 10].map((a) => backoff(a, () => 1))).toEqual([1000, 2000, 4000, 30_000]);
    expect(backoff(3, () => 0)).toBe(4000);
  });
});
