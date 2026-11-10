import { describe, expect, it } from "vitest";
import { buttonName, checkButton, fromButton, isConfigured, pointAt, removeBatch, saveBatch, setLabel, setParamLabel, startButton, toButton, newParam, newRefusal } from "./buttonDraft";

// The shape of the docs' example, and the other effects the platform takes.
const doc = {
  name: "accept", label: "Accept It", condition: "doc.status == 'Draft'", confirm: "Accept taking this risk on?",
  roles: ["Risk Approver"],
  params: [{ name: "note", label: "Note", type: "text" }],
  refuse_if: [{ when: "doc.risk_owner == user.email", message: "a risk's owner does not approve taking it on" }],
  effects: [
    { type: "set_fields", values: { status: "'Accepted'", approver: "user.email", decided_on: "today" } },
    { type: "update_linked", link: "risk", values: { treatment: "'Accept'" } },
    { type: "create_document", entity: "XLog", values: { text: "params.note" } },
    { type: "notify", to: "role:Auditor", title: "'Accepted: ' + params.note" },
    { type: "email", to: "doc.email", subject: "'Hi'", body: "'x'", template: "<p>{{ params.note }}</p>", purpose: "transactional" },
  ],
};

describe("a configured button as a draft", () => {
  it("goes back unchanged for every shape in the docs", () => {
    expect(toButton(fromButton(doc))).toEqual(doc);
    const small = { name: "x_stop", label: "Stop", effects: [{ type: "set_fields", values: { status: "'Stopped'" } }] };
    expect(toButton(fromButton(small))).toEqual(small);
    const choice = { name: "pick", label: "Pick", params: [{ name: "kind", label: "Kind", type: "select", options: ["a", "b"], required: true, description: "which" }, { name: "who", label: "Who", type: "link", to: "Customer" }, { name: "n", label: "N", type: "int" }, { name: "d", label: "D", type: "date" }, { name: "t", label: "T", type: "data" }], effects: [] };
    expect(toButton(fromButton(choice))).toEqual(choice);
  });
  it("keeps what it has no control for, and an effect it does not know", () => {
    const odd = { ...doc, group: "More", docstatus: [0], effects: [{ type: "webhook", url: "x" }, ...doc.effects], params: [{ name: "q", label: "Q", type: "data", mask: true }], refuse_if: [{ when: "true", message: "no", code: 7 }] };
    expect(toButton(fromButton(odd))).toEqual(odd);
  });
  it("tells a configured button from a package's", () => {
    expect(isConfigured({ effects: [] })).toBe(true);
    expect(isConfigured({})).toBe(false);
  });
});

describe("a new button's name", () => {
  it("follows the label, with x_ on a packaged entity, and avoids the actions that exist", () => {
    expect(buttonName("Accept It", [], false)).toBe("accept_it");
    expect(buttonName("Accept It", [], true)).toBe("x_accept_it");
    expect(buttonName("Accept It", ["x_accept_it", "x_accept_it_2"], true)).toBe("x_accept_it_3");
    expect(setLabel(startButton(), "Close case", [], true).name).toBe("x_close_case");
  });
  it("is fixed once the button is saved or the name was typed", () => {
    expect(setLabel(fromButton(doc), "Other", [], false).name).toBe("accept");
    expect(setLabel({ ...startButton(), name: "mine", nameTouched: true }, "Other", [], false).name).toBe("mine");
  });
  it("gives a question its name from its label", () => {
    const d = { ...startButton(), params: [{ ...newParam(), key: "p" }] };
    expect(setParamLabel(d, "p", "Reason why").params[0].name).toBe("reason_why");
  });
});

describe("what a save sends", () => {
  it("adds, or changes by the same name, with one add_action", () => {
    const d = fromButton(doc);
    expect(saveBatch("XRiskAcceptance", d, "Buttons")).toEqual([{ entity: "XRiskAcceptance", op: { op: "add_action", action: doc }, note: "Buttons" }]);
    const changed = saveBatch("XRiskAcceptance", { ...d, label: "Accept" })[0].op as { action: { name: string; label: string } };
    expect(changed.action.name).toBe("accept");
    expect(changed.action.label).toBe("Accept");
  });
  it("removes by name", () => {
    expect(removeBatch("XTask", "x_stop")).toEqual([{ entity: "XTask", op: { op: "remove_action", name: "x_stop" } }]);
  });
});

describe("what is wrong with a button", () => {
  it("accepts the docs' example", () => {
    expect(checkButton(fromButton(doc), ["accept"], false)).toEqual([]);
  });
  it("names each unfinished part", () => {
    const d = { ...startButton(), refusals: [newRefusal()], params: [{ ...newParam(), type: "select" }] };
    const text = checkButton(d, [], true).map((p) => p.message).join("\n");
    expect(text).toMatch(/label/);
    expect(text).toMatch(/starts with x_|cannot be used/);
    expect(text).toMatch(/Refusal 1: say when/);
    expect(text).toMatch(/Question 1: list the choices/);
    expect(text).toMatch(/at least one thing the button does/);
  });
  it("refuses a name an action already has, but not for the button being changed", () => {
    const d = { ...fromButton(doc) };
    expect(checkButton(d, ["accept"], false)).toEqual([]);
    expect(checkButton({ ...d, saved: false }, ["accept"], false).map((p) => p.message).join()).toMatch(/already has/);
  });
});

describe("where the server's words point", () => {
  it("finds the effect or refusal it counts from 1", () => {
    const d = fromButton(doc);
    expect(pointAt("XRiskAcceptance: action accept, effect 2: no field 'zz'", d).effect).toBe(d.effects[1].key);
    expect(pointAt("action accept: refuse_if 1: cannot compile", d).refusal).toBe(d.refusals[0].key);
    expect(pointAt("action accept: condition: cannot compile", d).condition).toBe(true);
    expect(pointAt("something else", d)).toEqual({});
  });
});
