// Rich text in the kit: `RichTextEditor` (the editor, its TipTap code a chunk of its own fetched when the first editor is drawn: no
// entry bundle carries it) and `RichText` (saved rich text shown with the same typography, no editor code at all). The allow-list
// both go through, and that callers use before saving or sending, is ./sanitize.ts. docs/design/PATTERNS.md, "Rich text".

import type { Editor } from "@tiptap/core";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { mergeChips, sanitizeRichText, type SanitizeOptions } from "./sanitize";

export { cleanColor, cleanFontFamily, cleanFontSize, isRichTextEmpty, mergeChips, mergeToken, plainToRichText, resolveMergeFields, richTextToPlain, safeHref, sanitizeRichText, tidyPastedHtml, type SanitizeOptions } from "./sanitize";

/** A merge field offered by the editor: inserted from the toolbar's menu or by typing `{{`, stored as `{{ name }}`. */
export interface MergeField {
  name: string;
  label: string;
}

export interface RichTextEditorProps {
  /** HTML (`output: "html"`, the default; "" is empty) or TipTap JSON (`output: "json"`). Controlled: what `onChange` gives back. */
  value: string | object | null | undefined;
  onChange?: (value: string) => void;
  output?: "html" | "json";
  /** `minimal`: bold, italic, list, link (a comment). `compact`: styles, marks, colour, lists, alignment, link, image (a message, a form field). `full`: all of it with undo, indent, table and rule (a letter, a template). */
  toolbar?: "full" | "compact" | "minimal";
  /** The id of the visible label that names the editable region (a `Field`'s label); else `label`. */
  labelledBy?: string;
  label?: string;
  /** The editable region's id. */
  id?: string;
  describedBy?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Invalid; a string is also said under the frame (leave it a boolean when a `Field` shows the error). */
  invalid?: boolean | string;
  /** At most this many characters; a counter shows in the footer, red near the end. */
  maxLength?: number;
  wordCount?: boolean;
  /** A quiet status at the footer's start: "Saved", "Draft kept". */
  status?: ReactNode;
  /** Font family and size menus (a letter or a template; a message does without). */
  fonts?: boolean;
  mergeFields?: MergeField[];
  /** Stores a picture and gives the address it is shown from. Without it (and without `images: "inline"`) there is no image button. */
  onUploadImage?: (file: File) => Promise<{ src: string; alt?: string } | null>;
  /** `inline`: pictures kept in the value as `data:` (only where the value travels alone). */
  images?: "upload" | "inline";
  /** Address prefixes the caller's own pictures are served from ("/api/files/"); `https:` is always allowed. */
  imageSources?: string[];
  /** More TipTap extensions (mentions); the caller imports them, so load them lazily too. */
  extensions?: unknown[];
  /** The TipTap editor once it exists (null when it goes): for a caller that must act on it (Mail puts a quote at the end, swaps an
   *  uploaded picture for its part). Import its type only (`import type { Editor } from "@tiptap/core"`), so nothing loads early. */
  onEditor?: (editor: Editor | null) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** CSS lengths: the writing area grows from `minHeight` to `maxHeight`, then scrolls. */
  minHeight?: string;
  maxHeight?: string;
  className?: string;
}

const Impl = lazy(() => import("./Editor"));

/** Fetches the editor's code ahead of need (a pointer over "Email", say). */
export const preloadRichTextEditor = () => void import("./Editor");

/** The frame, already its final size, while the editor's code arrives: a toolbar band and the writing area. */
function EditorSkeleton({ toolbar = "compact", readOnly, minHeight }: Pick<RichTextEditorProps, "toolbar" | "readOnly" | "minHeight">) {
  const n = toolbar === "full" ? 14 : toolbar === "minimal" ? 4 : 10;
  return (
    <div className="rte" aria-busy="true" data-variant={toolbar} style={{ "--rte-min": minHeight ?? (toolbar === "minimal" ? "5rem" : "8rem") } as React.CSSProperties}>
      {!readOnly && (
        <div className="rte-bar">
          <div className="flex items-center gap-1 px-1 py-1">
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className={cn("h-(--control-h-sm) animate-pulse rounded-md bg-muted", i === 0 && toolbar !== "minimal" ? "w-32" : "w-(--control-h-sm)")} />
            ))}
          </div>
        </div>
      )}
      <div className="rte-scroll">
        <div className="rte-content flex flex-col gap-2">
          <span className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <span className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

/**
 * A field for writing more than a sentence with emphasis: a framed editor, toolbar at the top, the writing area, a quiet footer.
 * Name it by its label (`labelledBy`); give `invalid`, `maxLength`, `status` as the field needs. What it gives back has passed the
 * allow-list's schema; run `sanitizeRichText` again where it is saved or sent (the server does too).
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const message = typeof props.invalid === "string" && props.invalid ? props.invalid : null;
  const errorId = props.id ? `${props.id}-rte-error` : undefined;
  const describedBy = [props.describedBy, message && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <Suspense fallback={<EditorSkeleton toolbar={props.toolbar} readOnly={props.readOnly} minHeight={props.minHeight} />}>
        <Impl {...props} describedBy={describedBy} />
      </Suspense>
      {message && (
        <p className="field-error" id={errorId}>
          {message}
        </p>
      )}
    </div>
  );
}

/** Saved rich text shown as it was written, with the editor's typography; sanitised here whatever it came from. Merge fields show as chips when `mergeFields` names them. */
export function RichText({ html, className, mergeFields, options }: { html: string | null | undefined; className?: string; mergeFields?: MergeField[]; options?: SanitizeOptions }) {
  // Without a DOM (a server render) nothing is shown rather than anything unchecked.
  const clean = useMemo(() => (typeof DOMParser === "undefined" ? "" : mergeChips(sanitizeRichText(html ?? "", options), mergeFields ?? [], true)), [html, mergeFields, options]);
  return <div className={cn("rich-text", className)} dir="auto" dangerouslySetInnerHTML={{ __html: clean }} />;
}
