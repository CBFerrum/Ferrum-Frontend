// `/doc/:file`: a Drive document everyone with access edits at once (Ferrum docs/plan/collaboration.md,
// C3). TipTap on a Yjs document the platform keeps in sync (lib/coedit.ts) with everyone's cursors;
// Drive keeps the file: who may open it, sharing, comments, versions and exports.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { api, download, errorMessage, getSession, openPrint } from "../../lib/api";
import { can, useMetaIndex } from "../../lib/meta";
import { CoeditSession, type CoeditState, othersIn, socketUrl } from "../../lib/coedit";
import { docTitle } from "../../lib/livedocs";
import { Alert, Badge, Button, Dialog, EmptyState, Field, Menu, MenuItem, Spinner, confirmDialog, toast } from "../../ui/kit";
import { type ItemInfo, DetailsPanel, allows } from "./Details";
import { usePresence } from "./presence";
import { type Shareable, ShareDialog } from "./Share";
import "./livedoc.css";

/** What the bar says about the document's connection and saving. */
export function statusText(s: Pick<CoeditState, "online" | "loaded" | "unsaved" | "closed">): string {
  if (s.closed) return "Not connected";
  if (!s.loaded) return "Opening…";
  if (!s.online) return s.unsaved ? "Offline: your changes are kept in this tab until the connection is back" : "Reconnecting…";
  return s.unsaved ? "Saving…" : "Saved";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function LiveDocPage() {
  const { file } = useParams();
  const [session, setSession] = useState<CoeditSession | null>(null);
  useEffect(() => {
    if (!file) return;
    const s = new CoeditSession(socketUrl("drive", file), () => getSession()?.token);
    setSession(s);
    return () => {
      setSession(null);
      s.destroy();
    };
  }, [file]);
  const info = useQuery({
    queryKey: ["drive", "item", file],
    queryFn: ({ signal }) => api.get<ItemInfo & { content_type?: string | null }>("/api/app/drive/item_info", { item: file }, signal),
    retry: false,
  });
  if (info.error) {
    return (
      <EmptyState title="This document cannot be opened" icon="file">
        <p className="muted">{errorMessage(info.error)}</p>
        <Link to="/drive">Go to Drive</Link>
      </EmptyState>
    );
  }
  if (!file || !session || !info.data) return <Spinner label="Opening the document" />;
  return <LiveDoc key={file} file={file} session={session} info={info.data} />;
}

function LiveDoc({ file, session, info }: { file: string; session: CoeditSession; info: ItemInfo }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const people = usePeople(session);
  const space = useQuery({
    queryKey: ["drive", "space"],
    queryFn: ({ signal }) => api.get<{ id: string; root_folder: string }>("/api/app/drive/space", undefined, signal),
  });
  const [details, setDetails] = useState(false);
  const [sharing, setSharing] = useState<Shareable | null>(null);
  const [templating, setTemplating] = useState(false);
  const location = useLocation();
  const meta = useMetaIndex().data;
  const editable = state.loaded && state.access === "write" && !state.closed;
  const title = docTitle(info.name);

  const editor = useEditor(
    {
      editable: false,
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
        Highlight,
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Placeholder.configure({ placeholder: "Start typing, or use # for a heading and - for a list" }),
        Collaboration.configure({ document: session.doc, field: "default" }),
        CollaborationCaret.configure({ provider: session, user: { name: "", color: "#64748b" } }),
      ],
      editorProps: {
        attributes: { class: "doc-body", "aria-label": `${title}, document`, spellcheck: "true" },
        // Links open with Ctrl or ⌘ held (a plain click places the cursor in them).
        handleClick: (_view, _pos, event) => {
          const a = (event.target as HTMLElement | null)?.closest("a[href]");
          if (!a || !(event.metaKey || event.ctrlKey)) return false;
          window.open(a.getAttribute("href") ?? "", "_blank", "noopener,noreferrer");
          return true;
        },
      },
    },
    [session],
  );
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    if (editor && state.me) editor.commands.updateUser({ name: state.me.name, color: state.me.color });
  }, [editor, state.me]);

  // Drive's lists show who has the file open.
  usePresence(file, state.loaded ? (state.access === "write" ? "edit" : "view") : null);

  // Leaving with changes the server has not stored yet.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => state.unsaved && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirmDialog({
      title: "Leave before your changes are saved?",
      message: state.online ? "Your latest changes are still being saved." : "You are offline: changes typed since the connection dropped are only in this tab.",
      confirmLabel: "Leave",
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, state.online]);
  useEffect(() => {
    if (!state.unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.unsaved]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toast(state.unsaved ? "Saving: changes are saved as you type" : "Saved: changes are saved as you type");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.unsaved]);

  const act = (action: string, body: Record<string, unknown>) => api.post<{ id: string }>(`/api/v1/DriveSpace/${space.data?.id}/actions/${action}`, body);
  const content = `/api/app/drive/files/${file}/content`;
  const exportAs = async (format: "html" | "pdf" | "txt") => {
    try {
      await download(content, `${title}.${format}`, { format });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const copy = async () => {
    try {
      const made = await act("copy", { item: file, to: info.parent, name: `Copy of ${info.name}` });
      toast("Copy made");
      navigate(`/doc/${made.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const canEdit = allows(info.permission, "Edit");
  // Back where the person came from: Docs, or the document's folder in Drive.
  const fromDocs = (location.state as { from?: string } | null)?.from === "docs";
  const back = fromDocs ? "/docs" : info.parent ? `/drive/${info.parent}?item=${file}` : "/drive";
  const keepsTemplates = !!meta?.entities.some((e) => e.name === "DocsTemplate" && can(e.permissions, "create"));

  return (
    <div className="doc-page">
      <header className="doc-bar">
        <Link className="btn btn-default btn-sm" to={back} aria-label={fromDocs ? "Back to Docs" : "Back to Drive"}>
          <ArrowLeft size={16} aria-hidden /> {fromDocs ? "Docs" : "Drive"}
        </Link>
        <Title name={info.name} canRename={canEdit && !!space.data} rename={(name) => act("rename", { item: file, name }).then(() => qc.invalidateQueries({ queryKey: ["drive"] }))} />
        <span className="doc-status" role="status" aria-live="polite">
          {statusText(state)}
        </span>
        {state.loaded && state.access === "read" && <Badge>View only</Badge>}
        <People people={people} />
        <div className="doc-bar-end">
          {allows(info.permission, "Manage") && space.data && (
            <Button size="sm" onClick={() => setSharing({ id: info.id, name: info.name, kind: "file" })}>
              Share
            </Button>
          )}
          <Button size="sm" aria-pressed={details} onClick={() => setDetails(!details)}>
            Comments and history
          </Button>
          <Menu label="File" ariaLabel="File menu" buttonClass="btn btn-default btn-sm">
            {(close) => {
              const item = (run: () => unknown) => () => {
                close();
                void run();
              };
              return (
                <>
                  <MenuItem onSelect={item(() => exportAs("html"))}>Download as web page (.html)</MenuItem>
                  <MenuItem onSelect={item(() => exportAs("pdf"))}>Download as PDF</MenuItem>
                  <MenuItem onSelect={item(() => exportAs("txt"))}>Download as text (.txt)</MenuItem>
                  <MenuItem onSelect={item(() => openPrint(`${content}?format=html&inline=1`).catch((e: unknown) => toast(errorMessage(e), "error")))}>Print</MenuItem>
                  {space.data && info.parent && <MenuItem onSelect={item(copy)}>Make a copy</MenuItem>}
                  {keepsTemplates && <MenuItem onSelect={item(() => setTemplating(true))}>Save as a template</MenuItem>}
                </>
              );
            }}
          </Menu>
        </div>
      </header>
      {state.error && <Alert tone={state.closed ? "error" : "warning"}>{state.error}</Alert>}
      {editor && editable && <Toolbar editor={editor} />}
      <div className={details ? "doc-main doc-main-details" : "doc-main"}>
        <div className="doc-paper">
          {!state.loaded && !state.closed && <Spinner label="Loading the document" />}
          <EditorContent editor={editor} hidden={!state.loaded} />
        </div>
        {details && space.data && <DetailsPanel id={file} space={space.data.id} onClose={() => setDetails(false)} onShare={setSharing} />}
      </div>
      {sharing && space.data && <ShareDialog item={sharing} space={space.data.id} onClose={() => setSharing(null)} />}
      {templating && <TemplateDialog file={file} title={title} unsaved={state.unsaved} onClose={() => setTemplating(false)} />}
    </div>
  );
}

/** Everyone else in the document now, one entry per person. */
function usePeople(session: CoeditSession) {
  const [people, setPeople] = useState(() => othersIn(session.awareness));
  useEffect(() => {
    const changed = () => setPeople(othersIn(session.awareness));
    session.awareness.on("change", changed);
    changed();
    return () => session.awareness.off("change", changed);
  }, [session]);
  return people;
}

function People({ people }: { people: { client: number; name: string; color: string }[] }) {
  if (!people.length) return null;
  const shown = people.slice(0, 5);
  const names = people.map((p) => p.name).join(", ");
  return (
    <div className="doc-people" role="group" aria-label={`Also here: ${names}`} title={`Also here: ${names}`}>
      {shown.map((p) => (
        <span key={p.client} className="doc-person" style={{ background: p.color }} aria-hidden>
          {initials(p.name)}
        </span>
      ))}
      {people.length > shown.length && (
        <span className="doc-person doc-person-more" aria-hidden>
          +{people.length - shown.length}
        </span>
      )}
    </div>
  );
}

/** The name, renamed in place (Enter or leaving the field). */
function Title({ name, canRename, rename }: { name: string; canRename: boolean; rename: (name: string) => Promise<unknown> }) {
  const [value, setValue] = useState(docTitle(name));
  useEffect(() => setValue(docTitle(name)), [name]);
  const commit = async () => {
    const next = value.trim();
    if (!next || next === docTitle(name)) return setValue(docTitle(name));
    try {
      await rename(`${next}.fdoc`);
      toast("Renamed");
    } catch (e) {
      toast(errorMessage(e), "error");
      setValue(docTitle(name));
    }
  };
  if (!canRename) return <h1 className="doc-title doc-title-static">{docTitle(name)}</h1>;
  return (
    <input
      className="doc-title"
      aria-label="Document name"
      value={value}
      maxLength={240}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(docTitle(name));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Tool({ label, icon: I, active, onClick, disabled }: { label: string; icon: LucideIcon; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="doc-tool" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <I size={16} aria-hidden />
    </button>
  );
}

function Sep() {
  return <span className="doc-sep" aria-hidden />;
}

const STYLES = [
  { id: "p", label: "Text" },
  { id: "h1", label: "Heading 1" },
  { id: "h2", label: "Heading 2" },
  { id: "h3", label: "Heading 3" },
] as const;

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState(false);
  const run = () => editor.chain().focus();
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <Tool label="Undo" icon={Undo2} disabled={!s.canUndo} onClick={() => run().undo().run()} />
      <Tool label="Redo" icon={Redo2} disabled={!s.canRedo} onClick={() => run().redo().run()} />
      <Sep />
      <label className="sr-only" htmlFor="doc-style">
        Paragraph style
      </label>
      <select
        id="doc-style"
        className="doc-style"
        value={s.style}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") run().setParagraph().run();
          else run().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
        }}
      >
        {STYLES.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Sep />
      <Tool label="Bold" icon={Bold} active={s.bold} onClick={() => run().toggleBold().run()} />
      <Tool label="Italic" icon={Italic} active={s.italic} onClick={() => run().toggleItalic().run()} />
      <Tool label="Underline" icon={Underline} active={s.underline} onClick={() => run().toggleUnderline().run()} />
      <Tool label="Strikethrough" icon={Strikethrough} active={s.strike} onClick={() => run().toggleStrike().run()} />
      <Tool label="Highlight" icon={Highlighter} active={s.highlight} onClick={() => run().toggleHighlight().run()} />
      <Tool label="Code" icon={Code} active={s.code} onClick={() => run().toggleCode().run()} />
      <Tool label={s.link ? "Edit link" : "Link"} icon={Link2} active={s.link} onClick={() => setLinking(true)} />
      <Sep />
      <Tool label="Bulleted list" icon={List} active={s.bullet} onClick={() => run().toggleBulletList().run()} />
      <Tool label="Numbered list" icon={ListOrdered} active={s.ordered} onClick={() => run().toggleOrderedList().run()} />
      <Tool label="Checklist" icon={ListChecks} active={s.task} onClick={() => run().toggleTaskList().run()} />
      <Tool label="Quote" icon={Quote} active={s.quote} onClick={() => run().toggleBlockquote().run()} />
      <Tool label="Code block" icon={SquareCode} active={s.codeBlock} onClick={() => run().toggleCodeBlock().run()} />
      <Tool label="Divider" icon={Minus} onClick={() => run().setHorizontalRule().run()} />
      <Sep />
      <Tool label="Align left" icon={AlignLeft} active={s.left} onClick={() => run().setTextAlign("left").run()} />
      <Tool label="Center" icon={AlignCenter} active={s.center} onClick={() => run().setTextAlign("center").run()} />
      <Tool label="Align right" icon={AlignRight} active={s.right} onClick={() => run().setTextAlign("right").run()} />
      <Sep />
      <Menu label="Table" ariaLabel="Table" buttonClass="doc-tool doc-tool-text">
        {(close) => {
          const item = (go: () => boolean, label: string, needsTable = true) =>
            (!needsTable || s.table) && (
              <MenuItem
                onSelect={() => {
                  close();
                  go();
                }}
              >
                {label}
              </MenuItem>
            );
          return (
            <>
              {item(() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "Insert a table", false)}
              {item(() => run().addRowAfter().run(), "Add a row below")}
              {item(() => run().addColumnAfter().run(), "Add a column to the right")}
              {item(() => run().deleteRow().run(), "Delete the row")}
              {item(() => run().deleteColumn().run(), "Delete the column")}
              {item(() => run().deleteTable().run(), "Delete the table")}
            </>
          );
        }}
      </Menu>
      {linking && <LinkDialog editor={editor} onClose={() => setLinking(false)} />}
    </div>
  );
}

/** The web and mail only: anything else a reader could not follow safely. */
export function cleanHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  return href.includes("@") && !href.includes("/") ? `mailto:${href}` : `https://${href}`;
}

function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [href, setHref] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const save = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanHref(href);
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return onClose();
    }
    if (!clean) return setError("Links go to web pages (https://…) or email addresses.");
    editor.chain().focus().extendMarkRange("link").setLink({ href: clean }).run();
    onClose();
  };
  const footer: ReactNode = (
    <>
      {current && (
        <Button
          variant="danger"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          Remove link
        </Button>
      )}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="doc-link-form">
        Save
      </Button>
    </>
  );
  return (
    <Dialog open onClose={onClose} title={current ? "Edit link" : "Add a link"} footer={footer}>
      <form id="doc-link-form" onSubmit={save}>
        <Field label="Address" htmlFor="doc-link-href" error={error ?? undefined}>
          <input
            id="doc-link-href"
            className="input"
            type="text"
            inputMode="url"
            placeholder="https://example.com"
            value={href}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "doc-link-href-error" : undefined}
            onChange={(e) => setHref(e.target.value)}
            data-autofocus
          />
        </Field>
      </form>
    </Dialog>
  );
}

