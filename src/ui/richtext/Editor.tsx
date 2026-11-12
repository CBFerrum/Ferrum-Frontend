// The rich-text editor itself (TipTap), loaded only when an editor is on screen: `RichTextEditor` in ./index.tsx is the public
// face and draws a frame-shaped placeholder until this chunk has arrived. One framed field: the toolbar at the top (the kit's
// `Toolbar`, folding what does not fit into More), the writing area, a quiet footer. What it can write is what the allow-list in
// ./sanitize.ts keeps; pasted HTML is tidied and cleaned before the editor reads it, and a value loaded is cleaned the same way.

import { Extension, mergeAttributes, Node, type AnyExtension, type Editor, type JSONContent } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignRightIcon, BaselineIcon, BetweenHorizontalEndIcon, BetweenHorizontalStartIcon, BetweenVerticalEndIcon, BetweenVerticalStartIcon, BoldIcon, BracesIcon, ChevronDownIcon, HighlighterIcon,
  ImagePlusIcon, IndentDecreaseIcon, IndentIncreaseIcon, ItalicIcon, Link2Icon, ListChecksIcon, ListIcon, ListOrderedIcon, MinusIcon, PanelTopIcon, Redo2Icon, RemoveFormattingIcon, StrikethroughIcon, Table2Icon, Trash2Icon, UnderlineIcon, Undo2Icon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button as ShButton } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { toast } from "../kit";
import { rememberColor, SwatchPalette, type Swatch } from "../swatches";
import { Toolbar, ToolbarButton, ToolbarGroup } from "../toolbar";
import { LinkEnds } from "./linkEnds";
import { cleanFontFamily, mergeChips, mergeToken, safeHref, sanitizeRichText, tidyPastedHtml, type SanitizeOptions } from "./sanitize";
import type { MergeField, RichTextEditorProps } from "./index";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// ── nodes of our own ──

/** An image: shown from `src`, its width kept when resized by the handle at its inline end. */
const ImageNode = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: null }, alt: { default: null }, width: { default: null, parseHTML: (el) => Number(el.getAttribute("width")) || null } }),
  parseHTML: () => [{ tag: "img[src]" }],
  renderHTML: ({ HTMLAttributes }) => ["img", mergeAttributes(HTMLAttributes)],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrap = document.createElement("span");
      wrap.className = "rte-img";
      wrap.contentEditable = "false";
      const img = document.createElement("img");
      const handle = document.createElement("span");
      handle.className = "rte-img-handle";
      handle.setAttribute("aria-hidden", "true");
      const draw = (n: typeof node) => {
        img.src = n.attrs.src ?? "";
        img.alt = n.attrs.alt ?? "";
        if (n.attrs.width) img.style.width = `${n.attrs.width}px`;
        else img.style.removeProperty("width");
      };
      draw(node);
      handle.addEventListener("pointerdown", (e) => {
        if (!editor.isEditable) return;
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startW = img.getBoundingClientRect().width;
        const way = getComputedStyle(wrap).direction === "rtl" ? -1 : 1;
        const max = (editor.view.dom as HTMLElement).clientWidth - 8;
        const move = (ev: PointerEvent) => (img.style.width = `${Math.round(Math.min(max, Math.max(40, startW + (ev.clientX - startX) * way)))}px`);
        handle.addEventListener("pointermove", move);
        handle.addEventListener(
          "pointerup",
          () => {
            handle.removeEventListener("pointermove", move);
            const pos = getPos();
            if (typeof pos === "number") editor.chain().command(({ tr }) => (tr.setNodeAttribute(pos, "width", Math.round(img.getBoundingClientRect().width)), true)).run();
          },
          { once: true },
        );
      });
      wrap.append(img, handle);
      return { dom: wrap, update: (n) => (n.type.name === "image" ? (draw(n), true) : false), selectNode: () => wrap.classList.add("is-selected"), deselectNode: () => wrap.classList.remove("is-selected") };
    };
  },
});

/** A merge field: drawn as a chip with its label, written out as its literal token (`{{ customer_name }}`). */
const MergeFieldNode = Node.create<{ fields: MergeField[] }>({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ fields: [] }),
  addAttributes: () => ({ name: { default: "", parseHTML: (el) => el.getAttribute("data-merge-field") ?? "" } }),
  parseHTML: () => [{ tag: "span[data-merge-field]" }],
  // A span holding the token (the node view draws the chip); `fromEditor` writes the value as the literal token alone.
  renderHTML: ({ node }) => ["span", { "data-merge-field": node.attrs.name }, mergeToken(node.attrs.name as string)],
  renderText: ({ node }) => mergeToken(node.attrs.name as string),
  addNodeView() {
    return ({ node }) => {
      const chip = document.createElement("span");
      chip.className = "merge-chip";
      chip.contentEditable = "false";
      chip.textContent = this.options.fields.find((f) => f.name === node.attrs.name)?.label ?? String(node.attrs.name);
      chip.title = mergeToken(node.attrs.name as string);
      return { dom: chip };
    };
  },
});

