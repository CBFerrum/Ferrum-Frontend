import { describe, expect, it } from "vitest";
import { actionJson, checkActions, checkAutomation, fromAction, mapRefusal, fromAutomation, makeOffset, parseOffset, readBack, toAutomation, type Automation, type CheckContext, type Draft, type Trigger } from "./automationDraft";

const fields = [
  { name: "end_date", label: "End date", type: "date" },
  { name: "starts_at", label: "Starts at", type: "datetime" },
  { name: "status", label: "Status", type: "select" },
  { name: "total", label: "Total", type: "currency" },
  { name: "name", label: "Name", type: "data" },
] as CheckContext["fields"];
const ctx: CheckContext = { submittable: true, fields };

const base = { name: "Remind", entity: "Contract", condition: null, is_active: true };
const roundTrip = (a: Automation) => toAutomation(fromAutomation(a));
const mail = { type: "email", to: "doc.email", subject: "'Hi'", body: "'Hello'" };

const samples: Record<string, Automation> = {
  "set_fields": { ...base, event: "updated", condition: "doc.total > 1.0", actions: [{ type: "set_fields", values: { remarks: "'x'", status: "'Open'" } }] },
  "create_document": { ...base, id: "a-1", event: "submitted", actions: [{ type: "create_document", entity: "Project", values: { project_name: "'Follow-up for ' + doc.name" } }] },
  "notify owner": { ...base, event: "created", actions: [{ type: "notify", to: "owner", title: "'x'" }] },
  "notify role with body": { ...base, event: "created", actions: [{ type: "notify", to: "role:Sales Manager", title: "'x'", body: "doc.name" }] },
  "notify user and field": { ...base, event: "deleted", actions: [{ type: "notify", to: "user:0191b6a0-0000-7000-8000-000000000001", title: "'x'" }, { type: "notify", to: "field:owner_email", title: "'y'" }] },
  "email plain": { ...base, event: "cancelled", actions: [mail, { ...mail, purpose: "marketing" }] },
  "email formatted": { ...base, event: "created", actions: [{ ...mail, template: "<p>{{ doc.name }}</p>", purpose: "transactional" }] },
  "unknown action": { ...base, event: "created", actions: [{ type: "webhook", url: "https://x.test", extra: [1, 2] }, "odd", { type: "notify", to: "everyone", title: "'x'" }, { type: "set_fields", values: { a: 1 } }] },
  "relative": { ...base, event: "scheduled", is_active: false, schedule: { relative: { field: "end_date", offset: "-P3D", at: "09:00", repeat: "P1W", until: "end_date" } }, actions: [mail] },
  "relative datetime": { ...base, event: "scheduled", schedule: { relative: { field: "starts_at", offset: "PT90M" } }, actions: [mail] },
  "every day": { ...base, event: "scheduled", schedule: { every: { period: "day", at: "07:30" } }, actions: [mail] },
  "every week": { ...base, event: "scheduled", schedule: { every: { period: "week", at: "08:00", on: 1 } }, actions: [mail] },
  "every month last with filters": {
    ...base,
    event: "scheduled",
    schedule: { every: { period: "month", at: "18:00", on: "last", filter: [["status", "=", "Open"], ["total", ">=", "100.00"], ["name", "like", "%a%"], ["end_date", "is", "not set"]] } },
    actions: [mail],
  },
  "schedule the editor has no form for": { ...base, event: "scheduled", schedule: { relative: { field: "end_date", offset: "P1DT2H" } }, actions: [mail] },
  "a future schedule": { ...base, event: "scheduled", schedule: { cron: "* * * * *" }, actions: [mail] },
};

