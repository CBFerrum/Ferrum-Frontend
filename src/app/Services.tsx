// Administration, Services: whether the office editor and the PDF renderer behind this workspace are set up and answer
// (GET /api/admin/services, administrators only), so that an administrator can see why Word, Excel or PowerPoint files do not open.
// The server sends no address and no token; neither is shown.

import { useQuery } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";
import { api } from "../lib/api";
import { Badge, Button, type Tone } from "../ui/kit";
import { ListSkeleton, LoadFailed, StatePanel } from "../ui/patterns";

/** One finding as the server sends it (server/src/doctor.rs). `level` is `ok`, `warning`, `blocker` or `off` (switched off on purpose); `fix` only when there is something to do. */
export interface ServiceFinding {
  check: string;
  level: string;
  detail: string;
  fix?: string;
}

/** The badge's tone comes from the level id, never from the text. A level a newer server adds is neutral. */
const LEVEL_TONE: Record<string, Tone> = { ok: "green", warning: "amber", blocker: "red", off: "neutral" };
const LEVEL_LABEL: Record<string, () => string> = { ok: () => tr("Working"), warning: () => tr("Needs attention"), blocker: () => tr("Not working"), off: () => tr("Switched off") };
const CHECK_NAME: Record<string, () => string> = { office: () => tr("Office editor"), "office.proof": () => tr("Editor request signing"), pdf: () => tr("PDF renderer") };

/** A check id this version does not know ("pdf.fonts"), humanized: "Pdf fonts". */
export function humanize(id: string): string {
  const s = id.replace(/[._-]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : id;
}

export const levelTone = (level: string): Tone => (Object.prototype.hasOwnProperty.call(LEVEL_TONE, level) ? LEVEL_TONE[level]! : "neutral");
export const levelLabel = (level: string): string => (Object.prototype.hasOwnProperty.call(LEVEL_LABEL, level) ? LEVEL_LABEL[level]!() : humanize(level));
export const checkName = (check: string): string => (Object.prototype.hasOwnProperty.call(CHECK_NAME, check) ? CHECK_NAME[check]!() : humanize(check));

type Q = { data?: { services: ServiceFinding[] }; error: unknown; isLoading: boolean; isFetching?: boolean; refetch: () => unknown };

/** What the server answered, in every state: loading, an older server without the endpoint (404), refused (403), failed, the rows. */
export function ServicesBody({ q }: { q: Q }) {
  if (q.isLoading) return <ListSkeleton rows={3} />;
  const status = (q.error as { status?: unknown } | null)?.status;
  if (status === 404) {
    return (
      <StatePanel kind="empty" title={tr("This server does not report its services yet")}>
        {tr("Update the server to see here whether the office editor and the PDF renderer answer.")}
      </StatePanel>
    );
  }
  if (q.error || !q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <ul className="m-0 list-none p-0" aria-label={tr("Services")}>
      {q.data.services.map((s) => (
        <li key={s.check} className="grid gap-1 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,12rem)_8.5rem_minmax(0,1fr)] sm:items-start sm:gap-x-4">
          <span className="font-medium">{checkName(s.check)}</span>
          <span>
            <Badge tone={levelTone(s.level)}>{levelLabel(s.level)}</Badge>
          </span>
          <div className="min-w-0 break-words">
            <p className={s.level === "off" ? "m-0 text-muted-foreground" : "m-0"}>{isolate(s.detail)}</p>
            {s.fix && (
              <p className="m-0 mt-1 text-muted-foreground">
                {s.level !== "off" && <span className="font-medium">{tr("What to do")}: </span>}
                {isolate(s.fix)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Services() {
  const q = useQuery({ queryKey: ["admin", "services"], queryFn: ({ signal }) => api.get<{ services: ServiceFinding[] }>("/api/admin/services", undefined, signal), retry: false });
  return (
    <section className="card">
      <div className="card-head">
        <h2>{tr("Services")}</h2>
        <span className="spacer" />
        <Button icon="refresh" size="sm" loading={q.isFetching && !q.isLoading} onClick={() => void q.refetch()}>
          {tr("Check again")}
        </Button>
      </div>
      <div className="card-body">
        <p className="muted">{tr("The office editor opens Word, Excel and PowerPoint files in Drive; the PDF renderer prints documents to PDF.")}</p>
      </div>
      <ServicesBody q={q} />
    </section>
  );
}
