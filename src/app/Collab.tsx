// Discussion on any record: assignees, tags, following, attachments and comments
// (server: /api/v1/{entity}/{id}/comments|assignments|tags|follow|attachments).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, docPath, download, errorMessage } from "../lib/api";
import { formatDate, relativeTime } from "../lib/format";
import { useMe } from "../lib/meta";
import { uploadFile } from "../lib/files";
import { Badge, Button, confirmDialog, Dialog, Field as FieldWrap, Icon, PageLoading, toast, useDismiss } from "../ui/kit";
import { t as tr, isolate } from "@ferrum/client";

export interface Person {
  id: string;
  full_name: string;
  email: string;
}
interface Comment {
  id: string;
  body: string;
  author?: string | null;
  author_email?: string | null;
  created_at: string;
  edited_at?: string | null;
  mine: boolean;
}
interface Assignment {
  id: string;
  user: string;
  user_name?: string | null;
  assigned_by: string;
  note?: string | null;
  due_date?: string | null;
  priority: string;
  status: string;
}
interface Attachment {
  id: string;
  file_name: string;
  size_bytes: number;
  url: string;
  created_by?: string | null;
}

/** People mentioned with `@Full Name` (or `@email`) in a comment, matched against the directory. */
export function mentionedIn(text: string, people: Person[]): string[] {
  const lower = text.toLowerCase();
  return people.filter((p) => (p.full_name && lower.includes(`@${p.full_name.toLowerCase()}`)) || lower.includes(`@${p.email.toLowerCase()}`)).map((p) => p.id);
}