describe("automation JSON and drafts", () => {
  for (const [name, a] of Object.entries(samples)) {
    it(`round-trips ${name}`, () => expect(roundTrip(a)).toEqual(a));
  }

  it("keeps an action it does not know as a read-only card, in place", () => {
    const d = fromAutomation(samples["unknown action"]);
    expect(d.actions.map((a) => a.kind)).toEqual(["raw", "raw", "raw", "raw"]);
  });

  it("keeps a schedule it has no form for, with its event", () => {
    expect(fromAutomation(samples["schedule the editor has no form for"]).trigger.kind).toBe("raw");
    expect(fromAutomation(samples["relative"]).trigger.kind).toBe("relative");
  });

  it("sends a missing condition as null, and gives a formatted mail without a body an empty text", () => {
    const d = fromAutomation({ ...samples["email formatted"], condition: undefined });
    expect(toAutomation(d).condition).toBeNull();
    d.actions = d.actions.map((a) => (a.kind === "email" ? { ...a, body: "" } : a));
    expect((toAutomation(d).actions as { body: string }[])[0].body).toBe("''");
  });

  it("sends a relative schedule and an every schedule as the server takes them", () => {
    const rel = fromAutomation(samples["relative"]);
    expect(toAutomation(rel).schedule).toEqual({ relative: { field: "end_date", offset: "-P3D", at: "09:00", repeat: "P1W", until: "end_date" } });
    const ev = fromAutomation(samples["every month last with filters"]);
    expect(toAutomation(ev).schedule).toEqual({ every: { period: "month", at: "18:00", on: "last", filter: [["status", "=", "Open"], ["total", ">=", "100.00"], ["name", "like", "%a%"], ["end_date", "is", "not set"]] } });
  });
});

describe("offsets", () => {
  it("reads and writes days, hours and minutes, before and after", () => {
    expect(parseOffset("-P3D")).toEqual({ amount: "3", unit: "days", dir: "before" });
    expect(parseOffset("PT2H")).toEqual({ amount: "2", unit: "hours", dir: "after" });
    expect(parseOffset("PT90M")).toEqual({ amount: "90", unit: "minutes", dir: "after" });
    expect(makeOffset("3", "days", "before")).toBe("-P3D");
    expect(makeOffset("90", "minutes", "after")).toBe("PT90M");
    expect(makeOffset("2", "hours", "before")).toBe("-PT2H");
  });

  it("keeps zero", () => {
    expect(parseOffset("P0D")).toEqual({ amount: "0", unit: "days", dir: "after" });
    expect(makeOffset("0", "days", "after")).toBe("P0D");
    expect(makeOffset("0", "minutes", "before")).toBe("-PT0M");
  });

  it("does not read what it cannot show", () => {
    for (const s of ["P1DT2H", "PT1H30M", "P1W", "-P1M", "PT0S", "3", "", "+P3D", null, 3]) expect(parseOffset(s)).toBeNull();
  });
});

const ok = (over: Partial<Draft> = {}): Draft => ({ ...fromAutomation(samples["notify owner"]), ...over });
const messages = (d: Draft, c = ctx) => checkAutomation(d, c).map((p) => p.message);

