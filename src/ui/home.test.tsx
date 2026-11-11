// @vitest-environment jsdom
// The work-home pattern: queues named by their headings with the count beside (not inside) the name, rows whose one link
// is the whole row, an empty queue as one line, tiles with their status at natural width; and a home shaped like
// Contracts' written as the docs show it (docs/design/PATTERNS.md).

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PageHead } from "../../packages/kit/src";
import { Badge } from "./kit";
import { ButtonLink, HomeSkeleton, Queue, QueueGrid, QueueItem, Tile, TileGrid } from "./patterns";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draw = (ui: ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<MemoryRouter>{ui}</MemoryRouter>));
  return host;
};

describe("Queue", () => {
  it("is a section named by its heading alone, with the count beside it and rows as a list", () => {
    const h = draw(
      <Queue title="Out for signature" count={2} link={{ to: "/e/Contract", label: "All contracts" }} more={{ to: "/e/Contract", count: 3 }}>
        <QueueItem to="/e/Contract/1" title="Cleaning services" meta="Acme · renews 3 Mar" trailing={<Badge>Out for Signature</Badge>} />
        <QueueItem to="/e/Contract/2" title="Rent" />
      </Queue>,
    );
    const section = h.querySelector("section")!;
    const heading = section.querySelector("h2")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent).toBe("Out for signature");
    expect(section.querySelector(".queue-count")!.textContent).toBe("2");
    expect(section.querySelectorAll("ul > li")).toHaveLength(2);
    const links = [...section.querySelectorAll("li a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/e/Contract/1", "/e/Contract/2"]);
    expect(section.querySelector("li")!.querySelectorAll("a")).toHaveLength(1);
    expect(links[0].getAttribute("title")).toBe("Cleaning services");
    expect(section.querySelector(".queue-more")!.textContent).toBe("and 3 more");
    expect(section.querySelector(".queue-link-all")!.textContent).toBe("All contracts");
  });
  it("shows one quiet line, and keeps its count, when empty", () => {
    const h = draw(<Queue title="Active" count={0} />);
    expect(h.querySelector("ul")).toBeNull();
    expect(h.querySelector(".queue-empty")!.textContent).toBe("Nothing waiting");
    expect(h.querySelector(".queue-count")!.textContent).toBe("0");
    expect(draw(<Queue title="Active" empty="No open incidents" />).querySelector(".queue-empty")!.textContent).toBe("No open incidents");
  });
  it("marks an attention queue", () => {
    expect(draw(<Queue title="Notice due" count={1} tone="attention" />).querySelector("section")!.getAttribute("data-tone")).toBe("attention");
  });
});

describe("Tile", () => {
  it("is a list item whose title is the link when it opens something", () => {
    const h = draw(
      <TileGrid label="Tables">
        <Tile to="/t/4" title="Table 4" meta={<span>2 covers</span>} status={<Badge tone="green">Open</Badge>} />
        <Tile title="Table 5" />
      </TileGrid>,
    );
    expect(h.querySelector("ul")!.getAttribute("aria-label")).toBe("Tables");
    const [a, b] = [...h.querySelectorAll("li")];
    expect(a.querySelector("a")!.getAttribute("href")).toBe("/t/4");
    expect(a.querySelector(".tile-status")!.textContent).toBe("Open");
    expect(b.querySelector("a")).toBeNull();
  });
});

describe("HomeSkeleton", () => {
  it("is one status named Loading", () => {
    const h = draw(<HomeSkeleton queues={2} />);
    expect(h.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(h.querySelectorAll(".queue")).toHaveLength(2);
  });
});

describe("PageHead", () => {
  it("is the page's h1 with a summary, a way back and actions at the end", () => {
    const h = draw(<PageHead title="Contracts" description="3 open" back={{ to: "/", label: "Home" }} actions={<ButtonLink to="/e/Contract/new" variant="primary" icon="plus">New contract</ButtonLink>} />);
    expect(h.querySelector("h1.page-title")!.textContent).toBe("Contracts");
    expect(h.querySelector(".page-sub")!.textContent).toBe("3 open");
    expect(h.querySelector("a.page-back")!.getAttribute("href")).toBe("/");
    expect(h.querySelector(".page-actions a.btn-primary")!.textContent).toBe("New contract");
  });
});

// A home shaped like Contracts': notice due first as an attention queue, the stages, the obligations (the overdue marked).
interface Contract { id: string; title: string; counterparty: string; ends_on: string; status: string; notice_due?: boolean }
interface Obligation { id: string; description: string; due_on: string; overdue?: boolean }
const LIMIT = 5;
function ContractsHome({ stages, obligations, notice }: { stages: [string, Contract[]][]; obligations: Obligation[]; notice: Contract[] }) {
  const row = (c: Contract) => <QueueItem key={c.id} to={`/e/Contract/${c.id}`} title={c.title} meta={`${c.counterparty} · ${c.ends_on}`} trailing={<Badge>{c.status}</Badge>} />;
  return (
    <>
      <PageHead title="Contracts" description={`${notice.length} notice due · ${obligations.length} obligations open`} actions={<ButtonLink to="/e/Contract/new" variant="primary" icon="plus">New contract</ButtonLink>} />
      <QueueGrid>
        {notice.length > 0 && <Queue title="Notice due before renewal" count={notice.length} tone="attention">{notice.slice(0, LIMIT).map(row)}</Queue>}
        {stages.map(([stage, list]) => (
          <Queue key={stage} title={stage} count={list.length} more={{ to: "/e/Contract", count: list.length - LIMIT }}>{list.slice(0, LIMIT).map(row)}</Queue>
        ))}
        <Queue title="Obligations" count={obligations.length}>
          {obligations.map((o) => <QueueItem key={o.id} to={`/e/Obligation/${o.id}`} title={o.description} meta={`Due ${o.due_on}`} trailing={o.overdue ? <Badge tone="red">Overdue</Badge> : undefined} />)}
        </Queue>
      </QueueGrid>
    </>
  );
}

describe("a home written on the pattern", () => {
  it("puts the attention queue first, caps long queues and leaves empty ones one line", () => {
    const c = (i: number, notice = false): Contract => ({ id: `c${i}`, title: `Contract ${i}`, counterparty: "Acme", ends_on: "1 Mar", status: "Active", notice_due: notice });
    const many = Array.from({ length: 7 }, (_, i) => c(i));
    const h = draw(<ContractsHome notice={[c(99, true)]} stages={[["In the works", []], ["Active", many]]} obligations={[{ id: "o1", description: "Send report", due_on: "2 Mar", overdue: true }]} />);
    const queues = [...h.querySelectorAll("section.queue")];
    expect(queues.map((q) => q.querySelector("h2")!.textContent)).toEqual(["Notice due before renewal", "In the works", "Active", "Obligations"]);
    expect(queues[0].getAttribute("data-tone")).toBe("attention");
    expect(queues[1].querySelector(".queue-empty")).not.toBeNull();
    expect(queues[2].querySelectorAll("li")).toHaveLength(5);
    expect(queues[2].querySelector(".queue-more")!.textContent).toBe("and 2 more");
    expect(queues[3].querySelector(".badge-red")!.textContent).toBe("Overdue");
  });
});
