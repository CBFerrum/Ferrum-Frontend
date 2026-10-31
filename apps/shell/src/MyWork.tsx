// Home's My work (docs/plan/apps-ui.md §11.8): what waits for the person, from the platform
// (/api/work: assigned to them, waiting for their approval, mentions they have not read) and from
// every app's `shell.work` provider, asked in parallel; one that fails or is slow is left out and
// said so. Most pressing first: overdue, due today, decisions, mentions, then the rest.

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, CalendarClock, Check, ClipboardCheck, Inbox, Stamp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { shell } from "@ferrum/client";
import { AppIcon } from "@ferrum/kit";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorMessage } from "@/lib/api";
import { Badge, Button, toast } from "@/ui/kit";

/** An app's provider, as /api/shell lists them. */
export interface WorkProvider {
  app: string;
  id: string;
  title?: string | null;
  endpoint: string;
}

interface AppEntry {
  app: string;
  title: string;
  icon?: string | null;
  color?: string | null;
}

/** One thing waiting, whatever its source. */
export interface WorkItem {
  key: string;
  source: string;
  kind: string;
  title: string;
  subtitle?: string | null;
  url: string | null;
  due?: string | null;
  priority?: string | null;
  at?: string | null;
  assignment?: string;
  notification?: string;
}

interface Source {
  id: string;
  label: string;
  app?: AppEntry;
}

interface PlatformWork {
  groups: { id: string; title: string; items: Omit<WorkItem, "key" | "source">[] }[];
  partial: boolean;
}

const PLATFORM: Record<string, string> = { assigned: "Assigned", approvals: "Approvals", mentions: "Mentions" };
/** How long an app's provider may take. */
const PROVIDER_MS = 5000;
const FIRST = 8;

/** A same-site page to open, or null (an app's answer is not trusted further). */
const sitePath = (url: unknown) => (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : null);

/** Today in the person's own calendar, as `YYYY-MM-DD`. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Overdue, then due today, then decisions, mentions, the rest by due date; newest first within. */
export function byUrgency(items: WorkItem[], today = localDay()): WorkItem[] {
  const tier = (i: WorkItem) => {
    if (i.due && i.due < today) return 0;
    if (i.due === today) return 1;
    if (i.kind === "approval") return 2;
    if (i.kind === "mention") return 3;
    return i.due ? 4 : 5;
  };
  return [...items].sort((a, b) => tier(a) - tier(b) || (a.due ?? "").localeCompare(b.due ?? "") || (b.at ?? "").localeCompare(a.at ?? ""));
}

function dueLabel(due: string, today: string): { text: string; tone: "red" | "amber" | "neutral" } {
  if (due < today) return { text: "Overdue", tone: "red" };
  if (due === today) return { text: "Today", tone: "amber" };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === localDay(tomorrow)) return { text: "Tomorrow", tone: "neutral" };
  const d = new Date(`${due}T00:00:00`);
  return { text: Number.isNaN(d.getTime()) ? due : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), tone: "neutral" };
}

const KIND_ICON: Record<string, ReactNode> = {
  assignment: <ClipboardCheck aria-hidden />,
  approval: <Stamp aria-hidden />,
  mention: <AtSign aria-hidden />,
};

