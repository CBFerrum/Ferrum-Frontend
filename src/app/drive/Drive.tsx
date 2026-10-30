// Drive (the drive app's /api/app/drive endpoints): your files, what others shared with you, recent,
// starred and trashed items, and search; upload, new folders and blank documents, spreadsheets or
// presentations; sharing, comments, versions and activity in a panel beside the list
// (Details.tsx, Share.tsx); who has a file open now (presence.ts). Files open in the editor server
// the operator runs (Collabora Online or ONLYOFFICE, over WOPI), or in a browser editor that an
// add-on offers on Drive's `drive.editor` point (BrowserEdit.tsx).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, download, errorMessage, request } from "../../lib/api";
import { formatDateTime, initials } from "../../lib/format";
import { Badge, Button, Dialog, EmptyState, Field, Icon, Menu, MenuItem, Spinner, Tabs, confirmDialog, toast } from "../../ui/kit";
import { isLiveDoc } from "../../lib/livedocs";
import { type EditorView, applyViews, hostMessage, inkOn, othersOf, parseMessage } from "../../lib/wopi";
import { DetailsPanel, type ItemInfo, allows } from "./Details";
import { joinable, presenceLabel, useFilesPresence, usePresence } from "./presence";
import { type Shareable, ShareDialog } from "./Share";

interface Item {
  id: string;
  kind: "file" | "folder";
  name: string;
  parent?: string | null;
  owner?: string | null;
  size: number | null;
  modified_at: string;
  modified_by: string | null;
  permission: string;
  locked_by: string | null;
  starred?: boolean;
  trashed?: boolean;
}

interface Listing {
  folder: Item;
  breadcrumbs: { id: string; name: string }[];
  items: Item[];
}

interface Launch {
  url: string;
  access_token: string;
  access_token_ttl: number;
  name: string;
  action: "edit" | "view";
}

/** Files the editor server opens (it says which in its discovery; these are the common ones). */
const OFFICE = /\.(docx?|xlsx?|pptx?|od[tsp]|rtf|csv)$/i;
export const editable = (name: string) => OFFICE.test(name);

/** A browser editor an add-on contributes to `drive.editor`. */
export interface BrowserEditor {
  id: string;
  title: string;
  kind: "browser";
  program: string;
  types: string[];
  max_mb?: number;
  app: string;
  version: string;
}

/** The editors this server runs (`GET /api/app/drive/editors`) and the browser editors on offer. */
export function useEditors() {
  const kinds = useQuery({
    queryKey: ["drive", "editors"],
    queryFn: ({ signal }) => api.get<{ online: boolean; browser: boolean }>("/api/app/drive/editors", undefined, signal),
    staleTime: 300_000,
  });
  const offered = useQuery({
    queryKey: ["drive", "editors", "browser"],
    queryFn: ({ signal }) => api.get<{ items: BrowserEditor[] }>("/api/meta/contributions/drive.editor", undefined, signal).then((r) => r.items),
    enabled: !!kinds.data?.browser,
    staleTime: 300_000,
  });
  return {
    loading: kinds.isPending || (!!kinds.data?.browser && offered.isPending),
    online: !!kinds.data?.online,
    browser: kinds.data?.browser ? (offered.data ?? []) : [],
  };
}

export const extension = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

export interface EditorChoice {
  key: string;
  label: string;
  to: string;
  /** Why it cannot open this file. */
  unavailable?: string;
}

/** Editors several people use at once on one file (browser editors are one person's at a time). */
export const shared = (key: string) => key === "online" || key === "live";

/** The editor "Open" uses: the first that can take the file. On narrow screens browser editors,
 *  made for a mouse and keyboard, are offered under "Open with" only. */
export function defaultEditor(choices: EditorChoice[], narrow: boolean): EditorChoice | undefined {
  return choices.find((c) => !c.unavailable && (c.key === "online" || c.key === "live" || !narrow));
}


