import { describe, expect, it } from "vitest";
import { checkTarget, eligible, fromTarget, readWithin, removeBatch, saveBatch, setLabel, startTarget, stateTone, targetsOf, toTarget, withinOf, withinWords, type TargetDraft } from "./targetDraft";
import { fieldState, isServerManaged, type Field } from "./meta";

const f = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, label: name, type, can_read: true, can_write: true, ...extra }) as unknown as Field;
const fields = [f("priority", "select", { options: ["High", "Normal"] }), f("status", "select", { options: ["Open", "Closed"] }), f("x_by", "datetime"), f("x_state", "data"), f("due", "datetime")];
const doc = { name: "respond", label: "First response", calendar: "office", start_when: "doc.status != 'Draft'", within: "doc.priority == 'High' ? 'PT1H' : 'PT4H'", pause_when: "doc.status == 'Waiting'", met_when: "doc.status == 'Closed'", due_field: "x_by", state_field: "x_state" };

describe("within", () => {
  it("reads the simple shapes back and writes them as they were", () => {
    for (const w of ["'PT4H'", "'PT90M'", "'P2D'", "doc.priority == 'High' ? 'PT1H' : doc.priority == 'Normal' ? 'P1D' : null", "doc.priority == 'Normal' ? 'PT30M' : null"]) {
      const r = readWithin(w, fields);
      expect(r, w).not.toBeNull();
      expect(withinOf({ ...startTarget(), ...r! }, ["High", "Normal"]), w).toBe(w);
    }
  });
  it("leaves every other shape to the expression", () => {
    for (const w of ["3600", "'PT1H30M'", "doc.priority == 'High' ? 'PT1H' : 'PT4H'", "doc.priority == 'Normal' ? 'PT1H' : doc.priority == 'High' ? 'PT2H' : null", "doc.nope == 'a' ? 'PT1H' : null", "doc.priority == 'Low' ? 'PT1H' : null", ""]) expect(readWithin(w, fields), w).toBeNull();
  });
  it("keeps a choice with a quote in it", () => {
    const odd = [f("k", "select", { options: ["It's", "b"] })];
    const w = "doc.k == 'It\\'s' ? 'PT1H' : null";
    expect(readWithin(w, odd)?.per["It's"]).toEqual({ amount: "1", unit: "h" });
  });
  it("says it in words", () => {
    expect(withinWords({ within: "'PT4H'" }, fields)).toBe("4 hours");
    expect(withinWords({ within: doc.within }, fields)).toBe(doc.within);
  });
});

describe("a target as a draft", () => {
  it("goes back unchanged for the documented shapes", () => {
    expect(toTarget(fromTarget(doc, fields), [])).toEqual({ ...doc, within: doc.within });
    const small = { name: "a", label: "A", within: "'PT4H'", met_when: "doc.status == 'Closed'", due_field: "x_by", state_field: "x_state" };
    expect(toTarget(fromTarget(small, fields))).toEqual(small);
    const per = { ...small, within: "doc.priority == 'High' ? 'PT1H' : doc.priority == 'Normal' ? 'PT4H' : null" };
    const d = fromTarget(per, fields);
    expect(d.how).toBe("choice");
    expect(toTarget(d, ["High", "Normal"])).toEqual(per);
  });
  it("drops what the server adds for the reader", () => {
    const d = fromTarget({ ...small(), may_run: true, package: "x", kept: 1, extra: {} }, fields);
    expect(Object.keys(toTarget(d)).sort()).toEqual(["due_field", "label", "met_when", "name", "state_field", "within"]);
  });
  it("starts with a name from the label", () => {
    expect(setLabel(startTarget(), "First response", []).name).toBe("first_response");
    expect(setLabel({ ...startTarget(), saved: true, name: "keep" }, "Other", []).name).toBe("keep");
  });
});
const small = () => ({ name: "a", label: "A", within: "'PT4H'", met_when: "doc.status == 'Closed'", due_field: "x_by", state_field: "x_state" });

const draft = (patch: Partial<TargetDraft> = {}): TargetDraft => ({ ...startTarget(), label: "First response", name: "respond", same: { amount: "4", unit: "h" }, metWhen: "doc.status == 'Closed'", ...patch });

describe("the batch", () => {
  it("adds two fields then the target on an entity that comes with a package", () => {
    const ops = saveBatch("Ticket", draft(), { fields, packaged: true, note: "n" });
    expect(ops.map((o) => o.op.op)).toEqual(["add_field", "add_field", "add_target"]);
    expect(ops[0].op.field).toEqual({ name: "x_respond_by", type: "datetime", label: "First response due" });
    expect(ops[1].op.field).toEqual({ name: "x_respond_state", type: "select", label: "First response state", options: ["running", "paused", "met", "met_late", "breached"] });
    expect(ops[2].op.target).toMatchObject({ name: "respond", within: "'PT4H'", due_field: "x_respond_by", state_field: "x_respond_state" });
  });
  it("sends the definition back with the fields appended on the workspace's own entity", () => {
    const def = { name: "XTicket", label: "Ticket", fields: [{ name: "a", type: "data", label: "A" }], targets: [] };
    const ops = saveBatch("XTicket", draft(), { fields, packaged: false, def });
    expect(ops.map((o) => o.op.op)).toEqual(["redefine_entity", "add_target"]);
    const sent = ops[0].op.entity as { fields: { name: string }[]; targets: unknown[] };
    expect(sent.fields.map((x) => x.name)).toEqual(["a", "respond_by", "respond_state"]);
    expect(sent.targets).toEqual([]);
    expect(def.fields).toHaveLength(1);
  });
  it("makes only the field asked for, and none when both are picked", () => {
    expect(saveBatch("T", draft({ makeDue: false, dueField: "x_by" }), { fields, packaged: true }).map((o) => o.op.op)).toEqual(["add_field", "add_target"]);
    const ops = saveBatch("T", draft({ makeDue: false, makeState: false, dueField: "x_by", stateField: "x_state" }), { fields, packaged: true });
    expect(ops).toHaveLength(1);
    expect(removeBatch("T", "respond")).toEqual([{ entity: "T", op: { op: "remove_target", name: "respond" } }]);
  });
  it("avoids a field name the entity has", () => {
    const ops = saveBatch("T", draft(), { fields: [...fields, f("x_respond_by", "datetime")], packaged: true });
    expect(ops[0].op.field).toMatchObject({ name: "x_respond_2_by" });
  });
});

