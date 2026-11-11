// @vitest-environment jsdom
// The work-home pattern: queues named by their headings with the count beside (not inside) the name, rows whose one link
// is the whole row, an empty queue as one line, tiles with their status at natural width; and a home shaped like
// Contracts' written as the docs show it (docs/design/PATTERNS.md).

import { act, type ReactNode } from "react";
import { afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PageHead } from "../../packages/kit/src";
import { Badge } from "./kit";
import { ButtonLink, HomeSection, HomeSkeleton, Progress, PageStack, Queue, QueueGrid, QueueItem, Stat, StatGrid, Tile, TileGrid } from "./patterns";
import type { Tone } from "../../packages/kit/src";

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

describe("QueueItem slots", () => {
  it("puts the lead first, the trailing mark before the action, and the action outside the row link", () => {
    const h = draw(<Queue title="Today"><QueueItem to="/a/1" title="Ana Silva" meta="Room 4 · deep clean" lead="09:30" trailing={<Badge>Booked</Badge>} action={<button type="button">Check in</button>} /></Queue>);
    const li = h.querySelector("li")!;
    expect([...li.children].map((c) => c.className)).toEqual(["queue-lead", "queue-text", "queue-trailing", "queue-action"]);
    expect(li.querySelector(".queue-lead")!.textContent).toBe("09:30");
    expect(li.querySelectorAll("a")).toHaveLength(1);
    expect(li.querySelector(".queue-action a")).toBeNull();
    const order = [...li.querySelectorAll("a, button")].map((e) => e.tagName);
    expect(order).toEqual(["A", "BUTTON"]);
  });
  it("lets the action take the click and the row link stay a link", () => {
    let pressed = 0;
    const h = draw(<Queue title="Today"><QueueItem to="/a/1" title="Ana" action={<button type="button" onClick={() => pressed++}>Check in</button>} /></Queue>);
    act(() => h.querySelector<HTMLButtonElement>(".queue-action button")!.click());
    expect(pressed).toBe(1);
    expect(h.querySelector(".queue-action")!.closest("a")).toBeNull();
  });
  it("is a plain row, with no link, when it has no target", () => {
    const h = draw(<Queue title="Today"><QueueItem title="Walk-in" action={<button type="button">Check in</button>} /></Queue>);
    const li = h.querySelector("li")!;
    expect(li.getAttribute("data-plain")).toBe("");
    expect(li.querySelector("a")).toBeNull();
    expect(li.querySelector(".queue-name")!.tagName).toBe("SPAN");
  });
  it("keeps a string meta whole in its tooltip", () => {
    const h = draw(<Queue title="Q"><QueueItem to="/a" title="T" meta="A long line about who and when and where" /></Queue>);
    expect(h.querySelector(".queue-meta")!.getAttribute("title")).toBe("A long line about who and when and where");
  });
});

describe("Queue progress and grid columns", () => {
  it("draws a named slim bar with the percentage at the end", () => {
    const h = draw(<Queue title="Launch" progress={{ value: 40.4, label: "Key results done" }} />);
    const bar = h.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-label")).toBe("Key results done");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(h.querySelector(".queue-progress span")!.textContent).toBe("40%");
    expect(draw(<Queue title="X" progress={{ value: 250 }} />).querySelector(".queue-progress span")!.textContent).toBe("100%");
    expect(draw(<Queue title="X" progress={{ value: 3 }} />).querySelector("[role=progressbar]")!.getAttribute("aria-label")).toBe("Progress");
  });
  it("is one column when asked", () => {
    expect(draw(<QueueGrid columns={1}><Queue title="A" /></QueueGrid>).querySelector(".queue-grid")!.getAttribute("data-columns")).toBe("1");
  });
});

describe("Tile figures and size", () => {
  it("lists labelled figures as a description list", () => {
    const h = draw(<TileGrid min="lg"><Tile title="Block A" figures={[{ label: "Worth", value: "₹1,00,000" }, { label: "Held", value: "₹0" }]} /></TileGrid>);
    expect(h.querySelector("ul")!.getAttribute("data-min")).toBe("lg");
    expect([...h.querySelectorAll("dt")].map((e) => e.textContent)).toEqual(["Worth", "Held"]);
    expect([...h.querySelectorAll("dd")].map((e) => e.textContent)).toEqual(["₹1,00,000", "₹0"]);
  });
});