/** The editors that open a file, the default first: the online editor for office files, then the
 *  browser editors for its type. */
export function editorsFor(file: { id: string; name: string; size: number | null }, e: { online: boolean; browser: BrowserEditor[] }): EditorChoice[] {
  if (isLiveDoc(file.name)) return [{ key: "live", label: "Document editor", to: `/doc/${file.id}` }];
  const out: EditorChoice[] = [];
  if (e.online && editable(file.name)) out.push({ key: "online", label: "Online editor", to: `/edit/${file.id}` });
  const ext = extension(file.name);
  for (const b of e.browser.filter((b) => b.types.includes(ext))) {
    const tooLarge = b.max_mb && (file.size ?? 0) > b.max_mb * 1024 * 1024;
    out.push({ key: b.id, label: b.title, to: `/edit/${file.id}/${b.id}`, unavailable: tooLarge ? `larger than ${b.max_mb} MB` : undefined });
  }
  return out.sort((a, b) => Number(!!a.unavailable) - Number(!!b.unavailable));
}

export function sizeLabel(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** New files: a live document always; office files open in the online or a browser editor. */
const NEW = [
  { kind: "fdoc", label: "Document" },
  { kind: "docx", label: "Word document" },
  { kind: "xlsx", label: "Spreadsheet" },
  { kind: "pptx", label: "Presentation" },
] as const;

/** Drive's views besides a folder of your own (`?view=`). */
export const VIEWS = [
  { id: "mine", label: "My files", action: "" },
  { id: "shared", label: "Shared with me", action: "shared_with_me" },
  { id: "recent", label: "Recent", action: "recent" },
  { id: "starred", label: "Starred", action: "starred" },
  { id: "trash", label: "Trash", action: "list_trash" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** `/drive/:folder?`: a folder of your Drive (your space's top folder by default), or with `?view=`
 *  another view, with `?q=` a search, and with `?item=` an item's details beside the list. */
export function DrivePage() {
  const { folder } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tabsId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<Shareable | null>(null);
  const [naming, setNaming] = useState<{ title: string; label: string; initial: string; done: (name: string) => Promise<unknown> } | null>(null);
  const view: View = VIEWS.find((v) => v.id === params.get("view"))?.id ?? "mine";
  const query = params.get("q") ?? "";
  const selected = params.get("item");
  const [typed, setTyped] = useState(query);
  const space = useQuery({
    queryKey: ["drive", "space"],
    queryFn: ({ signal }) => api.get<{ id: string; root_folder: string }>("/api/app/drive/space", undefined, signal),
  });
  const inFolder = view === "mine" && !query;
  const id = inFolder ? (folder ?? space.data?.root_folder) : undefined;
  const editors = useEditors();
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches;
  const list = useQuery({
    queryKey: ["drive", "folder", id],
    queryFn: ({ signal }) => api.get<Listing>("/api/app/drive/list_folder", { folder: id, limit: 500 }, signal),
    enabled: !!id,
    // Fresh on every visit: coming back from the editor shows the version it saved.
    staleTime: 0,
  });
  const other = useQuery({
    queryKey: ["drive", "view", view, query],
    queryFn: ({ signal }) =>
      query
        ? api.get<{ items: Item[] }>("/api/app/drive/search", { query, limit: 200 }, signal)
        : api.get<{ items: Item[] }>(`/api/app/drive/${VIEWS.find((v) => v.id === view)!.action}`, undefined, signal),
    enabled: !inFolder,
    staleTime: 0,
  });
  // An item opened from a link or the bell: shown in its own folder.
  const info = useQuery({
    queryKey: ["drive", "item", selected],
    queryFn: ({ signal }) => api.get<ItemInfo>("/api/app/drive/item_info", { item: selected }, signal),
    enabled: !!selected,
    retry: false,
  });
  useEffect(() => {
    const parent = info.data?.kind === "folder" && !info.data.parent ? info.data.id : info.data?.parent;
    if (selected && inFolder && !folder && parent && parent !== space.data?.root_folder) navigate(`/drive/${parent}?item=${selected}`, { replace: true });
  }, [info.data, selected, inFolder, folder, space.data?.root_folder, navigate]);
  const items = (inFolder ? list.data?.items : other.data?.items) ?? [];
  const present = useFilesPresence(items.filter((i) => i.kind === "file").map((i) => i.id)).data ?? {};
  const refresh = () => qc.invalidateQueries({ queryKey: ["drive"] });
  const act = (action: string, body: Record<string, unknown>) => api.post(`/api/v1/DriveSpace/${space.data?.id}/actions/${action}`, body);
  const attempt = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) toast(done);
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const pick = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || !id) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        await request("/api/app/drive/upload", { method: "POST", query: { folder: id, name: f.name }, body: f });
      }
      toast(files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`);
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const create = async (kind: string) => {
    if (!id) return;
    try {
      const made = await api.post<{ id: string }>("/api/app/drive/new", undefined, { query: { kind, folder: id } });
      navigate(kind === "fdoc" ? `/doc/${made.id}` : `/edit/${made.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const newFolder = () =>
    setNaming({ title: "New folder", label: "Name", initial: "", done: (name) => attempt(() => act("create_folder", { parent: id, name }), `Folder “${name}” made`) });
  const rename = (it: Item) =>
    setNaming({ title: `Rename “${it.name}”`, label: "New name", initial: it.name, done: (name) => attempt(() => act("rename", { item: it.id, name }), "Renamed") });
  const trash = async (it: Item) => {
    if (await confirmDialog({ title: `Move “${it.name}” to the trash?`, message: "You can restore it from Trash.", confirmLabel: "Move to trash", danger: true }))
      await attempt(() => act("trash", { item: it.id }), `“${it.name}” is in the trash`);
  };
  const destroy = async (it: Item) => {
    if (await confirmDialog({ title: `Delete “${it.name}” for good?`, message: "This cannot be undone.", confirmLabel: "Delete forever", danger: true }))
      await attempt(() => act("delete_forever", { item: it.id }), `“${it.name}” is deleted`);
  };

  if (space.error || list.error || other.error) {
    return (
      <EmptyState title="Drive is not available" icon="file">
        <p className="muted">{errorMessage(space.error ?? list.error ?? other.error)}</p>
      </EmptyState>
    );
  }
  const ready = inFolder ? !!list.data : !!other.data;
  const current = list.data?.folder;
  const canAdd = inFolder && !!current && allows(current.permission, "Edit");
  const title = query ? `Search: ${query}` : inFolder ? (current?.name ?? "My files") : VIEWS.find((v) => v.id === view)!.label;

  return (
    <div className={selected ? "drive-layout drive-layout-details" : "drive-layout"}>
      <div className="drive-main">
        <div className="page-head">
          <div>
            <h1 className="page-title">{title}</h1>
            {inFolder && list.data && (
              <nav className="page-sub" aria-label="Folder path">
                {list.data.breadcrumbs.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 && " / "}
                    <Link to={`/drive/${b.id}`}>{b.name}</Link>
                  </span>
                ))}
              </nav>
            )}
          </div>
          {canAdd && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Menu label="New" icon="plus" ariaLabel="New document or folder" buttonClass="btn btn-default btn-sm">
                {(close) => (
                  <>
                    {NEW.map((n) => (
                      <MenuItem
                        key={n.kind}
                        onSelect={() => {
                          close();
                          void create(n.kind);
                        }}
                      >
                        {n.label}
                      </MenuItem>
                    ))}
                    <MenuItem
                      onSelect={() => {
                        close();
                        newFolder();
                      }}
                    >
                      Folder
                    </MenuItem>
                  </>
                )}
              </Menu>
              <Button size="sm" variant="primary" icon="upload" loading={busy} onClick={() => picker.current?.click()}>
                Upload
              </Button>
              <input ref={picker} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
            </div>
          )}
        </div>
        <div className="drive-bar">
          <Tabs
            id={tabsId}
            tabs={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
            value={query ? "" : view}
            onChange={(v) => {
              setTyped("");
              navigate(v === "mine" ? "/drive" : `/drive?view=${v}`);
            }}
          />
          <form
            role="search"
            className="drive-search"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              navigate(typed.trim() ? `/drive?q=${encodeURIComponent(typed.trim())}` : "/drive");
            }}
          >
            <label htmlFor={`${tabsId}-q`} className="sr-only">
              Search Drive
            </label>
            <input id={`${tabsId}-q`} className="input" type="search" placeholder="Search Drive" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </form>
        </div>
        {!ready ? (
          <Spinner label="Loading files" />
        ) : !items.length ? (
          <EmptyState title={query ? "Nothing matches" : inFolder ? "This folder is empty" : `Nothing in ${title} yet`} icon="file">
            {canAdd && <p className="muted">Upload files or start a document.</p>}
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Size</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const choices = it.kind === "file" && view !== "trash" ? editorsFor(it, editors) : [];
                const open = defaultEditor(choices, narrow);
                const here = present[it.id] ?? [];
                // Others editing where people edit together: join them there (C2).
                const editing = here.filter((p) => p.mode === "edit");
                const joins = !!open && shared(open.key) && joinable(here);
                return (
                  <tr key={it.id} className={it.id === selected ? "row-selected" : undefined}>
                    <td>
                      {it.kind === "folder" && view !== "trash" ? (
                        <Link to={`/drive/${it.id}`}>
                          <Icon name="list" size={14} /> {it.name}
                        </Link>
                      ) : open ? (
                        <Link to={open.to}>
                          <Icon name="file" size={14} /> {it.name}
                        </Link>
                      ) : (
                        <span>
                          <Icon name={it.kind === "folder" ? "list" : "file"} size={14} /> {it.name}
                        </span>
                      )}
                      {it.starred && (
                        <span className="drive-star" aria-label="Starred" title="Starred">
                          ★
                        </span>
                      )}
                      {it.locked_by && <Badge tone="amber">Checked out</Badge>}
                      {here.length > 0 && (
                        <Badge tone="green" title={presenceLabel(here)}>
                          {presenceLabel(here)}
                        </Badge>
                      )}
                      {!inFolder && it.owner && <div className="faint">{it.owner}</div>}
                    </td>
                    <td className="num">{sizeLabel(it.size)}</td>
                    <td className="muted">
                      {formatDateTime(it.modified_at)}
                      {it.modified_by ? ` · ${it.modified_by}` : ""}
                    </td>
                    <td className="drive-actions">
                      {open && (
                        <Link
                          className={joins ? "btn btn-primary btn-sm" : "btn btn-default btn-sm"}
                          to={open.to}
                          aria-label={joins ? `Join ${presenceLabel(editing).replace(/ (is|are) editing$/, "")} in ${it.name}` : undefined}
                        >
                          {joins ? "Join" : open.key === "live" || !allows(it.permission, "Edit") || editing.length > 0 ? "Open" : "Edit online"}
                        </Link>
                      )}{" "}
                      {choices.length > (open ? 1 : 0) && (
                        <Menu label="Open with" ariaLabel={`Open ${it.name} with`} buttonClass="btn btn-default btn-sm">
                          {(close) =>
                            choices.map((c) => (
                              <MenuItem
                                key={c.key}
                                onSelect={() => {
                                  close();
                                  if (c.unavailable) toast(`${c.label} cannot open ${it.name}: ${c.unavailable}`, "error");
                                  else navigate(c.to);
                                }}
                              >
                                {c.label}
                                {c.unavailable && <span className="faint"> ({c.unavailable})</span>}
                                {!c.unavailable && editing.length > 0 && (
                                  <span className="faint"> ({shared(c.key) && joinable(here) ? `join ${editing.map((p) => p.name).join(", ")}` : "read only while others edit"})</span>
                                )}
                              </MenuItem>
                            ))
                          }
                        </Menu>
                      )}{" "}
                      <Menu label="More" ariaLabel={`More for ${it.name}`} buttonClass="btn btn-default btn-sm">
                        {(close) => {
                          const item = (run: () => unknown) => () => {
                            close();
                            void run();
                          };
                          if (view === "trash")
                            return (
                              <>
                                <MenuItem onSelect={item(() => attempt(() => act("restore", { item: it.id }), `“${it.name}” is restored`))}>Restore</MenuItem>
                                {allows(it.permission, "Manage") && (
                                  <MenuItem danger onSelect={item(() => destroy(it))}>
                                    Delete forever
                                  </MenuItem>
                                )}
                              </>
                            );
                          return (
                            <>
                              <MenuItem onSelect={item(() => pick({ item: it.id }))}>Details</MenuItem>
                              {allows(it.permission, "Manage") && <MenuItem onSelect={item(() => setSharing(it))}>Share</MenuItem>}
                              <MenuItem onSelect={item(() => attempt(() => act(it.starred ? "unstar" : "star", { item: it.id })))}>
                                {it.starred ? "Remove star" : "Star"}
                              </MenuItem>
                              {allows(it.permission, "Edit") && <MenuItem onSelect={item(() => rename(it))}>Rename</MenuItem>}
                              {it.kind === "file" && (
                                <MenuItem onSelect={item(() => download(`/api/app/drive/files/${it.id}/content`, it.name).catch((e) => toast(errorMessage(e), "error")))}>
                                  Download
                                </MenuItem>
                              )}
                              {allows(it.permission, "Edit") && (
                                <MenuItem danger onSelect={item(() => trash(it))}>
                                  Move to trash
                                </MenuItem>
                              )}
                            </>
                          );
                        }}
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {selected && space.data && <DetailsPanel id={selected} space={space.data.id} onClose={() => pick({ item: null })} onShare={setSharing} />}
      {sharing && space.data && <ShareDialog item={sharing} space={space.data.id} onClose={() => setSharing(null)} />}
      {naming && <NameDialog {...naming} onClose={() => setNaming(null)} />}
    </div>
  );
}

/** Asks for a name (new folder, rename). */
function NameDialog({ title, label, initial, done, onClose }: { title: string; label: string; initial: string; done: (name: string) => Promise<unknown>; onClose: () => void }) {
  const fieldId = useId();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await done(name.trim());
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label={label} htmlFor={fieldId}>
          <input id={fieldId} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={255} />
        </Field>
      </form>
    </Dialog>
  );
}