describe("checking an automation", () => {
  it("accepts a complete one", () => {
    for (const a of Object.values(samples)) expect(messages(fromAutomation(a))).toEqual([]);
  });

  it("wants a name, an entity and an action", () => {
    expect(messages(ok({ name: " ", entity: "", actions: [] }))).toEqual(["Give the automation a name.", "Choose the kind of record it works on.", "Add at least one action."]);
  });

  it("allows submitted and cancelled only where records can be submitted", () => {
    const d = ok({ trigger: { kind: "event", event: "submitted" } });
    expect(messages(d, { ...ctx, submittable: false })).toEqual(["“submitted” only applies to records that can be submitted: choose another event."]);
    expect(messages(ok({ trigger: { kind: "event", event: "created" } }), { ...ctx, submittable: false })).toEqual([]);
  });

  it("wants every action complete", () => {
    const d = ok({
      actions: [
        { key: "1", kind: "set_fields", rows: [{ key: "r", field: "", expr: "" }] },
        { key: "2", kind: "create_document", entity: "", rows: [] },
        { key: "3", kind: "notify", to: "role", target: "", title: "" , body: "" },
        { key: "4", kind: "email", to: "", subject: "", formatted: true, body: "", template: " " },
        { key: "5", kind: "set_fields", rows: [{ key: "a", field: "x", expr: "1" }, { key: "b", field: "x", expr: "2" }] },
      ],
    });
    expect(messages(d)).toEqual([
      "Action 1: every row needs a field and a value.",
      "Action 2: choose the kind of record to create.",
      "Action 2: add at least one field to fill in.",
      "Action 3: choose the role to tell.",
      "Action 3: write the notification's title.",
      "Action 4: say who the mail goes to.",
      "Action 4: write the subject.",
      "Action 4: write the formatted message.",
      "Action 5: “x” appears twice.",
    ]);
  });

  it("wants a complete relative schedule with a date field", () => {
    const rel: Extract<Trigger, { kind: "relative" }> = { kind: "relative", field: "", amount: "x", unit: "days", dir: "before", at: "9", repeat: "", until: "" };
    expect(messages(ok({ trigger: rel }))).toEqual(["Choose the date field the schedule counts from.", "Enter how long before or after as a whole number, 0 or more.", "Enter the time of day as hours and minutes, like 09:00."]);
    expect(messages(ok({ trigger: { ...rel, field: "name", amount: "1", at: "" } }))).toEqual(["“Name” is not a date field of this record."]);
  });

  it("wants a time of day and a valid day for a calendar schedule, and at most 8 filter rows", () => {
    const every: Extract<Trigger, { kind: "every" }> = { kind: "every", period: "month", at: "", on: "30", filters: [] };
    expect(messages(ok({ trigger: every }))).toEqual(["Choose the time of day the schedule runs.", "Choose a day of the month from 1 to 28, or the last day."]);
    expect(messages(ok({ trigger: { ...every, period: "week", at: "09:00", on: "8" } }))).toEqual(["Choose a weekday."]);
    const rows = Array.from({ length: 9 }, (_, i) => ({ key: `f${i}`, field: "status", op: "=", value: "Open" }));
    expect(messages(ok({ trigger: { ...every, at: "09:00", on: "last", filters: rows } }))).toEqual(["Use at most 8 filter rows."]);
  });

  it("wants each filter row finished, with numbers where a field holds them", () => {
    const f = (field: string, op: string, value: unknown) => ({ key: field + op, field, op, value });
    const every: Trigger = { kind: "every", period: "day", at: "09:00", on: "", filters: [f("", "=", ""), f("status", "=", ""), f("total", ">", "abc"), f("name", "is", "set"), f("total", ">", "5.50")] };
    expect(messages(ok({ trigger: every }))).toEqual(["Finish filter row 1, or remove it.", "Finish filter row 2, or remove it.", "Filter row 3 needs a number."]);
  });
});

describe("reading a schedule back", () => {
  const read = (a: Automation) => readBack(fromAutomation(a).trigger, ctx);

  it("says a relative schedule in one sentence", () => {
    expect(read({ ...samples["relative"], schedule: { relative: { field: "end_date", offset: "-P3D" } } })).toBe("3 days before End date at 09:00, in the workspace's time zone");
    expect(read(samples["relative"])).toBe("3 days before End date at 09:00, in the workspace's time zone, then every week, until End date");
    expect(read({ ...samples["relative"], schedule: { relative: { field: "end_date", offset: "P0D", at: "17:45" } } })).toBe("On End date at 17:45, in the workspace's time zone");
  });

  it("leaves out the time of day for a datetime field, and counts hours and minutes", () => {
    expect(read(samples["relative datetime"])).toBe("90 minutes after Starts at");
    expect(read({ ...samples["relative datetime"], schedule: { relative: { field: "starts_at", offset: "-PT1H" } } })).toBe("1 hour before Starts at");
  });

  it("says a calendar schedule, with its filters", () => {
    expect(read(samples["every day"])).toBe("Every day at 07:30, in the workspace's time zone");
    expect(read(samples["every week"])).toBe("Every Monday at 08:00, in the workspace's time zone");
    expect(read(samples["every month last with filters"])).toBe(
      "On the last day of every month at 18:00, in the workspace's time zone, for records where Status is Open; Total is at least 100.00; Name contains a; End date is empty",
    );
  });

  it("says nothing for a record event", () => {
    expect(read(samples["notify owner"])).toBeNull();
  });
});