export function MyWork({ providers, apps }: { providers: WorkProvider[]; apps: AppEntry[] }) {
  const queryClient = useQueryClient();
  const platform = useQuery({ queryKey: ["work"], queryFn: ({ signal }) => api.get<PlatformWork>("/api/work", undefined, signal) });
  const usable = providers.filter((p) => typeof p.endpoint === "string" && p.endpoint.startsWith("/api/"));
  const asked = useQueries({
    queries: usable.map((p) => ({
      queryKey: ["work", p.app, p.id],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const late = AbortSignal.timeout(PROVIDER_MS);
        const body = await api.get<{ items?: unknown }>(p.endpoint, undefined, typeof AbortSignal.any === "function" ? AbortSignal.any([signal, late]) : late);
        return Array.isArray(body?.items) ? (body.items as Record<string, unknown>[]) : [];
      },
    })),
  });
  // New notifications (an assignment, a mention) change what waits: ask again.
  useEffect(() => {
    if (!shell().supports("live")) return;
    return shell().live.subscribe(["notification"], () => void queryClient.invalidateQueries({ queryKey: ["work"] }), {
      resync: () => void queryClient.invalidateQueries({ queryKey: ["work"] }),
    });
  }, [queryClient]);
  const [filter, setFilter] = useState("all");
  const [all, setAll] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const today = localDay();

  const sources: Source[] = [];
  let items: WorkItem[] = [];
  {
    for (const g of platform.data?.groups ?? []) {
      sources.push({ id: g.id, label: PLATFORM[g.id] ?? g.title });
      for (const i of g.items) items.push({ ...i, key: `${g.id}/${String((i as { id?: unknown }).id ?? i.url)}`, source: g.id, url: sitePath(i.url) });
    }
    usable.forEach((p, n) => {
      const id = `${p.app}.${p.id}`;
      const app = apps.find((a) => a.app === p.app);
      sources.push({ id, label: p.title ?? app?.title ?? p.app, app });
      for (const [k, raw] of (asked[n]?.data ?? []).entries()) {
        const url = sitePath(raw.url);
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        if (!title || !url) continue;
        const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
        items.push({
          key: `${id}/${k}/${url}`,
          source: id,
          kind: "app",
          title,
          subtitle: text(raw.subtitle),
          url,
          due: typeof raw.due === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.due) ? raw.due.slice(0, 10) : null,
          priority: text(raw.priority),
          at: text(raw.updated_at),
        });
      }
    });
    items = items.filter((i) => !done.has(i.key));
  }

  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.source, (counts.get(i.source) ?? 0) + 1);
  const shown = byUrgency(filter === "all" ? items : items.filter((i) => i.source === filter), today);
  const visible = all ? shown : shown.slice(0, FIRST);
  const failed = [
    ...(platform.error ? ["your assignments, approvals and mentions"] : platform.data?.partial ? ["some of your work"] : []),
    ...usable.flatMap((p, n) => (asked[n]?.error ? [sources.find((s) => s.id === `${p.app}.${p.id}`)?.label ?? p.app] : [])),
  ];
  const loading = platform.isPending || asked.some((q) => q.isPending);

  async function markDone(item: WorkItem) {
    if (!item.assignment) return;
    setDone((d) => new Set(d).add(item.key));
    try {
      await api.post(`/api/assignments/${encodeURIComponent(item.assignment)}/close`, { status: "Done" });
      toast("Marked as done");
      void queryClient.invalidateQueries({ queryKey: ["work"] });
    } catch (e) {
      setDone((d) => {
        const next = new Set(d);
        next.delete(item.key);
        return next;
      });
      toast(errorMessage(e), "error");
    }
  }

  function opened(item: WorkItem) {
    // A mention opened from here is read, as from the bell.
    if (item.notification) void fetch(`/api/notifications/${encodeURIComponent(item.notification)}/read`, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
  }

  const sourceOf = (id: string) => sources.find((s) => s.id === id);
  return (
    <section className="shell-work" aria-labelledby="shell-work-title">
      <div className="shell-work-head">
        <h2 id="shell-work-title">My work</h2>
        {items.length > 0 && (
          <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && (setFilter(v), setAll(false))} aria-label="Show">
            <ToggleGroupItem value="all">
              All <span className="shell-work-count">{items.length}</span>
            </ToggleGroupItem>
            {sources
              .filter((s) => counts.get(s.id))
              .map((s) => (
                <ToggleGroupItem key={s.id} value={s.id}>
                  {s.label} <span className="shell-work-count">{counts.get(s.id)}</span>
                </ToggleGroupItem>
              ))}
          </ToggleGroup>
        )}
      </div>
      {loading && !items.length ? (
        <div className="shell-work-list" aria-busy="true" aria-label="Loading your work">
          {[0, 1, 2].map((n) => (
            <div key={n} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : !items.length ? (
        <Empty className="shell-work-list border-solid">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Nothing is waiting for you</EmptyTitle>
            <EmptyDescription>What is assigned to you, decisions you make, and mentions show up here, from every app.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="shell-work-list">
          {visible.map((item) => {
            const source = sourceOf(item.source);
            const due = item.due ? dueLabel(item.due, today) : null;
            const body = (
              <>
                <ItemMedia variant="icon" className="shell-work-media">
                  {item.kind === "app" && source?.app ? <AppIcon name={source.app.icon} color={source.app.color} title={source.app.title} tile size={14} /> : (KIND_ICON[item.kind] ?? <CalendarClock aria-hidden />)}
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="shell-work-title">{item.title}</ItemTitle>
                  {(item.subtitle || filter === "all") && (
                    <ItemDescription className="shell-work-sub">{[item.subtitle, filter === "all" && item.kind === "app" ? source?.label : null].filter(Boolean).join(" · ")}</ItemDescription>
                  )}
                </ItemContent>
              </>
            );
            return (
              <Item key={item.key} size="sm" className="shell-work-item" asChild={false}>
                {item.url ? (
                  <a className="shell-work-link" href={item.url} onClick={() => opened(item)}>
                    {body}
                  </a>
                ) : (
                  <div className="shell-work-link">{body}</div>
                )}
                <ItemActions className="shell-work-actions">
                  {item.priority === "High" && <Badge tone="red">High</Badge>}
                  {due && <Badge tone={due.tone}>{due.text}</Badge>}
                  {item.assignment && (
                    <Button variant="ghost" size="sm" className="shell-work-done" aria-label={`Mark “${item.title}” done`} title="Mark done" onClick={() => void markDone(item)}>
                      <Check aria-hidden size={16} />
                    </Button>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      )}
      {shown.length > FIRST && (
        <Button variant="ghost" size="sm" className="shell-work-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${shown.length}`}
        </Button>
      )}
      {failed.length > 0 && !loading && (
        <p className="shell-work-note" role="status">
          Could not load {failed.join(", ")}.{" "}
          <button type="button" className="shell-link" onClick={() => void queryClient.invalidateQueries({ queryKey: ["work"] })}>
            Try again
          </button>
        </p>
      )}
    </section>
  );
}
