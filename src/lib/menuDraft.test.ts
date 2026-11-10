import { describe, expect, it } from "vitest";
import { checkMenu, fromModule, menuName, removeBatch, removeItem, saveBatch, setLabel, startMenu, toModule, toggleCreate, type MenuDraft } from "./menuDraft";

const module = {
  name: "x_grc", label: "Governance", icon: "landmark", color: "#336699", description: "Risks and audits", order: 7, items: ["XRisk", "report:risk_register", "XAudit"], create: ["XRisk"],
  assistant: { instructions: "Speak plainly.", suggestions: ["Which risks are open?"], tone: "dry" },
};
const draft = (over: Partial<MenuDraft> = {}) => ({ ...fromModule(module), ...over });

describe("a menu as a draft", () => {
  it("goes module to draft to module unchanged, keeping what the screen has no control for", () => {
    expect(toModule(fromModule(module))).toEqual(module);
    expect(toModule(fromModule({ name: "x_a", label: "A", items: [], future: 1 }))).toEqual({ name: "x_a", label: "A", items: [], future: 1 });
  });
  it("sends assistant only with instructions, and leaves empty things out", () => {
    const m = toModule(draft({ instructions: " ", suggestions: ["Q"], icon: "", color: "", description: "", create: [] }));
    expect(m).not.toHaveProperty("assistant");
    for (const k of ["icon", "color", "description", "create"]) expect(m).not.toHaveProperty(k);
  });
  it("makes the name from the label, avoiding the menus there are, until it is saved", () => {
    expect(menuName("Governance & Risk", [])).toBe("x_governance_risk");
    expect(menuName("Risk", ["x_risk"])).toBe("x_risk_2");
    expect(menuName("a".repeat(80), []).length).toBeLessThanOrEqual(40);
    const d = setLabel(startMenu(), "Risk desk", []);
    expect(d.name).toBe("x_risk_desk");
    expect(setLabel({ ...d, nameTouched: true }, "Other", []).name).toBe("x_risk_desk");
    expect(setLabel(draft(), "Renamed", []).name).toBe("x_grc");
  });
  it("saves and removes through define_module and remove_module, entity being the menu", () => {
    expect(saveBatch(draft(), "Menus")).toEqual([{ entity: "x_grc", op: { op: "define_module", module }, note: "Menus" }]);
    expect(removeBatch("x_grc")).toEqual([{ entity: "x_grc", op: { op: "remove_module", name: "x_grc" } }]);
  });
  it("takes an item out of the + entries with it", () => {
    expect(removeItem(draft(), "XRisk")).toMatchObject({ items: ["report:risk_register", "XAudit"], create: [] });
    expect(toggleCreate(draft(), "XAudit", true).create).toEqual(["XRisk", "XAudit"]);
    expect(toggleCreate(draft(), "XRisk", false).create).toEqual([]);
  });
  it("checks the label, the limits, an item twice and a + entry outside the items", () => {
    expect(checkMenu(draft(), [])).toEqual([]);
    expect(checkMenu(draft({ label: " " }), [])).toHaveLength(1);
    expect(checkMenu(draft({ label: "x".repeat(61) }), [])).toHaveLength(1);
    expect(checkMenu(draft({ name: "grc" }), [])).toHaveLength(1);
    expect(checkMenu(draft({ saved: false }), ["x_grc"])).toHaveLength(1);
    expect(checkMenu(draft({ description: "d".repeat(201) }), [])).toHaveLength(1);
    expect(checkMenu(draft({ color: "red" }), [])).toHaveLength(1);
    expect(checkMenu(draft({ items: ["XRisk", "XRisk"] }), []).join()).toContain("twice");
    expect(checkMenu(draft({ items: Array.from({ length: 51 }, (_, i) => `X${i}`), create: [] }), [])).toHaveLength(1);
    expect(checkMenu(draft({ create: ["XOther"] }), [])).toHaveLength(1);
    expect(checkMenu(draft({ create: ["report:risk_register"] }), [])).toHaveLength(1);
    expect(checkMenu(draft({ instructions: "i".repeat(2001) }), [])).toHaveLength(1);
    expect(checkMenu(draft({ suggestions: Array(7).fill("q") }), [])).toHaveLength(1);
    expect(checkMenu(draft({ suggestions: ["q".repeat(201)] }), [])).toHaveLength(1);
    expect(checkMenu(draft({ instructions: "", suggestions: ["q"] }), [])[0]).toContain("need instructions");
  });
});
