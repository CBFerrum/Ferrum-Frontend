// Uploads: through the API when a file fits its request limit, otherwise in parts that survive a
// dropped connection (`uploadInParts`).

import { uploadInParts, t } from "@ferrum/client";
import { api } from "./api";

export interface StoredFile {
  id: string;
  url: string;
  file_name: string;
  size: number;
  sha256: string;
}

/** `uploads` of /api/version (the server's system.rs `version`), the parts this client reads. */
interface Limits {
  max_bytes: number;
  parts_max_bytes: number;
}

let limits: Promise<Limits> | null = null;
/** While the server cannot be asked: nothing bigger than its default request limit. */
const FALLBACK: Limits = { max_bytes: 25 * 1024 * 1024, parts_max_bytes: 25 * 1024 * 1024 };

function uploadLimits(): Promise<Limits> {
  limits ??= api
    .get<{ uploads: Limits }>("/api/version")
    .then((v) => v.uploads)
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
export function uploadRoute(size: number, l: Limits): "api" | "parts" | { tooLarge: number } {
  if (size <= l.max_bytes) return "api";
  return size <= l.parts_max_bytes ? "parts" : { tooLarge: l.parts_max_bytes };
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
  return uploadInParts(file, attach, api);
}
