// Home (docs/plan/apps-ui.md §8): the apps the person may use, what is assigned to them, and the
// widgets apps contribute. Each app's own home is in the app.

import { useQuery } from "@tanstack/react-query";
import { FirstRun } from "@/app/FirstRun";
import { MyWork } from "@/app/Home";
import { ScreenWidgets } from "@/app/Screen";
import { api, errorMessage } from "@/lib/api";
import { EmptyState, Spinner } from "@/ui/kit";
import "./shell.css";

interface LauncherEntry {
  id: string;
  app: string;
  title: string;
  description?: string | null;
  color?: string | null;
  url: string;
  classic?: boolean;
}

interface ShellInfo {
  person: { name: string; admin: boolean };
  workspace: { name: string };
  apps: LauncherEntry[];
}

/** A tile's colour: the app's own, else one derived from its name (as the bar's launcher does). */
export function tileColour(e: Pick<LauncherEntry, "color" | "title">): string {
  if (e.color && /^#[0-9a-f]{6}$/i.test(e.color)) return e.color;
  let h = 0;
  for (const c of e.title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

export function ShellHome() {
  const info = useQuery({ queryKey: ["shell"], queryFn: ({ signal }) => api.get<ShellInfo>("/api/shell", undefined, signal) });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = info.data?.person.name.split(" ")[0];
  return (
    <div className="shell-home">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {greeting}
            {first ? `, ${first}` : ""}
          </h1>
          <p className="page-sub">{info.data?.workspace.name}</p>
        </div>
      </div>
      <FirstRun />
      {info.error ? (
        <EmptyState title="Your apps cannot be shown">
          <p className="muted">{errorMessage(info.error)}</p>
        </EmptyState>
      ) : !info.data ? (
        <Spinner label="Loading your apps" />
      ) : info.data.apps.length ? (
        <nav aria-label="Apps" className="shell-apps">
          {info.data.apps.map((a) => (
            <a key={`${a.app}/${a.id}`} className="shell-app" href={a.url} title={a.description ?? undefined}>
              <span className="shell-tile" style={{ background: tileColour(a) }} aria-hidden="true">
                {a.title.slice(0, 1).toUpperCase()}
              </span>
              <span className="shell-app-title">{a.title}</span>
              {a.classic && <span className="faint shell-app-note">classic</span>}
            </a>
          ))}
        </nav>
      ) : (
        <EmptyState title="No apps for you yet">
          <p className="muted">{info.data.person.admin ? <a href="/store/">Install apps</a> : "Ask an administrator to give you access to an app."}</p>
        </EmptyState>
      )}
      <MyWork />
      <ScreenWidgets />
    </div>
  );
}