describe("Stat", () => {
  it("is a link when it has a target and a plain figure when not", () => {
    const h = draw(<StatGrid><Stat label="Waiting" value={4} to="/w" hint="since Monday" /><Stat label="Cost" value="₹204,500.00" /></StatGrid>);
    const [a, b] = [...h.querySelectorAll(".stat")];
    expect([a.tagName, a.getAttribute("href")]).toEqual(["A", "/w"]);
    expect(b.tagName).toBe("DIV");
    expect(a.querySelector(".stat-hint")!.textContent).toBe("since Monday");
  });
  it("is quiet for zero and empty values, loud only when asked", () => {
    const quiet = (v: ReactNode) => draw(<Stat label="L" value={v} />).querySelector(".stat-value")!.hasAttribute("data-quiet");
    expect([0, "0", "₹0.00", "0 h", "", null, "—"].map(quiet)).toEqual([true, true, true, true, true, true, true]);
    expect([4, "₹172,702.10", "10"].map(quiet)).toEqual([false, false, false]);
    expect(draw(<Stat label="L" value={3} tone="danger" />).querySelector(".stat-value")!.getAttribute("data-tone")).toBe("danger");
    expect(draw(<Stat label="L" value={3} />).querySelector(".stat-value")!.hasAttribute("data-tone")).toBe(false);
  });
  it("carries a slim named bar", () => {
    const h = draw(<Stat label="Depreciated" value="16%" progress={{ value: 16, label: "Depreciated" }} />);
    expect(h.querySelector("[role=progressbar]")!.getAttribute("aria-label")).toBe("Depreciated");
  });
});

describe("PageStack", () => {
  it("is the page's rhythm, 16 or 24", () => {
    expect(draw(<PageStack><div /></PageStack>).querySelector(".page-stack")!.hasAttribute("data-gap")).toBe(false);
    expect(draw(<PageStack gap="lg"><div /></PageStack>).querySelector(".page-stack")!.getAttribute("data-gap")).toBe("lg");
  });
});

describe("ButtonLink", () => {
  afterEach(() => vi.restoreAllMocks());
  it("is a router link for `to` and a plain anchor for `href`", () => {
    const h = draw(<><ButtonLink to="/new">New</ButtonLink><ButtonLink href="/crm/" variant="primary" icon="plus">Open CRM</ButtonLink></>);
    const [a, b] = [...h.querySelectorAll("a")];
    expect([a.getAttribute("href"), b.getAttribute("href")]).toEqual(["/new", "/crm/"]);
    expect([a.className, b.className]).toEqual(["btn btn-default btn-md", "btn btn-primary btn-md"]);
  });
  it("needs exactly one of them", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // @ts-expect-error neither
    expect(draw(<ButtonLink>None</ButtonLink>).querySelector("a")).toBeNull();
    // @ts-expect-error both
    expect(draw(<ButtonLink to="/a" href="/b">Both</ButtonLink>).querySelector("a")!.getAttribute("href")).toBe("/a");
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe("Tone", () => {
  it("is nameable from the kit's entry", () => {
    const tones: Record<string, Tone> = { Open: "green", Late: "red" };
    expect(Object.values(tones)).toEqual(["green", "red"]);
  });
});

describe("Progress", () => {
  it("is a named progressbar with its value, max and tone, filling by proportion", () => {
    const h = draw(<Progress value={3} max={12} label="Rooms ready" tone="good" />);
    const bar = h.querySelector("[role=progressbar]")!;
    expect([bar.getAttribute("aria-label"), bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax"), bar.getAttribute("data-tone")]).toEqual(["Rooms ready", "3", "12", "good"]);
    expect((bar.firstElementChild as HTMLElement).style.inlineSize).toBe("25%");
    expect((draw(<Progress value={-4} label="x" />).querySelector(".meter-fill") as HTMLElement).style.inlineSize).toBe("0%");
  });
  it("is drawn full width under a tile's meta lines, before its status", () => {
    const h = draw(<TileGrid><Tile title="Trip 9" meta={<span>Pune</span>} progress={{ value: 6, max: 8, label: "Stops done" }} status={<><Badge>On time</Badge><Badge>Priority</Badge></>} /></TileGrid>);
    const li = h.querySelector("li")!;
    expect([...li.children].map((c) => c.className)).toEqual(["tile-title", "tile-meta", "tile-progress", "tile-status"]);
    expect(li.querySelector("[role=progressbar]")!.getAttribute("aria-label")).toBe("Stops done");
    expect(li.querySelectorAll(".tile-status .badge")).toHaveLength(2);
  });
});

describe("HomeSection", () => {
  it("is a section named by its heading, with a quiet count and header link or actions", () => {
    const h = draw(<HomeSection title="Maple Heights" count={3} link={{ to: "/p/1", label: "Open" }} actions={<button type="button">Add post</button>}><TileGrid><Tile title="Unit 1" /></TileGrid></HomeSection>);
    const sec = h.querySelector("section")!;
    expect(sec.getAttribute("aria-labelledby")).toBe(sec.querySelector("h2")!.id);
    expect(sec.querySelector("h2")!.textContent).toBe("Maple Heights");
    expect(sec.querySelector(".queue-count")!.textContent).toBe("3");
    expect(sec.querySelector(".home-section-end a")!.getAttribute("href")).toBe("/p/1");
    expect(sec.querySelector(".home-section-end button")!.textContent).toBe("Add post");
    expect(sec.querySelector(".tile-grid")).not.toBeNull();
  });
  it("shows one quiet line when it has nothing", () => {
    const h = draw(<HomeSection title="Posts" empty="No posts this week" />);
    expect(h.querySelector(".home-section-empty")!.textContent).toBe("No posts this week");
    expect(draw(<HomeSection title="Posts" />).querySelector(".home-section-empty")).toBeNull();
  });
});
