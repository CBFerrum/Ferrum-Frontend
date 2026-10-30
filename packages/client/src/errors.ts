// The platform's errors (docs/api.md): one ApiError class for every interface and package, so a
// message and its field errors read the same wherever a request was made.

export interface FieldError {
  field: string;
  message: string;
  /** `[tableField, rowIndex]` for errors in child rows. */
  row?: [string, number];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
    readonly errorId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK: Record<number, [string, string]> = {
  0: ["network", "Cannot reach the server. Check your connection and try again."],
  400: ["invalid", "The request was not valid."],
  401: ["unauthorized", "Your session has ended. Please sign in again."],
  403: ["forbidden", "You do not have permission to do that."],
  404: ["not_found", "Not found."],
  409: ["conflict", "This record was changed by someone else. Reload and try again."],
  413: ["too_large", "The upload is too large."],
  422: ["invalid", "Please check your input."],
  429: ["too_many_requests", "Too many requests. Please wait a moment and try again."],
  502: ["unavailable", "The server cannot be reached right now (it may be restarting). Please try again shortly."],
  503: ["unavailable", "The server is temporarily unavailable. Please try again shortly."],
  504: ["unavailable", "The server took too long to answer. Please try again shortly."],
};

function isFieldError(v: unknown): v is FieldError {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return typeof f.field === "string" && typeof f.message === "string";
}

/** Turns a non-2xx response (status + parsed JSON body, if any) into an `ApiError`. */
export function parseApiError(status: number, body: unknown): ApiError {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const [fbCode, fbMessage] =
    FALLBACK[status] ?? (status >= 500 ? ["server_error", "Something went wrong on the server."] : ["error", `Request failed (${status}).`]);
  const code = typeof b.error === "string" && b.error ? b.error : fbCode;
  let message = typeof b.message === "string" && b.message ? b.message : fbMessage;
  const fields: FieldError[] = (Array.isArray(b.fields) ? b.fields : []).filter(isFieldError).map((f) => {
    const row = Array.isArray(f.row) && typeof f.row[0] === "string" && Number.isInteger(f.row[1]) ? f.row : undefined;
    return row ? { field: f.field, message: f.message, row: [row[0], row[1]] } : { field: f.field, message: f.message };
  });
  const errorId = typeof b.error_id === "string" ? b.error_id : undefined;
  if (errorId) message = `${message} (reference ${errorId})`;
  return new ApiError(status, code, message, fields, errorId);
}

/** A one-line message for toasts; includes field errors when there is no form to show them in. */
export function errorMessage(e: unknown, withFields = true): string {
  if (e instanceof ApiError) {
    if (withFields && e.fields.length) {
      const detail = e.fields.map((f) => (f.row ? `row ${f.row[1] + 1} ${f.field}` : f.field) + `: ${f.message}`).join("; ");
      return `${e.message} — ${detail}`;
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
