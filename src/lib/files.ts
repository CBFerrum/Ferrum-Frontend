// Uploads: through the API when a file fits its request limit, otherwise in parts that survive a
// dropped connection (`uploadInParts`), or, from a server without them, straight to object storage
// with a presigned URL (S3 deployments).

import { uploadInParts, t } from "@ferrum/client";
import { api } from "./api";

export interface StoredFile {
  id: string;
  url: string;
  file_name: string;
  size: number;
  sha256: string;
}

interface Limits {
  max_bytes: number;
  direct: boolean;
  direct_max_bytes: number | null;
  parts?: boolean;
  parts_max_bytes?: number | null;
}

interface StartedUpload {
  upload_id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
}

let limits: Promise<Limits> | null = null;
const FALLBACK: Limits = { max_bytes: 25 * 1024 * 1024, direct: false, direct_max_bytes: null };

function uploadLimits(): Promise<Limits> {
  limits ??= api
    .get<{ uploads?: Limits }>("/api/version")
    .then((v) => v.uploads ?? FALLBACK)
    .catch(() => {
      limits = null; // ask again next time
      return FALLBACK;
    });
  return limits;
}

export function megabytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? t("{n} GB", { n: Math.floor(bytes / 1024 ** 3) }) : t("{n} MB", { n: Math.floor(bytes / 1024 ** 2) });
}

/** Which way a file of this size goes, or why it cannot be uploaded. */
export function uploadRoute(size: number, l: Limits): "api" | "parts" | "direct" | { tooLarge: number } {
  if (size <= l.max_bytes) return "api";
  if (l.parts && l.parts_max_bytes != null) return size <= l.parts_max_bytes ? "parts" : { tooLarge: l.parts_max_bytes };
  if (l.direct && l.direct_max_bytes != null && size <= l.direct_max_bytes) return "direct";
  return { tooLarge: l.direct && l.direct_max_bytes != null ? l.direct_max_bytes : l.max_bytes };
}

/** Uploads a file, attached to a record when `attach` is given. */
export async function uploadFile(file: File, attach?: { entity: string; id: string }): Promise<StoredFile> {
  const route = uploadRoute(file.size, await uploadLimits());
  if (typeof route === "object") throw new Error(t("Files must be {value} or smaller.", { value: megabytes(route.tooLarge) }));
  if (route === "api") {
    const fd = new FormData();
    fd.append("file", file);
    if (attach) {
      fd.append("entity", attach.entity);
      fd.append("record_id", attach.id);
    }
    return api.post<StoredFile>("/api/files", fd);
  }
  if (route === "parts") return uploadInParts(file, attach, api);
  const up = await api.post<StartedUpload>("/api/files/uploads", {
    file_name: file.name,
    content_type: file.type,
    size: file.size,
    entity: attach?.entity,
    record_id: attach?.id,
  });
  let res: Response;
  try {
    res = await fetch(up.url, { method: up.method, headers: up.headers, body: file });
  } catch {
    throw new Error("Could not reach the file storage service. Check your connection, or ask an administrator to allow uploads from this site.");
  }
  if (!res.ok) throw new Error(t("The file storage service refused the upload ({status}).", { status: res.status }));
  return api.post<StoredFile>(`/api/files/uploads/${up.upload_id}/complete`);
}
