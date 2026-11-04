import { describe, expect, it } from "vitest";
import { ago, connectionFacts, runWords } from "./connections";

const now = new Date("2026-11-01T12:00:00Z");
const fact = (facts: ReturnType<typeof connectionFacts>, label: string) => facts.find((f) => f.label === label)!;

describe("a connection's health", () => {
  it("tells each thing apart: a working sign-in over a stale feed is not healthy", () => {
    const facts = connectionFacts({ authentication: "ok", freshness: "2026-10-30T12:00:00Z" }, now);
    expect([fact(facts, "Sign-in").tone, fact(facts, "Last sync").tone]).toEqual(["green", "amber"]);
    expect(fact(facts, "Last sync").value).toBe("2 days ago");
  });

  it("says when a provider is being left alone, and why", () => {
    const f = fact(connectionFacts({ authentication: "ok", quota: { waiting_until: "2026-11-01T12:30:00Z", reason: "rate limit", failures: 0 } }, now), "Provider");
    expect(f.value).toContain("Left alone until");
    expect([f.tone, f.detail]).toEqual(["amber", "rate limit"]);
  });

  it("stops waiting once the time has passed", () => {
    expect(fact(connectionFacts({ quota: { waiting_until: "2026-11-01T11:00:00Z" } }, now), "Provider").value).toBe("Answering");
  });

  it("counts failures before a provider is left alone", () => {
    expect(fact(connectionFacts({ quota: { failures: 2 } }, now), "Provider").value).toBe("2 failed in a row");
  });

  it("marks what needs a person", () => {
    const facts = connectionFacts({ dead_letters: 3, drift: 2, backlog: 7 }, now);
    expect([fact(facts, "Failed changes").tone, fact(facts, "Differences").tone, fact(facts, "Waiting to go").value]).toEqual(["red", "amber", "7"]);
  });

  it("never shows a new connection as fine", () => {
    const facts = connectionFacts({}, now);
    expect([fact(facts, "Sign-in").value, fact(facts, "Last sync").value]).toEqual(["No credentials", "Never"]);
    expect(connectionFacts({ authentication: "failing" }, now)[0].tone).toBe("red");
  });
});

describe("how long ago", () => {
  it("reads naturally", () => {
    expect(ago("2026-11-01T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-11-01T11:59:00Z", now)).toBe("1 minute ago");
    expect(ago("2026-11-01T09:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-10-31T12:00:00Z", now)).toBe("1 day ago");
  });
});

describe("what a connection did", () => {
  it("says each run in words, and which can be tried again", () => {
    const run = (kind: string, status: string, stream?: string) => ({ id: "1", kind, status, stream, created_at: "2026-11-05T01:00:00Z" });
    expect(runWords(run("platform.connector.sync", "done"))).toEqual({ what: "Read", tone: "green", again: false });
    expect(runWords(run("platform.connector.deliver", "failed", "posts"))).toEqual({ what: "Sent on posts", tone: "red", again: true });
    expect(runWords(run("platform.connector.reconcile", "running")).tone).toBe("amber");
  });
});
