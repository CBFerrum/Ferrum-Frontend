// Uploads: through the API when a file fits its request limit, otherwise straight to object storage
// with a presigned URL (S3 deployments), so large files never pass through an API server.

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
  return bytes >= 1024 ** 3 ? `${Math.floor(bytes / 1024 ** 3)} GB` : `${Math.floor(bytes / 1024 ** 2)} MB`;
}

/** Which way a file of this size goes, or why it cannot be uploaded. */
export function uploadRoute(size: number, l: Limits): "api" | "direct" | { tooLarge: number } {
  if (size <= l.max_bytes) return "api";
  if (l.direct && l.direct_max_bytes != null && size <= l.direct_max_bytes) return "direct";
  return { tooLarge: l.direct && l.direct_max_bytes != null ? l.direct_max_bytes : l.max_bytes };
}

/** Uploads a file, attached to a record when `attach` is given. */
export async function uploadFile(file: File, attach?: { entity: string; id: string }): Promise<StoredFile> {
  const route = uploadRoute(file.size, await uploadLimits());
  if (typeof route === "object") throw new Error(`Files must be ${megabytes(route.tooLarge)} or smaller.`);
  if (route === "api") {
    const fd = new FormData();
    fd.append("file", file);
    if (attach) {
      fd.append("entity", attach.entity);
      fd.append("record_id", attach.id);
    }
    return api.post<StoredFile>("/api/files", fd);
  }
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
  if (!res.ok) throw new Error(`The file storage service refused the upload (${res.status}).`);
  return api.post<StoredFile>(`/api/files/uploads/${up.upload_id}/complete`);
}
