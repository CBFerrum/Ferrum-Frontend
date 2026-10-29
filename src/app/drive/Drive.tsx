// Drive (the drive app's /api/app/drive endpoints): browse your files and team folders, upload,
// download, start a blank document, spreadsheet or presentation, and edit office files online in
// the editor server the operator runs (Collabora Online or ONLYOFFICE, over WOPI).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, download, errorMessage, request } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Badge, Button, EmptyState, Icon, Spinner, toast } from "../../ui/kit";

interface Item {
  id: string;
  kind: "file" | "folder";
  name: string;
  size: number | null;
  modified_at: string;
  modified_by: string | null;
  permission: string;
  locked_by: string | null;
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

const NEW = [
  { kind: "docx", label: "Document" },
  { kind: "xlsx", label: "Spreadsheet" },
  { kind: "pptx", label: "Presentation" },
] as const;

/** `/drive/:folder?`: a folder of your Drive (your space's top folder by default). */
export function DrivePage() {
  const { folder } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const space = useQuery({
    queryKey: ["drive", "space"],
    queryFn: ({ signal }) => api.get<{ root_folder: string }>("/api/app/drive/space", undefined, signal),
    enabled: !folder,
  });
  const id = folder ?? space.data?.root_folder;
  const list = useQuery({
    queryKey: ["drive", "folder", id],
    queryFn: ({ signal }) => api.get<Listing>("/api/app/drive/list_folder", { folder: id, limit: 500 }, signal),
    enabled: !!id,
    // Fresh on every visit: coming back from the editor shows the version it saved.
    staleTime: 0,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["drive", "folder", id] });

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
      navigate(`/edit/${made.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (space.error || list.error) {
    return (
      <EmptyState title="Drive is not available" icon="file">
        <p className="muted">{errorMessage(space.error ?? list.error)}</p>
      </EmptyState>
    );
  }
  if (!list.data) return <Spinner label="Loading files" />;
  const { breadcrumbs, items, folder: current } = list.data;
  const canAdd = ["Edit", "Manage"].includes(current.permission);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{current.name}</h1>
          <nav className="page-sub" aria-label="Folder path">
            {breadcrumbs.map((b, i) => (
              <span key={b.id}>
                {i > 0 && " / "}
                <Link to={`/drive/${b.id}`}>{b.name}</Link>
              </span>
            ))}
          </nav>
        </div>
        {canAdd && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {NEW.map((n) => (
              <Button key={n.kind} size="sm" icon="plus" onClick={() => void create(n.kind)}>
                {n.label}
              </Button>
            ))}
            <Button size="sm" variant="primary" icon="upload" loading={busy} onClick={() => picker.current?.click()}>
              Upload
            </Button>
            <input ref={picker} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
          </div>
        )}
      </div>
      {!items.length ? (
        <EmptyState title="This folder is empty" icon="file">
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
            {items.map((it) => (
              <tr key={it.id}>
                <td>
                  {it.kind === "folder" ? (
                    <Link to={`/drive/${it.id}`}>
                      <Icon name="list" size={14} /> {it.name}
                    </Link>
                  ) : editable(it.name) ? (
                    <Link to={`/edit/${it.id}`}>
                      <Icon name="file" size={14} /> {it.name}
                    </Link>
                  ) : (
                    <span>
                      <Icon name="file" size={14} /> {it.name}
                    </span>
                  )}
                  {it.locked_by && <Badge tone="amber">Checked out</Badge>}
                </td>
                <td className="num">{sizeLabel(it.size)}</td>
                <td className="muted">
                  {formatDateTime(it.modified_at)}
                  {it.modified_by ? ` · ${it.modified_by}` : ""}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {it.kind === "file" && editable(it.name) && (
                    <Link className="btn btn-default btn-sm" to={`/edit/${it.id}`}>
                      {["Edit", "Manage"].includes(it.permission) ? "Edit online" : "Open"}
                    </Link>
                  )}{" "}
                  {it.kind === "file" && (
                    <Button
                      size="sm"
                      icon="download"
                      aria-label={`Download ${it.name}`}
                      onClick={() => void download(`/api/app/drive/files/${it.id}/content`, it.name).catch((e) => toast(errorMessage(e), "error"))}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** `/edit/:file`: the file in the editor server; the page posts the token to the editor's frame. */
export function EditPage() {
  const { file } = useParams();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
    return (
      <EmptyState title="This file cannot be opened online" icon="file">
        <p className="muted">{error}</p>
        <Button onClick={() => navigate(-1)}>Back</Button>
      </EmptyState>
    );
  }
  if (!launch) return <Spinner label="Opening the editor" />;
  return (
    <div className="editor-page">
      <div className="editor-bar">
        <Button size="sm" icon="left" onClick={() => navigate(-1)}>
          Back
        </Button>
        <strong>{launch.name}</strong>
        {launch.action === "view" && <Badge>Read only</Badge>}
        <span className="faint">Changes are saved as new versions in Drive.</span>
      </div>
      <form ref={form} action={launch.url} method="post" target="office-editor" hidden>
        <input type="hidden" name="access_token" value={launch.access_token} />
        <input type="hidden" name="access_token_ttl" value={String(launch.access_token_ttl)} />
      </form>
      <iframe name="office-editor" title={`${launch.name} in the editor`} className="editor-frame" allow="clipboard-read; clipboard-write; fullscreen" />
    </div>
  );
}
