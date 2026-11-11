// Administration, Services: the level decides the tone (never the text), an unknown check or level reads plainly, and an older
// server (404), a refusal (403) and a failure are each their own state.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { ServicesBody, checkName, levelTone, type ServiceFinding } from "./Services";

const body = (q: Partial<Parameters<typeof ServicesBody>[0]["q"]>) => renderToString(<ServicesBody q={{ error: null, isLoading: false, refetch: () => {}, ...q }} />);
const rows = (services: ServiceFinding[]) => body({ data: { services } });

describe("the services card", () => {
  it("takes each badge's tone from the level id", () => {
    expect([levelTone("ok"), levelTone("warning"), levelTone("blocker"), levelTone("degraded"), levelTone("toString")]).toEqual(["green", "amber", "red", "neutral", "neutral"]);
    const html = rows([
      { check: "office", level: "ok", detail: "the online editor answers" },
      { check: "office.proof", level: "warning", detail: "all fine, no problem, working" },
      { check: "pdf", level: "blocker", detail: "ok" },
    ]);
    expect(html).toMatch(/badge-green[^>]*>Working/);
    expect(html).toMatch(/badge-amber[^>]*>Needs attention/);
    expect(html).toMatch(/badge-red[^>]*>Not working/);
  });

  it("names the known checks in the person's words and an unknown one by its humanized id", () => {
    expect([checkName("office"), checkName("office.proof"), checkName("pdf")]).toEqual(["Office editor", "Editor request signing", "PDF renderer"]);
    const html = rows([{ check: "pdf.fonts", level: "ok", detail: "fine" }, { check: "", level: "", detail: "" }]);
    expect(html).toContain("Pdf fonts");
    expect(html).not.toContain("pdf.fonts");
  });

  it("sets the fix apart as what to do, only when there is one", () => {
    const html = rows([
      { check: "pdf", level: "warning", detail: "no PDF renderer: documents print as HTML only", fix: "Set FERRUM_PDF_URL." },
      { check: "office", level: "ok", detail: "the online editor answers" },
    ]);
    expect(html.match(/What to do/g)).toHaveLength(1);
    expect(html).toContain("Set FERRUM_PDF_URL.");
  });

  it("says quietly that a server without the endpoint does not report yet, and does not fail", () => {
    const html = body({ error: new ApiError(404, "not_found", "Not found") });
    expect(html).toContain("This server does not report its services yet");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Try again");
  });

  it("is the denied state on 403, with no retry and no server text, and a failure with a retry", () => {
    const denied = body({ error: new ApiError(403, "forbidden", "secret server words") });
    expect(denied).toContain('data-state-kind="denied"');
    expect(denied).not.toContain("secret server words");
    expect(denied).not.toContain("Try again");
    const failed = body({ error: new ApiError(500, "internal", "Boom") });
    expect(failed).toContain('data-state-kind="failed"');
    expect(failed).toContain("Try again");
  });

  it("shows a skeleton while loading", () => {
    expect(body({ isLoading: true })).toContain('role="status"');
  });
});
