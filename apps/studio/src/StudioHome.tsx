// Studio's home (docs/plan/apps-ui.md §13): what the person may open — reports, dashboards and
// spaces, the latest first — and where to start a new one. Charts and number cards are the
// dashboards page's tabs; Customize is the platform's (/data/customize/).

import { Blocks, ChartColumn, FileChartColumn, Hash, LayoutDashboard, ListChecks, PanelsTopLeft, Plus, SlidersHorizontal, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { useMe } from "@/lib/meta";
import { useStudioList, type StudioKind, type StudioListRow } from "@/lib/studio";
import { PageHeader } from "@/app/studio/dashboard/ui";
import { PATHS } from "@/app/studio/space/model";
import { t, isolate } from "@ferrum/client";

/** The most recently changed first. */
export function latest<T extends { updated_at: string }>(rows: T[], n: number): T[] {
  return [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, n);
}

interface Section {
  kind: StudioKind;
  title: string;
  description: string;
  icon: ReactNode;
  all: string;
  create: string;
  open: (r: StudioListRow) => string;
}

const SECTIONS: Section[] = [
  {
    kind: "reports",
    get title() { return t("Reports"); },
    get description() { return t("Tables of any records, filtered, grouped and totalled."); },
    icon: <FileChartColumn aria-hidden />,
    all: "/studio/reports",
    create: "/studio/reports/new",
    open: (r) => PATHS.report(r.id),
  },
  {
    kind: "dashboards",
    get title() { return t("Dashboards"); },
    get description() { return t("Charts and number cards on one page."); },
    icon: <LayoutDashboard aria-hidden />,
    all: "/studio/dashboards",
    create: "/studio/dashboards",
    open: (r) => PATHS.dashboard(r.id),
  },
  {
    kind: "spaces",
    get title() { return t("Spaces"); },
    get description() { return t("Pages for a team: shortcuts, lists, charts and notes."); },
    icon: <PanelsTopLeft aria-hidden />,
    all: PATHS.spaces,
    create: PATHS.newSpace,
    open: (r) => PATHS.space(r.id),
  },
];

function Latest({ section }: { section: Section }) {
  const list = useStudioList(section.kind);
  const rows = latest(list.data ?? [], 5);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {section.icon}
          <Link to={section.all} className="hover:underline">
            {isolate(section.title)}
          </Link>
          {list.data && <span className="text-sm font-normal text-muted-foreground tabular-nums">{list.data.length}</span>}
        </CardTitle>
        <CardDescription>{isolate(section.description)}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="icon-sm" aria-label={t("New in {title}", { title: section.title })} title={t("New")}>
            <Link to={section.create}>
              <Plus />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <div className="grid gap-2" aria-busy="true" aria-label={t("Loading {title}", { title: section.title })}>
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-8 w-full" />
            ))}
          </div>
        ) : list.error ? (
          <p className="text-sm text-muted-foreground">{t("Could not load them.")}</p>
        ) : rows.length ? (
          <ul className="grid gap-0.5">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={section.open(r)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.label || t("Untitled")}</span>
                  {!r.mine && r.sharing !== "private" && <Badge variant="secondary">{t("Shared")}</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground">{isolate(relativeTime(r.updated_at))}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="gap-2 p-4">
            <EmptyHeader>
              <EmptyTitle className="text-sm">{t("None yet")}</EmptyTitle>
              <EmptyDescription>
                <Link to={section.create}>{t("Make the first one")}</Link>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function Count({ kind, label, to, icon }: { kind: StudioKind; label: string; to: string; icon: ReactNode }) {
  const n = useStudioList(kind).data?.length;
  return (
    <Link to={to} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:no-underline [&_svg]:size-4">
      {icon}
      <span className="font-medium text-foreground">{isolate(label)}</span>
      <span className="text-muted-foreground tabular-nums">{n ?? "…"}</span>
    </Link>
  );
}

export function StudioHome() {
  const me = useMe().data;
  return (
    <div className="grid w-full gap-6">
      <PageHeader
        title={t("Studio")}
        description={t("Reports, charts, dashboards and spaces, built without code. What they show always follows each viewer's own permissions.")}
        actions={
          <>
            <Button asChild size="sm">
              <Link to="/studio/reports/new">
                <Plus /> {t("New report")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((s) => (
          <Latest key={s.kind} section={s} />
        ))}
      </div>
      <nav aria-label={t("More in Studio")} className="flex flex-wrap gap-x-2 gap-y-1 border-t pt-4">
        <Count kind="charts" label={t("Charts")} to="/studio/dashboards?tab=charts" icon={<ChartColumn aria-hidden />} />
        <Count kind="cards" label={t("Number cards")} to="/studio/dashboards?tab=cards" icon={<Hash aria-hidden />} />
        <Link to="/studio/tasks" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:no-underline [&_svg]:size-4">
          <ListChecks aria-hidden />
          <span className="font-medium text-foreground">{t("Tasks")}</span>
        </Link>
        <Link to="/studio/runs" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:no-underline [&_svg]:size-4">
          <Workflow aria-hidden />
          <span className="font-medium text-foreground">{t("Runs")}</span>
        </Link>
        {(me?.user.is_admin || me?.user.roles.includes("Solution Author")) && (
          <Link to="/studio/solutions" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:no-underline [&_svg]:size-4">
            <Blocks aria-hidden />
            <span className="font-medium text-foreground">{t("Solutions")}</span>
          </Link>
        )}
        {me?.user.is_admin && (
          <a href="/data/customize/" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:no-underline [&_svg]:size-4">
            <SlidersHorizontal aria-hidden />
            <span className="font-medium text-foreground">{t("Customize your records")}</span>
          </a>
        )}
      </nav>
    </div>
  );
}
