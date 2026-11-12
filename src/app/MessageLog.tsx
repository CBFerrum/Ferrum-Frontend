// What was sent (BD-20): each send of a message is a row with its recipient, channel, template and state. `SendsTable` is the
// table (the Messaging section of Administration shows a person's, by address); `RecordMessages` is the "Messages" panel of a
// record form, whoever may read the record, collapsed when nothing was sent about it.

import { useQuery } from "@tanstack/react-query";
import { t as tr, isolate } from "@ferrum/client";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Badge, ErrorState, PageLoading, type Tone } from "../ui/kit";

export interface Send {
  id: string;
  template: string;
  channel: string;
  recipient: string | null;
  user_id?: string | null;
  entity?: string | null;
  record_id?: string | null;
  language?: string | null;
  state: "queued" | "held" | "sent" | "delivered" | "failed" | "skipped";
  reason?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

const STATE: Record<Send["state"], { tone: Tone; get label(): string }> = {
  queued: { tone: "neutral", get label() { return tr("Queued"); } },
  held: { tone: "amber", get label() { return tr("Held until quiet hours end"); } },
  sent: { tone: "blue", get label() { return tr("Sent"); } },
  delivered: { tone: "green", get label() { return tr("Delivered"); } },
  failed: { tone: "red", get label() { return tr("Failed"); } },
  skipped: { tone: "neutral", get label() { return tr("Skipped"); } },
};
const CHANNEL = (): Record<string, string> => ({ email: tr("E-mail"), text: tr("Text message"), chat: tr("Chat-app message"), inapp: tr("In-app notice") });

export const useSends = (query: Record<string, string>, enabled = true) =>
  useQuery({ queryKey: ["messages", "log", query], queryFn: ({ signal }) => api.get<{ sends: Send[] }>("/api/messages/log", query, signal), enabled, retry: false });

export function SendsTable({ sends, label }: { sends: Send[]; label: string }) {
  const channel = CHANNEL();
  return (
    <div className="table-wrap">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{tr("When")}</th>
            <th scope="col">{tr("To")}</th>
            <th scope="col">{tr("Channel and template")}</th>
            <th scope="col">{tr("State")}</th>
          </tr>
        </thead>
        <tbody>
          {sends.map((s) => {
            const why = s.reason || s.error;
            const state = STATE[s.state] ?? { tone: "neutral" as Tone, label: s.state };
            return (
              <tr key={s.id}>
                <td className="nowrap">
                  <time dateTime={s.created_at}>{formatDateTime(s.created_at)}</time>
                </td>
                <td>{isolate(s.recipient || "—")}</td>
                <td>
                  {channel[s.channel] ?? isolate(s.channel)}
                  <div className="mono faint">{isolate(s.template)}</div>
                </td>
                <td>
                  <Badge tone={state.tone}>{state.label}</Badge>
                  {why && <div className="faint">{isolate(why)}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The record's messages: collapsed when there are none (and while they load), open when there are. */
export function RecordMessages({ entity, id }: { entity: string; id: string }) {
  const q = useSends({ entity, record_id: id });
  const sends = q.data?.sends ?? [];
  return (
    <details className="card" open={sends.length > 0 || undefined}>
      <summary className="card-head" style={{ cursor: "pointer" }}>
        <h2 className="h3" style={{ display: "inline" }}>{sends.length ? tr("Messages ({n})", { n: sends.length }) : tr("Messages")}</h2>
      </summary>
      <div className="card-body">
        {q.isLoading ? (
          <PageLoading />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} title={tr("Could not load the messages")} />
        ) : !sends.length ? (
          <p className="muted">{tr("Nothing has been sent about this record.")}</p>
        ) : (
          <SendsTable sends={sends} label={tr("Messages sent about this record")} />
        )}
      </div>
    </details>
  );
}
