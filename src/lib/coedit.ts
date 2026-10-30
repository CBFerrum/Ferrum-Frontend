// Documents people edit together live (`/ws/docs/{package}/{id}`, the server's coedit.rs): a Yjs
// document kept in sync over one socket, who else is in it (awareness), and whether everything
// typed here is stored. The session token goes in the first message, never in the URL.
//
// Changes typed while the connection is down stay in this tab and go to the server when it is
// back (its sync step carries everything it lacks). The server says how many of this tab's change
// messages it has stored (`{"stored": n}`); until then they count as unsaved.

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

export type Access = "read" | "write";

export interface Person {
  id: string;
  name: string;
  color: string;
}

export interface CoeditState {
  /** Connected and signed in. */
  online: boolean;
  /** The server's content has arrived at least once: the document can be shown. */
  loaded: boolean;
  access: Access | null;
  me: Person | null;
  /** Changes typed here that the server has not stored yet. */
  unsaved: boolean;
  /** What went wrong, for the person (a refused change, access ended...). */
  error: string | null;
  /** Closed for good: reconnecting would not help. */
  closed: boolean;
}

/** The parts of a WebSocket the session uses (tests give their own). */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

const SYNC = 0;
const AWARENESS = 1;
const QUERY_AWARENESS = 3;
const OPEN = 1;
/** A question every 20 s; no answer to anything for 45 s means the connection died unnoticed. */
const PING = 20_000;
const SILENCE = 45_000;
const LOST = "You can only view this document now; your latest changes were not saved.";
/** Closes after which trying again would not help. */
const FINAL: Record<number, string> = {
  4400: "This tab's copy of the document could not be sent. Reload the page to continue.",
  4403: "Your access to this document has ended.",
  4404: "This document does not exist, or you do not have access to it.",
};

