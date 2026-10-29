// Apps' screens (lib/screens.ts): the sandboxed frame with its bridge, and where screens appear —
// pages (/x/<app>/<page>), settings pages (/apps/<app>/settings), widgets on Home, panels on forms.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getSession, request } from "../lib/api";
import { useMe } from "../lib/meta";
import { SCREEN_PROTOCOL, screenTheme, screenUrl, serveScreen, useContributions, type Contribution, type Slot } from "../lib/screens";
import { useResolvedTheme } from "../lib/theme";
import { EmptyState, Spinner, confirmDialog, toast } from "../ui/kit";

export function ScreenFrame({ c, slot, record, fill }: { c: Contribution; slot: Slot; record?: { entity: string; id: string; version?: number }; fill?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof serveScreen> | null>(null);
  const navigate = useNavigate();
  const me = useMe().data;
  const theme = useResolvedTheme();
  // Widgets start at their declared height (grid rows of 80 px); any screen may resize itself.
  const [height, setHeight] = useState(slot === "ui.widget" ? (c.size?.[1] ?? 2) * 80 : 320);
  const tenant = getSession()?.tenant;
  // The bridge reads the latest values when the screen asks, not those of the render that connected it.
  const latest = useRef({ me, record, navigate });
  latest.current = { me, record, navigate };

  const connect = () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    bridge.current?.close();
    const channel = new MessageChannel();
    bridge.current = serveScreen(channel.port1, {
      app: c.app,
      context: () => {
        const { me, record } = latest.current;
        return {
          app: c.app,
          slot,
          user: { email: me?.user.email ?? "", name: me?.user.full_name ?? "" },
          locale: navigator.language,
          theme: screenTheme(),
          record: record && { entity: record.entity, id: record.id },
        };
      },
      call: (r) => request(r.path, { method: r.method, query: r.query, body: r.body, headers: { "x-ferrum-app": c.app } }),
      navigate: (to) => latest.current.navigate(to),
      toast,
      confirm: (o) => confirmDialog(o),
      resize: (h) => setHeight(h),
    });
    // The frame's origin is opaque, so "*": the port goes to whatever document the frame holds, and the
    // web app's Content Security Policy keeps that document one of ours.
    win.postMessage({ ferrum: "init", version: SCREEN_PROTOCOL }, "*", [channel.port2]);
  };

  useEffect(() => () => bridge.current?.close(), []);
  useEffect(() => bridge.current?.emit("theme", screenTheme()), [theme]);
  useEffect(() => {
    if (record) bridge.current?.emit("record", { entity: record.entity, id: record.id, version: record.version });
  }, [record?.entity, record?.id, record?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tenant) return null;
  return (
    <iframe
      ref={frame}
      className={fill ? "screen-frame fill" : "screen-frame"}
      title={c.title ?? c.id}
      src={screenUrl(tenant, c)}
      sandbox="allow-scripts allow-downloads"
      referrerPolicy="no-referrer"
      style={fill ? undefined : { height }}
      onLoad={connect}
    />
  );
}

function ScreenRoute({ slot, title, find }: { slot: Slot; title: string; find: (c: Contribution) => boolean }) {
  const q = useContributions(slot);
  if (q.isPending) return <Spinner label="Loading" />;
  const c = q.data?.find(find);
  if (!c) {
    return (
      <EmptyState title={`${title} is not available`} icon="apps">
        <p className="muted">
          The app that adds it may be disabled or removed. <Link to="/apps">Open Apps</Link>
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="screen-page">
      <ScreenFrame c={c} slot={slot} fill />
    </div>
  );
}

/** `/x/:app/:page`: an app's page. */
export function ScreenPage() {
  const { app, page } = useParams();
  return <ScreenRoute slot="ui.page" title="This page" find={(c) => c.app === app && c.id === page} />;
}

/** `/apps/:app/settings`: an app's own settings page. */
export function AppSettingsPage() {
  const { app } = useParams();
  return <ScreenRoute slot="ui.settings" title="This app's settings" find={(c) => c.app === app} />;
}

/** Apps' widgets, on a 12-column grid. */
export function ScreenWidgets() {
  const widgets = useContributions("ui.widget").data ?? [];
  if (!widgets.length) return null;
  return (
    <div className="screen-widgets">
      {widgets.map((w) => (
        <section key={`${w.app}/${w.id}`} className="card" style={{ gridColumn: `span ${w.size?.[0] ?? 4}` }} aria-label={w.title}>
          <div className="card-head">
            <h2>{w.title}</h2>
          </div>
          <ScreenFrame c={w} slot="ui.widget" />
        </section>
      ))}
    </div>
  );
}