/** `/edit/:file`: the file in the editor server; the page posts the token to the editor's frame. */
export function EditPage() {
  const { file } = useParams();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the editor tells: who is in the file (null until it says), unsaved changes.
  const [views, setViews] = useState<EditorView[] | null>(null);
  const [modified, setModified] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<"comments" | "versions" | null>(null);
  const [sharing, setSharing] = useState<Shareable | null>(null);
  const space = useQuery({
    queryKey: ["drive", "space"],
    queryFn: ({ signal }) => api.get<{ id: string; root_folder: string }>("/api/app/drive/space", undefined, signal),
  });
  const leave = () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate("/drive"));

  useEffect(() => {
    let live = true;
    api.post<Launch>(`/api/app/drive/editor/${file}`).then(
      (l) => live && setLaunch(l),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [file]);
  useEffect(() => {
    if (launch) form.current?.submit();
  }, [launch]);
  // The editor's messages (Ferrum docs/plan/collaboration.md, C2): only from its own frame and origin.
  useEffect(() => {
    if (!launch || !file) return;
    const origin = new URL(launch.url, location.href).origin;
    const post = (id: string) => frame.current?.contentWindow?.postMessage(hostMessage(id), origin);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow) return;
      const m = parseMessage(e.data);
      if (!m) return;
      switch (m.id) {
        case "App_LoadingStatus": {
          const status = (m.values as { Status?: string } | null)?.Status;
          if (status === "Frame_Ready") post("Host_PostmessageReady");
          if (status === "Document_Loaded") post("Get_Views");
          break;
        }
        case "View_Added":
        case "View_Removed":
        case "Get_Views_Resp":
        case "Views_List":
          setViews((v) => applyViews(v, m));
          break;
        case "Doc_ModifiedStatus":
          setModified((m.values as { Modified?: unknown } | null)?.Modified === true);
          break;
        // Its Share and version history buttons open Drive's own.
        case "UI_Share":
        case "UI_Sharing":
          setSharing({ id: file, name: launch.name, kind: "file" });
          break;
        case "UI_FileVersions":
          setPanel("versions");
          break;
        case "UI_Close":
          leave();
          break;
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [launch, file]);
  // Drive's lists show who has the file open; the editor names who is in it, when it says.
  const present = usePresence(file, launch ? (launch.action === "edit" ? "edit" : "view") : null);
  const others = views ? othersOf(views) : null;
  // Whoever edits it in a browser editor holds it, and the editor here only shows it meanwhile.
  const elsewhere = present.filter((p) => p.editor === "browser");

  if (error) {
    return (
      <EmptyState title="This file cannot be opened online" icon="file">
        <p className="muted">{error}</p>
        <Button onClick={() => navigate(-1)}>Back</Button>
      </EmptyState>
    );
  }
  if (!launch || !file) return <Spinner label="Opening the editor" />;
  return (
    <div className="editor-page">
      <div className="editor-bar">
        <Button size="sm" icon="left" onClick={leave}>
          Back
        </Button>
        <strong>{launch.name}</strong>
        {launch.action === "view" && <Badge>Read only</Badge>}
        {others ? (
          others.length > 0 && (
            <span className="editor-people" role="group" aria-label={`Also in the file: ${others.map((v) => v.name + (v.readOnly ? " (viewing)" : "")).join(", ")}`}>
              {others.slice(0, 6).map((v) => (
                <span key={v.id} className="editor-person" style={{ background: v.color, color: inkOn(v.color) }} title={v.readOnly ? `${v.name} (viewing)` : v.name} aria-hidden>
                  {initials(v.name)}
                </span>
              ))}
              {others.length > 6 && (
                <span className="editor-person editor-person-more" aria-hidden>
                  +{others.length - 6}
                </span>
              )}
            </span>
          )
        ) : (
          present.length > 0 && <Badge tone="green">{presenceLabel(present)}</Badge>
        )}
        {others && elsewhere.length > 0 && <Badge tone="amber">{presenceLabel(elsewhere)} in a browser editor</Badge>}
        {launch.action === "edit" && (
          <span className="faint" role="status">
            {modified === true ? "Unsaved changes" : modified === false ? "All changes saved" : "Changes are saved as new versions in Drive."}
          </span>
        )}
        <span className="editor-bar-end">
          <Button size="sm" aria-pressed={!!panel} onClick={() => setPanel(panel ? null : "comments")}>
            Comments and history
          </Button>
        </span>
      </div>
      <form ref={form} action={launch.url} method="post" target="office-editor" hidden>
        <input type="hidden" name="access_token" value={launch.access_token} />
        <input type="hidden" name="access_token_ttl" value={String(launch.access_token_ttl)} />
      </form>
      <div className={panel ? "editor-main editor-main-details" : "editor-main"}>
        <iframe ref={frame} name="office-editor" title={`${launch.name} in the editor`} className="editor-frame" allow="clipboard-read; clipboard-write; fullscreen" />
        {panel && space.data && <DetailsPanel id={file} space={space.data.id} tab={panel} inEditor onClose={() => setPanel(null)} onShare={setSharing} />}
      </div>
      {sharing && space.data && <ShareDialog item={sharing} space={space.data.id} onClose={() => setSharing(null)} />}
    </div>
  );
}