export function socketUrl(pkg: string, id: string, loc: { protocol: string; host: string } = location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws/docs/${encodeURIComponent(pkg)}/${encodeURIComponent(id)}`;
}

/** Waits before the next attempt: 1 s doubling to 30 s, with jitter so tabs do not return at once. */
export function backoff(attempt: number, random = Math.random): number {
  return Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + random() / 2);
}

export class CoeditSession {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  state: CoeditState = { online: false, loaded: false, access: null, me: null, unsaved: false, error: null, closed: false };
  private ws: SocketLike | null = null;
  private listeners = new Set<() => void>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private lastHeard = 0;
  /** This connection's change messages sent and stored; changes made while it was down. */
  private sent = 0;
  private stored = 0;
  private dirty = false;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly token: () => string | undefined,
    private readonly open: (url: string) => SocketLike = (u) => new WebSocket(u) as unknown as SocketLike,
  ) {
    this.doc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.reconnectNow);
      window.addEventListener("pagehide", this.leaveAwareness);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.connect();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = (): CoeditState => this.state;

  private set(next: Partial<CoeditState>) {
    const unsaved = this.dirty || this.sent > this.stored;
    const merged = { ...this.state, unsaved, ...next };
    if (Object.keys(merged).every((k) => merged[k as keyof CoeditState] === this.state[k as keyof CoeditState])) return;
    this.state = merged;
    this.listeners.forEach((l) => l());
  }

  private connect() {
    const token = this.token();
    if (this.stopped || this.state.closed) return;
    if (!token) {
      this.set({ closed: true, error: "Your session has ended. Sign in again to keep editing." });
      return;
    }
    let ws: SocketLike;
    try {
      ws = this.open(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ auth: token }));
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      this.lastHeard = Date.now();
      if (typeof m.data === "string") this.onText(ws, m.data);
      else if (m.data instanceof ArrayBuffer) this.onBinary(ws, new Uint8Array(m.data));
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      // Sent but not confirmed: they are still in this document and go with the next sync step.
      if (this.sent > this.stored) this.dirty = true;
      this.sent = 0;
      this.stored = 0;
      // Others' cursors are not shown while this tab cannot see them move.
      const others = [...this.awareness.getStates().keys()].filter((c) => c !== this.doc.clientID);
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
      const final = FINAL[e.code] ?? (e.code === 4401 ? "Your session has ended. Sign in again to keep editing." : null);
      if (this.stopped) return;
      if (final) {
        this.set({ online: false, closed: true, error: final });
        return;
      }
      this.set({ online: false });
      this.scheduleReconnect();
    };
    ws.onerror = () => undefined;
  }

  private scheduleReconnect() {
    clearTimeout(this.retryTimer);
    if (this.stopped) return;
    this.retryTimer = setTimeout(() => this.connect(), backoff(this.attempt++));
  }

  /** The network is back, or the tab is shown again: try now rather than at the next backoff. */
  private reconnectNow = () => {
    if (this.stopped || this.state.closed || this.ws) return;
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.connect();
  };

  private onVisible = () => {
    if (document.visibilityState === "visible") this.reconnectNow();
  };

  private send(data: Uint8Array): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN || !this.state.online) return false;
    ws.send(data);
    return true;
  }

  private onText(ws: SocketLike, text: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.ready) {
      this.attempt = 0;
      const me = msg.user as Person;
      const access: Access = msg.access === "write" ? "write" : "read";
      // Back with view access only: what was typed here meanwhile cannot be stored.
      const lost = access === "read" && this.dirty ? LOST : null;
      this.set({ online: true, access, me, error: lost ?? (this.state.error === LOST ? LOST : null) });
      this.awareness.setLocalStateField("user", { name: me.name, color: me.color });
      // Our state vector (the server answers with what we lack), and who we are.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      ws.send(encoding.toUint8Array(encoder));
      this.sendAwareness([this.doc.clientID]);
      clearInterval(this.pingTimer);
      this.lastHeard = Date.now();
      this.pingTimer = setInterval(() => this.ping(ws), PING);
    } else if (typeof msg.stored === "number") {
      this.stored = Math.max(this.stored, msg.stored);
      this.set({});
    } else if (msg.access === "read" || msg.access === "write") {
      this.set({ access: msg.access, error: msg.access === "read" && this.sent > this.stored ? LOST : this.state.error });
    } else if (typeof msg.error === "string") {
      this.set({ error: msg.error });
    }
  }

  private onBinary(ws: SocketLike, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, SYNC);
      const kind = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      if (kind === syncProtocol.messageYjsSyncStep1) {
        // Everything the server lacks, changes made while offline included.
        ws.send(encoding.toUint8Array(encoder));
        this.sent++;
        this.dirty = false;
        this.set({});
      } else if (kind === syncProtocol.messageYjsSyncStep2 && !this.state.loaded) {
        this.set({ loaded: true });
      }
    } else if (type === AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    }
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SYNC);
    syncProtocol.writeUpdate(encoder, update);
    if (this.send(encoding.toUint8Array(encoder))) this.sent++;
    else this.dirty = true;
    this.set({});
  };

  /** Only this tab's own state goes out: others' arrive from the server, and time out there. */
  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    const mine = [...added, ...updated, ...removed].filter((c) => c === this.doc.clientID);
    if (mine.length) this.sendAwareness(mine);
  };

  private sendAwareness(clients: number[]) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    this.send(encoding.toUint8Array(encoder));
  }

  private ping(ws: SocketLike) {
    if (this.ws !== ws) return;
    if (Date.now() - this.lastHeard > SILENCE) {
      // Nothing for a long time: the connection died without telling us.
      ws.close(4000, "no answer");
      ws.onclose?.({ code: 4000, reason: "no answer" });
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, QUERY_AWARENESS);
    this.send(encoding.toUint8Array(encoder));
  }

  private leaveAwareness = () => {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "leave");
  };

  /** Leaves the document: this tab's cursor goes, the socket closes, nothing reconnects. */
  destroy() {
    if (this.stopped) return;
    this.leaveAwareness();
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.reconnectNow);
      window.removeEventListener("pagehide", this.leaveAwareness);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "left");
    this.doc.off("update", this.onUpdate);
    this.awareness.off("update", this.onAwareness);
    this.awareness.destroy();
    this.doc.destroy();
  }
}

/** The people in the document besides this tab, as their awareness says (names from the server). */
export function othersIn(awareness: awarenessProtocol.Awareness): (Person & { client: number })[] {
  const out: (Person & { client: number })[] = [];
  awareness.getStates().forEach((state, client) => {
    const user = (state as { user?: Partial<Person> }).user;
    if (client === awareness.clientID || !user?.name) return;
    // One entry per person, however many tabs they have open.
    if (user.id && out.some((p) => p.id === user.id)) return;
    out.push({ client, id: user.id ?? String(client), name: user.name, color: user.color ?? "#64748b" });
  });
  return out;
}