describe("the checks", () => {
  const ctx = { taken: [] as string[], fields, packaged: false };
  const say = (d: TargetDraft, c = ctx) => checkTarget(d, c).map((p) => p.message).join("|");
  it("passes a whole draft", () => expect(checkTarget(draft(), ctx)).toEqual([]));
  it("wants a label, a duration and a met condition", () => {
    expect(checkTarget(startTarget(), ctx).length).toBeGreaterThanOrEqual(4);
    expect(say(draft({ same: { amount: "0", unit: "h" } }))).toMatch(/how long/i);
    expect(say(draft({ metWhen: "" }))).toMatch(/met/);
  });
  it("wants a choice field and one duration for a duration per choice", () => {
    expect(checkTarget(draft({ how: "choice" }), ctx)).toHaveLength(1);
    expect(checkTarget(draft({ how: "choice", field: "priority", per: { High: { amount: "1", unit: "h" }, Normal: { amount: "", unit: "h" } } }), ctx)).toEqual([]);
    expect(checkTarget(draft({ how: "choice", field: "priority", per: { High: { amount: "x", unit: "h" } } }), ctx)).toHaveLength(1);
  });
  it("takes only eligible fields", () => {
    const picked = (p: Partial<TargetDraft>, c = ctx) => checkTarget(draft({ makeDue: false, makeState: false, ...p }), c).length;
    expect(picked({ dueField: "due", stateField: "x_state" })).toBe(0);
    expect(picked({ dueField: "due", stateField: "x_state" }, { ...ctx, packaged: true })).toBe(1);
    expect(picked({ dueField: "priority", stateField: "x_state" })).toBe(1);
    expect(picked({ dueField: "x_by", stateField: "status" })).toBe(1);
    expect(picked({ dueField: "", stateField: "" })).toBe(2);
  });
  it("leaves out a field another target keeps", () => {
    const kept = [f("a", "datetime", { kept_by_target: "other" }), f("b", "datetime", { kept_by_target: "respond" }), f("c", "datetime")];
    expect(eligible(kept, "due", "respond", false).map((x) => x.name)).toEqual(["b", "c"]);
  });
  it("refuses a name the entity has and a ninth target", () => {
    expect(say(draft(), { ...ctx, taken: ["respond"] })).toMatch(/already/);
    expect(say(draft(), { ...ctx, taken: Array.from({ length: 8 }, (_, i) => `t${i}`) })).toMatch(/at most 8/);
  });
});

describe("the state words", () => {
  it("has a tone for each", () => expect(["running", "paused", "met", "met_late", "breached"].map(stateTone)).toEqual(["blue", "amber", "green", "amber", "red"]));
});

describe("a field a target keeps", () => {
  it("is the platform's to write, as a total is", () => {
    const kept = f("x_by", "datetime", { kept_by_target: "respond" });
    expect(isServerManaged(kept)).toBe(true);
    expect(fieldState(kept, { doc: {} }).disabled).toBe(true);
    expect(fieldState(f("x_by", "datetime"), { doc: {} }).disabled).toBe(false);
  });
});

describe("a calendar and a start taken from the record (BD-41)", () => {
  const withOpened = [...fields, f("opened_at", "datetime"), f("plan", "select", { options: ["Gold"] })];
  it("are sent when chosen and left out when not, and read back from a saved target", () => {
    const sent = toTarget(draft({ calendarField: "agreement.calendar", startField: "opened_at" }));
    expect(sent).toMatchObject({ calendar_field: "agreement.calendar", start_field: "opened_at" });
    const plain = toTarget(draft());
    expect("calendar_field" in plain || "start_field" in plain).toBe(false);
    const back = fromTarget({ ...small(), calendar_field: "plan", start_field: "opened_at" }, withOpened);
    expect([back.calendarField, back.startField]).toEqual(["plan", "opened_at"]);
  });
  it("are checked: the calendar field's shape and a start that is a date and time", () => {
    const ctx = { taken: [], fields: withOpened, packaged: false };
    const said = (patch: Partial<TargetDraft>) => checkTarget(draft({ makeDue: true, makeState: true, ...patch }), ctx).map((p) => p.message).join(" ");
    expect(said({ calendarField: "a.b.c" })).toContain("calendar field");
    expect(said({ startField: "plan" })).toContain("cannot start the clock");
    expect(said({ calendarField: "agreement.calendar", startField: "opened_at" })).toBe("");
  });
  it("shows what a record keeps of its targets, once begun", () => {
    const targets = [{ name: "a", label: "A", due_field: "a_by", state_field: "a_state" }, { name: "b", label: "B", due_field: "b_by", state_field: "b_state" }];
    expect(targetsOf(targets, { a_state: "breached", a_by: "2026-11-12T09:00:00Z", b_state: null })).toEqual([{ name: "a", label: "A", state: "breached", due: "2026-11-12T09:00:00Z" }]);
    expect(targetsOf(undefined, {})).toEqual([]);
  });
});