/** Direction found from the words (`dir="auto"`) on lists, quotes and tables, so an Arabic list in an English letter has its
 *  markers on the right. Paragraphs carry none (an element with `dir` hides its words from an `auto` ancestor): CSS gives each
 *  its own direction (`unicode-bidi: plaintext`), and a mail's copy gets `dir="auto"` from `sanitizeRichText(…, { mail: true })`. */
const BlockDirection = Extension.create({
  name: "blockDirection",
  addGlobalAttributes: () => [
    {
      types: ["bulletList", "orderedList", "taskList", "blockquote", "table"],
      attributes: { dir: { default: "auto", parseHTML: () => "auto", renderHTML: () => ({ dir: "auto" }) } },
    },
  ],
});

/** The editor's HTML as the value holds it: a merge field's span as its literal token. */
const fromEditor = (html: string) => html.replace(/<span data-merge-field="[\w.]+">(\{\{ [\w.]+ \}\})<\/span>/g, "$1");

// ── what the toolbar offers ──

// ui-lint-allow raw-color: colours written into the content itself (other programs draw them), not the theme's
const TEXT_COLOURS = ["#000000", "#5f6368", "#c5221f", "#e8710a", "#f9ab00", "#188038", "#1967d2", "#9334e6", "#d01884", "#ffffff"];
// ui-lint-allow raw-color: highlight colours written into the content itself
const MARKS = ["#fff475", "#ccff90", "#a7ffeb", "#cbf0f8", "#d7aefb", "#fdcfe8"];
const colourNames = () => [t("Black"), t("Grey"), t("Red"), t("Orange"), t("Yellow"), t("Green"), t("Blue"), t("Purple"), t("Pink"), t("White")];
const markNames = () => [t("Yellow"), t("Green"), t("Teal"), t("Blue"), t("Purple"), t("Pink")];
const FONTS = [
  { name: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  { name: "Monospace", stack: "Menlo, Consolas, monospace" },
  { name: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { name: "Georgia", stack: "Georgia, serif" },
  { name: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { name: "Verdana", stack: "Verdana, Geneva, sans-serif" },
];
const SIZES = [12, 14, 16, 18, 24, 32];
const BLOCKS = () => [
  { id: "p", label: t("Normal text"), cls: "" },
  { id: "h1", label: t("Heading 1"), cls: "text-xl font-semibold" },
  { id: "h2", label: t("Heading 2"), cls: "text-lg font-semibold" },
  { id: "h3", label: t("Heading 3"), cls: "text-base font-semibold" },
  { id: "quote", label: t("Quote"), cls: "border-s-2 border-border-strong ps-2 text-muted-foreground" },
  { id: "code", label: t("Code block"), cls: "font-mono text-sm" },
];

function selection(e: Editor) {
  const style = e.getAttributes("textStyle");
  return {
    block: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : e.isActive("codeBlock") ? "code" : e.isActive("blockquote") ? "quote" : "p",
    bold: e.isActive("bold"),
    italic: e.isActive("italic"),
    underline: e.isActive("underline"),
    strike: e.isActive("strike"),
    bullet: e.isActive("bulletList") && !e.isActive("taskList"),
    ordered: e.isActive("orderedList"),
    task: e.isActive("taskList"),
    canIndent: e.can().sinkListItem("listItem") || e.can().sinkListItem("taskItem"),
    canOutdent: e.can().liftListItem("listItem") || e.can().liftListItem("taskItem"),
    color: (style.color as string | undefined) ?? null,
    mark: (e.getAttributes("highlight").color as string | undefined) ?? null,
    font: (style.fontFamily as string | undefined) ?? "",
    size: (style.fontSize as string | undefined) ?? "",
    align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
    link: e.isActive("link"),
    table: e.isActive("table"),
    canUndo: e.can().undo(),
    canRedo: e.can().redo(),
    docSize: e.state.doc.content.size, // the counts are read when drawn; this redraws them as the text changes
    editable: e.isEditable,
  };
}
type Sel = ReturnType<typeof selection>;

/** A toolbar control that opens a menu or popover: the tooltip names it, the trigger keeps the caret where it is. */
function Trigger({ label, children, className, disabled, pressed, ...rest }: { label: string; children: ReactNode; className?: string; disabled?: boolean; pressed?: boolean } & Record<string, unknown>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ShButton variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onMouseDown={(e) => e.preventDefault()} className={cn("relative aria-pressed:bg-primary-soft aria-pressed:text-primary", className)} {...rest}>
          {children}
        </ShButton>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function MenuTool({ label, icon, text, children, disabled, width }: { label: string; icon?: ReactNode; text?: string; children: ReactNode; disabled?: boolean; width?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Trigger label={label} disabled={disabled} className={cn("w-auto gap-1 px-1.5", text && "justify-between px-2 text-sm font-normal", width)}>
          {icon}
          {text && <span className="truncate">{text}</span>}
          <ChevronDownIcon className="size-3.5 opacity-60" aria-hidden="true" />
        </Trigger>
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  );
}

/** A colour tool: the icon with the colour in use under it, the palette in a popover. */
function ColourTool({ label, icon, value, swatches, noneLabel, recent, onPick }: { label: string; icon: ReactNode; value: string | null; swatches: Swatch[]; noneLabel: string; recent: string[]; onPick: (c: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger label={label}>
          {icon}
          {/* ui-lint-allow raw-color: shows the colour chosen for the content, which is content */}
          <span aria-hidden="true" className="absolute inset-x-2 bottom-1 h-0.5 rounded-full" style={{ background: value ?? "currentColor" }} />
        </Trigger>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" aria-label={label} onCloseAutoFocus={(e) => e.preventDefault()}>
        <SwatchPalette label={label} swatches={swatches} columns={swatches.length} value={value} noneLabel={noneLabel} recent={recent} onChange={(c) => (onPick(c), setOpen(false))} />
      </PopoverContent>
    </Popover>
  );
}

/** Choosing a table's size: a grid of cells, the pointer or the arrows grow it, Enter or a click makes it. */
function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [at, setAt] = useState<[number, number]>([2, 2]);
  const R = 6;
  const C = 8;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="grid"
        aria-label={t("Table size")}
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${C}, minmax(0, 1fr))` }}
        onKeyDown={(e) => {
          const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
          const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, rtl ? 1 : -1], ArrowRight: [0, rtl ? -1 : 1] }[e.key];
          if (!d) return;
          e.preventDefault();
          const next: [number, number] = [Math.min(R, Math.max(1, at[0] + d[0]!)), Math.min(C, Math.max(1, at[1] + d[1]!))];
          setAt(next);
          e.currentTarget.querySelector<HTMLElement>(`[data-cell="${next[0]}-${next[1]}"]`)?.focus();
        }}
      >
        {Array.from({ length: R * C }, (_, i) => {
          const r = Math.floor(i / C) + 1;
          const c = (i % C) + 1;
          const on = r <= at[0] && c <= at[1];
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              data-cell={`${r}-${c}`}
              tabIndex={r === at[0] && c === at[1] ? 0 : -1}
              aria-label={t("{rows} by {columns} table", { rows: r, columns: c })}
              aria-selected={on}
              onMouseEnter={() => setAt([r, c])}
              onFocus={() => setAt([r, c])}
              onClick={() => onPick(r, c)}
              className={cn("size-5 rounded-sm border border-border-strong outline-none focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-7", on && "border-primary bg-primary-soft")}
            />
          );
        })}
      </div>
      <p className="text-center text-xs text-muted-foreground" aria-live="polite">
        {t("{rows} by {columns} table", { rows: at[0], columns: at[1] })}
      </p>
    </div>
  );
}

/** The link at the selection: its address, its words, whether it opens a new tab; added, changed or taken off. */
function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const id = useId();
  const was = editor.getAttributes("link") as { href?: string; target?: string | null };
  const { from, to, empty } = editor.state.selection;
  const [href, setHref] = useState(was.href ?? "");
  const [text, setText] = useState(empty && !was.href ? "" : editor.state.doc.textBetween(from, to, " "));
  const [blank, setBlank] = useState(was.target === "_blank");
  const [bad, setBad] = useState(false);
  const askText = empty && !was.href;
  const apply = () => {
    const url = safeHref(href);
    if (!url) return setBad(true);
    const attrs = { href: url, target: blank ? "_blank" : null };
    if (askText) editor.chain().focus().insertContent({ type: "text", text: text.trim() || href.trim(), marks: [{ type: "link", attrs }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink(attrs).run();
    onDone();
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-xs font-medium text-muted-foreground">
          {t("Address")}
        </label>
        <input id={`${id}-href`} autoFocus className="input" dir="ltr" inputMode="url" placeholder="https://" value={href} aria-invalid={bad || undefined} aria-describedby={bad ? `${id}-bad` : undefined} onChange={(e) => (setHref(e.target.value), setBad(false))} />
        {bad && (
          <p id={`${id}-bad`} className="text-xs text-destructive">
            {t("Enter a web address (https://…) or an e-mail address.")}
          </p>
        )}
      </div>
      {askText && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-text`} className="text-xs font-medium text-muted-foreground">
            {t("Text to show")}
          </label>
          <input id={`${id}-text`} className="input" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={blank} onChange={(e) => setBlank(e.target.checked)} />
        {t("Open in a new tab")}
      </label>
      <div className="flex items-center justify-end gap-2">
        {was.href && (
          <ShButton type="button" variant="ghost" size="sm" className="me-auto text-destructive" onClick={() => (editor.chain().focus().extendMarkRange("link").unsetLink().run(), onDone())}>
            {t("Remove link")}
          </ShButton>
        )}
        <ShButton type="button" variant="ghost" size="sm" onClick={() => (editor.commands.focus(), onDone())}>
          {t("Cancel")}
        </ShButton>
        <ShButton type="submit" size="sm">
          {t("Apply")}
        </ShButton>
      </div>
    </form>
  );
}

/** Where the caret is, as a box an anchored popover can follow. */
function caretRect(editor: Editor): DOMRect {
  try {
    const { from, to } = editor.state.selection;
    const a = editor.view.coordsAtPos(from);
    const b = editor.view.coordsAtPos(to);
    return new DOMRect(Math.min(a.left, b.left), a.top, Math.max(1, Math.abs(b.right - a.left)), a.bottom - a.top);
  } catch {
    return (editor.view.dom as HTMLElement).getBoundingClientRect();
  }
}

// ── the editor ──

export default function RichTextEditorImpl(p: RichTextEditorProps) {
  const variant = p.toolbar ?? "compact";
  const fields = p.mergeFields ?? [];
  const latest = useRef(p);
  latest.current = p;
  const clean: SanitizeOptions = useMemo(() => ({ inlineImages: p.images === "inline", imageSources: p.imageSources }), [p.images, p.imageSources]);
  const toEditor = (v: RichTextEditorProps["value"]) => (typeof v === "string" ? mergeChips(sanitizeRichText(v, clean), fields) : (v ?? ""));
  const keyOf = (v: RichTextEditorProps["value"]) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));
  const emitted = useRef<string>(keyOf(p.value));
  const [linking, setLinking] = useState(false);
  const [suggest, setSuggest] = useState<{ query: string; from: number; at: number } | null>(null);
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const [uploading, setUploading] = useState(0);
  const [recent, setRecent] = useState<{ color: string[]; mark: string[] }>({ color: [], mark: [] });
  const fileInput = useRef<HTMLInputElement>(null);
  const canImage = !!p.onUploadImage || p.images === "inline";

  const addFiles = async (files: File[]) => {
    const pictures = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (!pictures.length || !editor) return false;
    for (const f of pictures) {
      setUploading((n) => n + 1);
      try {
        const got = p.onUploadImage
          ? await p.onUploadImage(f)
          : await new Promise<{ src: string } | null>((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve(typeof r.result === "string" ? { src: r.result } : null);
              r.onerror = () => resolve(null);
              r.readAsDataURL(f);
            });
        if (got?.src) editor.chain().focus().insertContent({ type: "image", attrs: { src: got.src, alt: ("alt" in got ? got.alt : undefined) ?? f.name.replace(/\.[^.]+$/, "") } }).run();
      } catch (e) {
        toast(e instanceof Error ? e.message : t("The image could not be added."), "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    return true;
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"], isAllowedUri: (url) => !!safeHref(url), HTMLAttributes: { target: null, rel: "noopener noreferrer nofollow" } },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ImageNode,
      MergeFieldNode.configure({ fields }),
      BlockDirection,
      LinkEnds,
      Placeholder.configure({ placeholder: p.placeholder ?? "" }),
      CharacterCount.configure({ limit: p.maxLength ?? null }),
      ...((p.extensions ?? []) as AnyExtension[]),
    ],
    content: toEditor(p.value),
    editable: !p.readOnly && !p.disabled,
    autofocus: p.autoFocus ? "end" : false,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: cn("rich-text rte-content", variant === "full" ? "text-lg" : "text-base"),
        role: "textbox",
        "aria-multiline": "true",
        ...(p.id ? { id: p.id } : {}),
        ...(p.labelledBy ? { "aria-labelledby": p.labelledBy } : { "aria-label": p.label ?? t("Text") }),
        ...(p.describedBy ? { "aria-describedby": p.describedBy } : {}),
        ...(p.invalid ? { "aria-invalid": "true" } : {}),
        ...(p.readOnly ? { "aria-readonly": "true" } : {}),
        ...(p.disabled ? { "aria-disabled": "true" } : {}),
        // The platform bar leaves Ctrl/Cmd+K to a region that asks for it: here it makes a link.
        "data-ferrum-keys": "mod+k",
      },
      transformPastedHTML: (html) => mergeChips(tidyPastedHtml(html, clean), latest.current.mergeFields ?? []),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !canImage) return false;
        void addFiles(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.length || !canImage) return false;
        event.preventDefault();
        void addFiles(files);
        return true;
      },
      handleKeyDown: (_view, e) => {
        const s = suggestRef.current;
        if (s) {
          const list = matching(s.query);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSuggest({ ...s, at: (s.at + (e.key === "ArrowDown" ? 1 : -1) + Math.max(1, list.length)) % Math.max(1, list.length) });
            return true;
          }
          if ((e.key === "Enter" || e.key === "Tab") && list.length) {
            e.preventDefault();
            insertField(list[s.at]!.name, s.from);
            return true;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setSuggest(null);
            return true;
          }
        }
        const mod = mac ? e.metaKey : e.ctrlKey;
        if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setLinking(true);
          return true;
        }
        if (mod && e.key === "Enter" && latest.current.onSubmit) {
          e.preventDefault();
          latest.current.onSubmit();
          return true;
        }
        if (mod && e.key === "\\") {
          e.preventDefault();
          clearFormatting();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      watchSuggest(e);
      const out = latest.current.output === "json" ? e.getJSON() : e.isEmpty ? "" : fromEditor(e.getHTML());
      emitted.current = typeof out === "string" ? out : JSON.stringify(out);
      latest.current.onChange?.(out as string & JSONContent);
    },
    onSelectionUpdate: ({ editor: e }) => watchSuggest(e),
  });

  // A value from outside (a template chosen, a draft restored) replaces what is written; the editor's own echo does not.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const v = p.value;
    const key = keyOf(v);
    if (key === emitted.current) return;
    emitted.current = key;
    editor.commands.setContent(toEditor(v), { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, p.value]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    latest.current.onEditor?.(editor);
    return () => latest.current.onEditor?.(null);
  }, [editor]);
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== (!p.readOnly && !p.disabled)) editor.setEditable(!p.readOnly && !p.disabled);
  }, [editor, p.readOnly, p.disabled]);

  const matching = (q: string) => {
    const s = q.toLowerCase();
    return (latest.current.mergeFields ?? []).filter((f) => f.name.toLowerCase().includes(s) || f.label.toLowerCase().includes(s)).slice(0, 8);
  };
  /** `{{` typed (and what follows, up to the caret) opens the list of fields. */
  function watchSuggest(e: Editor) {
    if (!(latest.current.mergeFields ?? []).length) return;
    const { $from, empty } = e.state.selection;
    const before = empty ? $from.parent.textBetween(0, $from.parentOffset, undefined, "￼") : "";
    const m = /\{\{\s*([\w.]{0,40})$/.exec(before);
    setSuggest((was) => (m ? { query: m[1]!, from: $from.pos - m[0].length, at: was && was.query === m[1] ? was.at : 0 } : null));
  }
  function insertField(name: string, replaceFrom?: number) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (replaceFrom !== undefined) chain.deleteRange({ from: replaceFrom, to: editor.state.selection.from });
    chain.insertContent({ type: "mergeField", attrs: { name } }).run();
    setSuggest(null);
  }
  function clearFormatting() {
    editor?.chain().focus().unsetAllMarks().unsetTextAlign().clearNodes().run();
  }

  const s = useEditorState({ editor, selector: ({ editor: e }) => (e ? selection(e) : null) }) as Sel | null;
  if (!editor || !s) return null;
  const run = () => editor.chain().focus();
  const back = () => editor.commands.focus();
  const off = !s.editable;
  const closeMenu = (e: Event) => (e.preventDefault(), back());
  const swatches = (colours: string[], names: string[]): Swatch[] => colours.map((color, i) => ({ color, label: names[i] ?? color }));
  const blocks = BLOCKS();
  const setBlock = (id: string) => {
    const c = run();
    if (id === "p") c.setParagraph().run();
    else if (id === "quote") c.setParagraph().toggleBlockquote().run();
    else if (id === "code") c.toggleCodeBlock().run();
    else c.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  };
  const alignIcon = { left: <AlignLeftIcon />, center: <AlignCenterIcon />, right: <AlignRightIcon />, justify: <AlignJustifyIcon /> }[s.align];
  const full = variant === "full";
  const minimal = variant === "minimal";

  const groups: ReactNode[] = [];
  if (full)
    groups.push(
      <ToolbarGroup key="history" id="history">
        <ToolbarButton label={t("Undo")} shortcut="Mod-z" icon={<Undo2Icon />} disabled={off || !s.canUndo} onPress={() => run().undo().run()} />
        <ToolbarButton label={t("Redo")} shortcut="Mod-Shift-z" icon={<Redo2Icon />} disabled={off || !s.canRedo} onPress={() => run().redo().run()} />
      </ToolbarGroup>,
    );
  if (!minimal)
    groups.push(
      <ToolbarGroup key="block" id="block">
        <MenuTool label={t("Paragraph style")} text={blocks.find((b) => b.id === s.block)?.label} width="w-32 pointer-coarse:w-32" disabled={off}>
          <DropdownMenuContent align="start" onCloseAutoFocus={closeMenu}>
            <DropdownMenuRadioGroup value={s.block} onValueChange={setBlock}>
              {blocks.map((b) => (
                <DropdownMenuRadioItem key={b.id} value={b.id}>
                  <span className={b.cls}>{b.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </MenuTool>
        {p.fonts && (
          <>
            <MenuTool label={t("Font")} text={FONTS.find((f) => f.stack === s.font)?.name ?? t("Default font")} width="w-28 pointer-coarse:w-28" disabled={off}>
              <DropdownMenuContent align="start" onCloseAutoFocus={closeMenu}>
                <DropdownMenuRadioGroup value={s.font} onValueChange={(v) => (v ? run().setFontFamily(cleanFontFamily(v) ?? v).run() : run().unsetFontFamily().run())}>
                  <DropdownMenuRadioItem value="">{t("Default font")}</DropdownMenuRadioItem>
                  {FONTS.map((f) => (
                    <DropdownMenuRadioItem key={f.name} value={cleanFontFamily(f.stack)!}>
                      <span style={{ fontFamily: f.stack }}>{f.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </MenuTool>
            <MenuTool label={t("Size")} text={s.size ? s.size.replace("px", "") : t("Auto")} width="w-16 pointer-coarse:w-16" disabled={off}>
              <DropdownMenuContent align="start" onCloseAutoFocus={closeMenu}>
                <DropdownMenuRadioGroup value={s.size} onValueChange={(v) => (v ? run().setFontSize(v).run() : run().unsetFontSize().run())}>
                  <DropdownMenuRadioItem value="">{t("Auto")}</DropdownMenuRadioItem>
                  {SIZES.map((n) => (
                    <DropdownMenuRadioItem key={n} value={`${n}px`}>
                      {n}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </MenuTool>
          </>
        )}
      </ToolbarGroup>,
    );
  groups.push(
    <ToolbarGroup key="marks" id="marks" keep>
      <ToolbarButton label={t("Bold")} shortcut="Mod-b" icon={<BoldIcon />} pressed={s.bold} disabled={off} onPress={() => run().toggleBold().run()} />
      <ToolbarButton label={t("Italic")} shortcut="Mod-i" icon={<ItalicIcon />} pressed={s.italic} disabled={off} onPress={() => run().toggleItalic().run()} />
      {!minimal && <ToolbarButton label={t("Underline")} shortcut="Mod-u" icon={<UnderlineIcon />} pressed={s.underline} disabled={off} onPress={() => run().toggleUnderline().run()} />}
      {!minimal && <ToolbarButton label={t("Strikethrough")} shortcut="Mod-Shift-s" icon={<StrikethroughIcon />} pressed={s.strike} disabled={off} onPress={() => run().toggleStrike().run()} />}
    </ToolbarGroup>,
  );
  if (!minimal)
    groups.push(
      <ToolbarGroup key="colour" id="colour">
        <ColourTool label={t("Text colour")} icon={<BaselineIcon />} value={s.color} swatches={swatches(TEXT_COLOURS, colourNames())} noneLabel={t("Automatic")} recent={recent.color} onPick={(c) => (c ? (run().setColor(c).run(), setRecent((r) => ({ ...r, color: rememberColor(r.color, c) }))) : run().unsetColor().run())} />
        <ColourTool label={t("Highlight")} icon={<HighlighterIcon />} value={s.mark} swatches={swatches(MARKS, markNames())} noneLabel={t("No highlight")} recent={recent.mark} onPick={(c) => (c ? (run().setHighlight({ color: c }).run(), setRecent((r) => ({ ...r, mark: rememberColor(r.mark, c) }))) : run().unsetHighlight().run())} />
      </ToolbarGroup>,
    );
  groups.push(
    <ToolbarGroup key="lists" id="lists" keep={minimal}>
      <ToolbarButton label={t("Bulleted list")} shortcut="Mod-Shift-8" icon={<ListIcon />} pressed={s.bullet} disabled={off} onPress={() => run().toggleBulletList().run()} />
      {!minimal && <ToolbarButton label={t("Numbered list")} shortcut="Mod-Shift-7" icon={<ListOrderedIcon />} pressed={s.ordered} disabled={off} onPress={() => run().toggleOrderedList().run()} />}
      {!minimal && <ToolbarButton label={t("Check list")} shortcut="Mod-Shift-9" icon={<ListChecksIcon />} pressed={s.task} disabled={off} onPress={() => run().toggleTaskList().run()} />}
      {full && <ToolbarButton label={t("Decrease indent")} shortcut="Shift-Tab" icon={<IndentDecreaseIcon />} disabled={off || !s.canOutdent} onPress={() => (editor.can().liftListItem("listItem") ? run().liftListItem("listItem").run() : run().liftListItem("taskItem").run())} />}
      {full && <ToolbarButton label={t("Increase indent")} shortcut="Tab" icon={<IndentIncreaseIcon />} disabled={off || !s.canIndent} onPress={() => (editor.can().sinkListItem("listItem") ? run().sinkListItem("listItem").run() : run().sinkListItem("taskItem").run())} />}
    </ToolbarGroup>,
  );
  if (!minimal)
    groups.push(
      <ToolbarGroup key="align" id="align">
        <MenuTool label={t("Align")} icon={alignIcon} disabled={off}>
          <DropdownMenuContent align="start" onCloseAutoFocus={closeMenu}>
            <DropdownMenuRadioGroup value={s.align} onValueChange={(v) => (v === "left" ? run().unsetTextAlign().run() : run().setTextAlign(v).run())}>
              <DropdownMenuRadioItem value="left">
                <AlignLeftIcon aria-hidden="true" /> {t("Left")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="center">
                <AlignCenterIcon aria-hidden="true" /> {t("Centre")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="right">
                <AlignRightIcon aria-hidden="true" /> {t("Right")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="justify">
                <AlignJustifyIcon aria-hidden="true" /> {t("Justify")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </MenuTool>
      </ToolbarGroup>,
    );
  groups.push(
    <ToolbarGroup key="insert" id="insert" keep={minimal}>
      <ToolbarButton label={t("Link")} shortcut="Mod-k" icon={<Link2Icon />} pressed={s.link} disabled={off} onPress={() => setLinking(true)} />
      {!minimal && canImage && <ToolbarButton label={t("Image")} icon={<ImagePlusIcon />} disabled={off} onPress={() => fileInput.current?.click()} />}
      {full && (
        <Popover>
          <PopoverTrigger asChild>
            <Trigger label={t("Table")} disabled={off}>
              <Table2Icon />
            </Trigger>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" aria-label={t("Table size")} onCloseAutoFocus={(e) => e.preventDefault()}>
            <TablePicker onPick={(rows, cols) => run().insertTable({ rows, cols, withHeaderRow: true }).run()} />
          </PopoverContent>
        </Popover>
      )}
      {full && <ToolbarButton label={t("Horizontal line")} icon={<MinusIcon />} disabled={off} onPress={() => run().setHorizontalRule().run()} />}
      {fields.length > 0 && (
        <MenuTool label={t("Insert a field")} icon={<BracesIcon />} disabled={off}>
          <DropdownMenuContent align="start" className="max-h-72" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("Filled in from the record when sent")}</DropdownMenuLabel>
            {fields.map((f) => (
              <DropdownMenuItem key={f.name} onSelect={() => insertField(f.name)}>
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </MenuTool>
      )}
    </ToolbarGroup>,
  );
  if (!minimal)
    groups.push(
      <ToolbarGroup key="clear" id="clear">
        <ToolbarButton label={t("Clear formatting")} shortcut="Mod-\" icon={<RemoveFormattingIcon />} disabled={off} onPress={clearFormatting} />
      </ToolbarGroup>,
    );

  const count = editor.storage.characterCount as { characters: () => number; words: () => number };
  const characters = count.characters();
  const words = p.wordCount ? count.words() : 0;
  const counter = p.maxLength ? `${characters} / ${p.maxLength}` : null;
  const near = p.maxLength ? characters >= p.maxLength * 0.9 : false;
  const footer = p.status || p.wordCount || counter || uploading > 0;
  const list = suggest ? matching(suggest.query) : [];

  return (
    <div
      className={cn("rte", p.invalid && "rte-invalid", p.disabled && "rte-disabled", p.readOnly && "rte-readonly", p.className)}
      style={{ "--rte-min": p.minHeight ?? (minimal ? "5rem" : "8rem"), "--rte-max": p.maxHeight ?? "28rem" } as React.CSSProperties}
      data-variant={variant}
    >
      {!p.readOnly && (
        <div className="rte-bar">
          <Toolbar label={t("Formatting")} onEscape={back} scrollBelow={360}>
            {groups}
          </Toolbar>
          {s.table && s.editable && (
            <Toolbar label={t("Table")} onEscape={back} className="rte-tablebar">
              <ToolbarGroup id="rows">
                <span className="px-2 text-xs font-medium text-muted-foreground">{t("Table")}</span>
                <ToolbarButton label={t("Add a row above")} icon={<BetweenHorizontalStartIcon />} onPress={() => run().addRowBefore().run()} />
                <ToolbarButton label={t("Add a row below")} icon={<BetweenHorizontalEndIcon />} onPress={() => run().addRowAfter().run()} />
                <ToolbarButton label={t("Delete the row")} icon={<Trash2Icon />} onPress={() => run().deleteRow().run()} />
              </ToolbarGroup>
              <ToolbarGroup id="cols">
                <ToolbarButton label={t("Add a column before")} icon={<BetweenVerticalStartIcon />} onPress={() => run().addColumnBefore().run()} />
                <ToolbarButton label={t("Add a column after")} icon={<BetweenVerticalEndIcon />} onPress={() => run().addColumnAfter().run()} />
                <ToolbarButton label={t("Delete the column")} icon={<Trash2Icon />} onPress={() => run().deleteColumn().run()} />
              </ToolbarGroup>
              <ToolbarGroup id="table">
                <ToolbarButton label={t("Header row")} icon={<PanelTopIcon />} pressed={editor.isActive("tableHeader")} onPress={() => run().toggleHeaderRow().run()} />
                <ToolbarButton label={t("Delete the table")} icon={<Trash2Icon className="text-destructive" />} onPress={() => run().deleteTable().run()} />
              </ToolbarGroup>
            </Toolbar>
          )}
        </div>
      )}
      <div
        className="rte-scroll"
        onMouseDown={(e) => {
          // A click below the last line puts the caret at the end, as in any editor.
          if (e.target === e.currentTarget && s.editable) {
            e.preventDefault();
            editor.commands.focus("end");
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {footer && (
        <div className="rte-footer">
          <span className="min-w-0 truncate" aria-live="polite">
            {uploading > 0 ? t("Adding the image…") : p.status}
          </span>
          <span className="ms-auto flex shrink-0 gap-3">
            {p.wordCount && <span>{words === 1 ? t("1 word") : t("{n} words", { n: words })}</span>}
            {counter && (
              <span className={cn(near && "text-destructive")} aria-label={t("{n} of {max} characters", { n: characters, max: p.maxLength! })}>
                {counter}
              </span>
            )}
          </span>
        </div>
      )}
      {canImage && (
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      )}
      <Popover open={linking} onOpenChange={(o) => !o && setLinking(false)}>
        <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => caretRect(editor) } }} />
        {linking && (
          <PopoverContent align="start" className="w-80" aria-label={t("Link")} onCloseAutoFocus={(e) => e.preventDefault()}>
            <LinkForm editor={editor} onDone={() => setLinking(false)} />
          </PopoverContent>
        )}
      </Popover>
      <Popover open={!!suggest && list.length > 0}>
        <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => caretRect(editor) } }} />
        {suggest && list.length > 0 && (
          <PopoverContent align="start" className="w-64 p-1" aria-label={t("Fields")} onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
            <div role="listbox" aria-label={t("Fields")} className="flex flex-col">
              {list.map((f, i) => (
                <div
                  key={f.name}
                  role="option"
                  aria-selected={i === suggest.at}
                  className={cn("flex cursor-default items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-sm", i === suggest.at && "bg-surface-2")}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertField(f.name, suggest.from);
                  }}
                >
                  <span className="truncate">{f.label}</span>
                  <code className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                    {f.name}
                  </code>
                </div>
              ))}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