const CATEGORIES = ["General", "Meetings", "Projects", "Product", "Reports"];

/** Docs Managers: this document as a template (its content as its editors left it). */
function TemplateDialog({ file, title, unsaved, onClose }: { file: string; title: string; unsaved: boolean; onClose: () => void }) {
  const [name, setName] = useState(title);
  const [category, setCategory] = useState("General");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/v1/DocsTemplate", { name: name.trim(), category, description: description.trim() || null, source_document: file });
      await qc.invalidateQueries({ queryKey: ["docs", "templates"] });
      toast(`“${name.trim()}” is a template in Docs`);
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  };
  const footer: ReactNode = (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form="doc-template-form" loading={busy} disabled={!name.trim()}>
        Save template
      </Button>
    </>
  );
  return (
    <Dialog open onClose={onClose} title="Save as a template" footer={footer}>
      <form id="doc-template-form" onSubmit={save} className="stack">
        {unsaved && <Alert tone="warning">The last few changes are still being saved; the template takes what is saved when you press Save.</Alert>}
        <Field label="Template name" htmlFor="doc-template-name" required>
          <input id="doc-template-name" className="input" value={name} maxLength={140} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        <Field label="Category" htmlFor="doc-template-category">
          <select id="doc-template-category" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Description" htmlFor="doc-template-description" hint="One line in the template gallery">
          <input id="doc-template-description" className="input" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
