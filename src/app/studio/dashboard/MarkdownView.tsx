// Markdown (dashboard notes, chat messages) rendered as React elements, never as HTML: see
// ./markdown.ts for what is understood. Kept apart from the widgets so a screen can show
// Markdown without loading the charting code.

import { cn } from "@/lib/utils";
import { parseMarkdown, type Inline, type MdBlock } from "./markdown";
import { SmartLink } from "./ui";

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.t === "text" ? (
          <span key={i}>{n.v}</span>
        ) : n.t === "code" ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
            {n.v}
          </code>
        ) : n.t === "a" ? (
          <SmartLink key={i} href={n.href} className="text-primary underline underline-offset-2">
            <InlineView nodes={n.c} />
          </SmartLink>
        ) : n.t === "b" ? (
          <strong key={i}>
            <InlineView nodes={n.c} />
          </strong>
        ) : (
          <em key={i}>
            <InlineView nodes={n.c} />
          </em>
        ),
      )}
    </>
  );
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: MdBlock[] = parseMarkdown(source);
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const H = (["h3", "h4", "h5"] as const)[b.level - 1];
            return (
              <H key={i} className={cn("font-semibold", b.level === 1 ? "text-lg" : b.level === 2 ? "text-base" : "text-sm")}>
                <InlineView nodes={b.c} />
              </H>
            );
          }
          case "p":
            return (
              <p key={i}>
                <InlineView nodes={b.c} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
                <InlineView nodes={b.c} />
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
          default: {
            const L = b.t;
            return (
              <L key={i} className={cn("space-y-0.5 pl-5", L === "ul" ? "list-disc" : "list-decimal")}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <InlineView nodes={it} />
                  </li>
                ))}
              </L>
            );
          }
        }
      })}
    </div>
  );
}