export const usePeople = () =>
  useQuery({ queryKey: ["people"], queryFn: ({ signal }) => api.get<{ users: Person[] }>("/api/users", undefined, signal), staleTime: 5 * 60_000 });

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function CollabPanel({ entity, id, canWrite }: { entity: string; id: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const me = useMe().data;
  const people = usePeople().data?.users ?? [];
  const key = (part: string) => ["collab", entity, id, part];
  const comments = useQuery({ queryKey: key("comments"), queryFn: ({ signal }) => api.get<{ comments: Comment[] }>(docPath(entity, id, "comments"), undefined, signal) });
  const assignments = useQuery({
    queryKey: key("assignments"),
    queryFn: ({ signal }) => api.get<{ assignments: Assignment[] }>(docPath(entity, id, "assignments"), undefined, signal),
  });
  const tags = useQuery({ queryKey: key("tags"), queryFn: ({ signal }) => api.get<{ tags: string[] }>(docPath(entity, id, "tags"), undefined, signal) });
  const follow = useQuery({ queryKey: key("follow"), queryFn: ({ signal }) => api.get<{ following: boolean }>(docPath(entity, id, "follow"), undefined, signal) });
  const files = useQuery({
    queryKey: key("attachments"),
    queryFn: ({ signal }) => api.get<{ attachments: Attachment[] }>(docPath(entity, id, "attachments"), undefined, signal),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["collab", entity, id] });

  const [assigning, setAssigning] = useState(false);
  // Resolves to whether `fn` succeeded, so a caller can keep what the user typed when it did not.
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      await refresh();
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    }
  };

  const open = (assignments.data?.assignments ?? []).filter((a) => a.status === "Open");
  return (
    <div className="collab">
      <aside className="collab-side">
        <section aria-label={tr("Assigned to")}>
          <h3 className="field-label">{tr("Assigned to")}</h3>
          <ul className="people">
            {open.map((a) => (
              <li key={a.id} className="person" title={[a.note, a.due_date && tr("Due {value}", { value: formatDate(a.due_date) })].filter(Boolean).join(" · ")}>
                <span className="avatar" aria-hidden="true">
                  {isolate(initials(a.user_name ?? "?"))}
                </span>
                <span className="person-name">
                  {isolate(a.user_name ?? "")}
                  {a.due_date && <span className="faint"> {tr("· due {value}", { value: formatDate(a.due_date) })}</span>}
                  {a.note && <span className="person-note faint">{isolate(a.note)}</span>}
                </span>
                {a.priority === "High" && <Badge tone="red">{tr("High")}</Badge>}
                {(a.user === me?.user.id || a.assigned_by === me?.user.id || me?.user.is_admin) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={tr("Mark {user_name}'s assignment done", { user_name: String(a.user_name) })}
                    title={tr("Done")}
                    onClick={() => void run(() => api.post(`/api/assignments/${a.id}/close`, { status: "Done" }), tr("Marked done"))}
                  >
                    <Icon name="check" size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Button size="sm" icon="plus" onClick={() => setAssigning(true)}>
            {tr("Assign")}
          </Button>
        </section>

        <section aria-label={tr("Tags")}>
          <h3 className="field-label">{tr("Tags")}</h3>
          <TagEditor tags={tags.data?.tags ?? []} canWrite={canWrite} onChange={(next) => run(() => api.put(docPath(entity, id, "tags"), { tags: next }))} />
        </section>

        <section aria-label={tr("Attachments")}>
          <h3 className="field-label">{tr("Attachments")}</h3>
          <Attachments entity={entity} id={id} files={files.data?.attachments ?? []} onChanged={refresh} />
        </section>

        <Button
          size="sm"
          variant="ghost"
          icon="bell"
          aria-pressed={!!follow.data?.following}
          onClick={() => void run(() => api.put(docPath(entity, id, "follow"), { following: !follow.data?.following }), follow.data?.following ? tr("Unfollowed") : tr("Following: you will be notified of changes"))}
        >
          {follow.data?.following ? tr("Following") : tr("Follow")}
        </Button>
      </aside>

      <section className="collab-main" aria-label={tr("Comments")}>
        {comments.isLoading ? (
          <PageLoading label={tr("Loading comments…")} />
        ) : (
          <ul className="comments">
            {(comments.data?.comments ?? []).map((c) => (
              <CommentItem key={c.id} c={c} canDelete={c.mine || !!me?.user.is_admin} onChanged={refresh} />
            ))}
            {!comments.data?.comments.length && <li className="muted">{tr("No comments yet.")}</li>}
          </ul>
        )}
        <Composer people={people} onPost={(body, mentions) => run(() => api.post(docPath(entity, id, "comments"), { body, mentions }))} />
      </section>

      <AssignDialog open={assigning} people={people} onClose={() => setAssigning(false)} onAssign={(body) => run(() => api.post(docPath(entity, id, "assignments"), body), "Assigned")} />
    </div>
  );
}

function CommentItem({ c, canDelete, onChanged }: { c: Comment; canDelete: boolean; onChanged: () => unknown }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.patch(`/api/comments/${c.id}`, { body: editing });
      setEditing(null);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: tr("Delete this comment?"), confirmLabel: tr("Delete"), danger: true }))) return;
    try {
      await api.del(`/api/comments/${c.id}`);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <li className="comment">
      <span className="avatar" aria-hidden="true">
        {isolate(initials(c.author ?? "?"))}
      </span>
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{c.author ?? tr("Someone")}</strong> <span className="faint">{isolate(relativeTime(c.created_at))}</span>
          {c.edited_at && <span className="faint"> {tr("· edited")}</span>}
          <span className="spacer" />
          {c.mine && editing === null && (
            <button type="button" className="link-btn" onClick={() => setEditing(c.body)}>
              {tr("Edit")}
            </button>
          )}
          {canDelete && editing === null && (
            <button type="button" className="link-btn danger" onClick={() => void remove()}>
              {tr("Delete")}
            </button>
          )}
        </div>
        {editing === null ? (
          <p className="comment-text">{isolate(c.body)}</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            <textarea className="textarea" aria-label={tr("Edit comment")} value={editing} rows={3} onChange={(e) => setEditing(e.target.value)} />
            <div className="row">
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={!editing.trim()}>
                {tr("Save")}
              </Button>
              <Button size="sm" onClick={() => setEditing(null)}>
                {tr("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function Composer({ people, onPost }: { people: Person[]; onPost: (body: string, mentions: string[]) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // `@` followed by what was typed so far, at the cursor: suggest people.
  const [query, setQuery] = useState<string | null>(null);
  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q)).slice(0, 6);
  }, [people, query]);
  // Escape or a press outside closes the suggestions (phone keyboards have no Escape).
  useDismiss(form, matches.length > 0, () => setQuery(null));

  const onInput = (value: string) => {
    setText(value);
    const at = ref.current?.selectionStart ?? value.length;
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, at));
    setQuery(m ? m[1]! : null);
  };
  const pick = (p: Person) => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at).replace(/@([^\s@]{0,30})$/, `@${p.full_name || p.email} `);
    setText(before + text.slice(at));
    setQuery(null);
    el?.focus();
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const posted = await onPost(text.trim(), mentionedIn(text, people));
    setBusy(false);
    if (!posted) return; // offline or refused: keep the comment to try again
    setText("");
    setQuery(null);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  };
  return (
    <form ref={form} className="composer" onSubmit={submit}>
      <label htmlFor="comment-new" className="sr-only">
        {tr("Add a comment")}
      </label>
      <textarea
        id="comment-new"
        ref={ref}
        className="textarea"
        rows={3}
        placeholder={tr("Add a comment… use @ to mention someone")}
        value={text}
        maxLength={20000}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={onKey}
      />
      {matches.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label={tr("Mention someone")}>
          {matches.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                <strong>{p.full_name || p.email}</strong> <span className="faint">{isolate(p.email)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <span className="faint keys-hint" style={{ fontSize: 12 }}>
          {tr("Ctrl/⌘ + Enter to post")}
        </span>
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!text.trim()}>
          {tr("Comment")}
        </Button>
      </div>
    </form>
  );
}

function TagEditor({ tags, canWrite, onChange }: { tags: string[]; canWrite: boolean; onChange: (next: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().replace(/\s+/g, " ");
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return setDraft("");
    void onChange([...tags, t]).then((ok) => ok && setDraft(""));
  };
  return (
    <div className="chips">
      {tags.map((t) => (
        <span key={t} className="chip-removable">
          {isolate(t)}
          {canWrite && (
            <button type="button" className="icon-btn" aria-label={tr("Remove tag {t}", { t })} onClick={() => void onChange(tags.filter((x) => x !== t))}>
              <Icon name="x" size={12} />
            </button>
          )}
        </span>
      ))}
      {canWrite && (
        <input
          className="input tag-input"
          aria-label={tr("Add a tag")}
          placeholder={tr("Add tag")}
          maxLength={60}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      )}
      {!tags.length && !canWrite && <span className="muted">{tr("None")}</span>}
    </div>
  );
}

function Attachments({ entity, id, files, onChanged }: { entity: string; id: string; files: Attachment[]; onChanged: () => unknown }) {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadFile(file, { entity, id });
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (f: Attachment) => {
    if (!(await confirmDialog({ title: tr("Delete {file_name}?", { file_name: f.file_name }), confirmLabel: tr("Delete"), danger: true }))) return;
    try {
      await api.del(`/api/files/${f.id}`);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      {files.map((f) => (
        <div key={f.id} className="row" style={{ flexWrap: "nowrap" }}>
          <button type="button" className="link-btn row attachment" onClick={() => download(f.url, f.file_name).catch((e) => toast(errorMessage(e), "error"))}>
            <Icon name="file" size={14} />
            <span className="attachment-name">{isolate(f.file_name)}</span>
          </button>
          <span className="faint nowrap">{tr("{n} KB", { n: Math.max(1, Math.round(f.size_bytes / 1024)) })}</span>
          <button type="button" className="icon-btn" aria-label={tr("Delete {file_name}", { file_name: f.file_name })} onClick={() => void remove(f)}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
      <label className="btn btn-default btn-sm" style={{ alignSelf: "flex-start" }} aria-busy={busy}>
        <Icon name="upload" />
        {busy ? tr("Uploading…") : tr("Attach file")}
        <input type="file" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} disabled={busy} />
      </label>
    </div>
  );
}

function AssignDialog({
  open,
  people,
  onClose,
  onAssign,
}: {
  open: boolean;
  people: Person[];
  onClose: () => void;
  onAssign: (body: { user: string; note?: string; due_date?: string; priority: string }) => Promise<boolean>;
}) {
  const [user, setUser] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("Medium");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!(await onAssign({ user, note: note.trim() || undefined, due_date: due || undefined, priority }))) return; // keep the form to retry
    setUser("");
    setNote("");
    setDue("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={tr("Assign")}>
      <form className="stack" onSubmit={submit}>
        <FieldWrap label={tr("Person")} htmlFor="as-user" required>
          <select id="as-user" className="select" value={user} onChange={(e) => setUser(e.target.value)} required>
            <option value="">{tr("Choose…")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </FieldWrap>
        <div className="form-grid">
          <FieldWrap label={tr("Due")} htmlFor="as-due">
            <input id="as-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </FieldWrap>
          <FieldWrap label={tr("Priority")} htmlFor="as-priority">
            <select id="as-priority" className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option>{tr("Low")}</option>
              <option>{tr("Medium")}</option>
              <option>{tr("High")}</option>
            </select>
          </FieldWrap>
        </div>
        <FieldWrap label={tr("Note")} htmlFor="as-note">
          <textarea id="as-note" className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </FieldWrap>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!user}>
            {tr("Assign")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