describe("mapping a refused save", () => {
  it("puts an action's message on its index, a named field on its control, and the rest nowhere in particular", () => {
    const r = mapRefusal([
      { field: "actions", message: "expression 'doc.title +': bad", row: ["actions", 1] },
      { field: "actions", message: "second", row: ["actions", 1] },
      { field: "condition", message: "bad condition" },
      { field: "schedule", message: "bad schedule" },
      { field: "actions", message: "too many" },
      { field: "event", message: "unknown event" },
    ]);
    expect(r.actions.get(1)).toBe("expression 'doc.title +': bad second");
    expect(r.actions.size).toBe(1);
    expect(r.named).toEqual({ condition: "bad condition", schedule: "bad schedule" });
    expect(r.other).toEqual(["too many", "unknown event"]);
  });
});

describe("the action that changes the record a link names", () => {
  it("goes back unchanged, and is checked for a link and fields", () => {
    const a = { type: "update_linked", link: "risk", values: { treatment: "'Accept'" } };
    const draft = fromAction(a);
    expect(draft.kind).toBe("update_linked");
    expect(actionJson(draft)).toEqual(a);
    expect(checkActions([draft], 20)).toEqual([]);
    expect(checkActions([{ ...(draft as { key: string; kind: "update_linked"; rows: never[]; link: string }), link: "", rows: [] }], 20).length).toBe(2);
  });
  it("keeps an update_linked with more keys as it was", () => {
    expect(fromAction({ type: "update_linked", link: "x", values: {}, extra: 1 }).kind).toBe("raw");
  });
});

describe("the step of another app", () => {
  const cap = { id: "erp.sales_invoice.create", title: "Create a Sales Invoice", inputs: [{ name: "values", type: "object", required: true }, { name: "submit", type: "boolean", required: false }] };
  it("goes back unchanged, with what the editor has no control for", () => {
    const a = { type: "invoke", capability: cap.id, input: { values: "{'customer': doc.customer}", submit: "true" }, key: "'fee:' + doc.id", note: "kept" };
    const draft = fromAction(a);
    expect(draft.kind).toBe("invoke");
    expect(actionJson(draft)).toEqual(a);
    const bare = { type: "invoke", capability: "erp.x.read" };
    expect(actionJson(fromAction(bare))).toEqual(bare);
  });
  it("keeps an input that is not an expression as it was", () => {
    expect(fromAction({ type: "invoke", capability: "x", input: { a: 1 } }).kind).toBe("raw");
  });
  it("is checked: a step chosen, required inputs given, no input it does not have, a key when once", () => {
    const d = (over: object) => ({ ...fromAction({ type: "invoke", capability: cap.id, input: { values: "{}" } }), ...over }) as never;
    expect(checkActions([d({})], 20, [cap])).toEqual([]);
    expect(checkActions([d({ capability: "" })], 20, [cap]).length).toBe(1);
    expect(checkActions([d({ capability: "erp.other" })], 20, [cap]).length).toBe(1);
    expect(checkActions([d({ rows: [] })], 20, [cap]).length).toBe(1);
    expect(checkActions([d({ rows: [{ key: "k", field: "values", expr: "{}" }, { key: "j", field: "nope", expr: "1" }] })], 20, [cap]).length).toBe(1);
    expect(checkActions([d({ once: true, onceKey: " " })], 20, [cap]).length).toBe(1);
    expect(checkActions([d({ rows: [] })], 20)).toEqual([]);
  });
});

describe("lines", () => {
  const add = { type: "append_line", table: "items", values: { item: "params.item", qty: "1" } };
  const change = { type: "set_line", table: "items", where: "row.item == params.item", values: { qty: "row.qty + 1" }, note: "kept" };
  it("round-trips both actions, keeping what it does not know", () => {
    expect(actionJson(fromAction(add))).toEqual(add);
    expect(actionJson(fromAction(change))).toEqual(change);
    expect(fromAction(add).kind).toBe("append_line");
    expect(fromAction({ type: "set_line", table: "items", values: {} }).kind).toBe("raw");
  });
  it("says what is missing", () => {
    const say = (a: unknown) => checkActions([fromAction(a)], 5).map((p) => p.message);
    expect(say(add)).toEqual([]);
    expect(say(change)).toEqual([]);
    expect(say({ ...add, table: "", values: {} })).toHaveLength(2);
    expect(say({ ...change, where: " " })).toHaveLength(1);
  });
});
