// The API client of the shell, Studio and the records screens: @ferrum/client's, the one apps use, so a
// request behaves the same from either (the interface's version header, step-up, a 401 asking the shell
// to sign in again).

export {
  api,
  ApiError,
  b64,
  docPath,
  download,
  errorBody,
  errorMessage,
  fetchBlob,
  isStale,
  newKey,
  openPrint,
  parseApiError,
  queryString,
  request,
  requestRaw,
  saveBlob,
  withPrintCsp,
  type FieldError,
  type RequestOptions,
} from "@ferrum/client";
