// Live updates (`/ws/live`): one socket per tab, reconnecting with backoff. Components subscribe
// to entities; messages carry ids only — data always comes through the API, with its permissions.

import { useEffect } from "react";
import { getSession } from "./api";

export interface LiveEvent {
  event: string;
  entity: string;
  id: string;
  actor?: string | null;
}
export interface LiveNotification {
  id: string;
  title: string;
  entity?: string | null;
  record_id?: string | null;
}

type Handler<T> = (v: T) => void;

class LiveClient {
  private ws: WebSocket | null = null;
  private counts = new Map<string, number>();
  private events = new Set<Handler<LiveEvent>>();
  private notifications = new Set<Handler<LiveNotification>>();
  private resyncs = new Set<() => void>();
  private retry = 0;
  private everConnected = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private connect() {
    const token = getSession()?.token;
    if (!token || !this.running || typeof WebSocket === "undefined") return;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/live`);
    this.ws = ws;
    // The token goes in the first message, never in the URL (URLs end up in logs).
    ws.onopen = () => ws.send(JSON.stringify({ auth: token }));
    ws.onmessage = (m) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(m.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.ready) {
        this.retry = 0;
        if (this.counts.size) ws.send(JSON.stringify({ subscribe: [...this.counts.keys()] }));
        // Changes made while disconnected were missed: refresh what is on screen.
        if (this.everConnected) this.resyncs.forEach((r) => r());
        this.everConnected = true;
      } else if (msg.notification) {
        this.notifications.forEach((h) => h(msg.notification as LiveNotification));
      } else if (typeof msg.entity === "string" && typeof msg.id === "string") {
        this.events.forEach((h) => h(msg as unknown as LiveEvent));
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      // 4401: the session ended; the next API call sends the user to sign in.
      if (!this.running || e.code === 4401) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++) * (0.5 + Math.random() / 2);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Reference-counted: the server keeps one subscription per entity per tab. */
  subscribe(entity: string): () => void {
    const n = this.counts.get(entity) ?? 0;
    this.counts.set(entity, n + 1);
    if (n === 0) this.send({ subscribe: [entity] });
    return () => {
      const left = (this.counts.get(entity) ?? 1) - 1;
      if (left > 0) return void this.counts.set(entity, left);
      this.counts.delete(entity);
      this.send({ unsubscribe: [entity] });
    };
  }

  onEvent(h: Handler<LiveEvent>): () => void {
    this.events.add(h);
    return () => void this.events.delete(h);
  }

  onNotification(h: Handler<LiveNotification>): () => void {
    this.notifications.add(h);
    return () => void this.notifications.delete(h);
  }

  onResync(h: () => void): () => void {
    this.resyncs.add(h);
    return () => void this.resyncs.delete(h);
  }
}

export const live = new LiveClient();

/** Calls `handler` for changes to `entity` while the component is mounted. */
export function useLiveEntity(entity: string | undefined, handler: Handler<LiveEvent>) {
  useEffect(() => {
    if (!entity) return;
    const unsubscribe = live.subscribe(entity);
    const off = live.onEvent((e) => {
      if (e.entity === entity) handler(e);
    });
    return () => {
      off();
      unsubscribe();
    };
  }, [entity, handler]);
}
