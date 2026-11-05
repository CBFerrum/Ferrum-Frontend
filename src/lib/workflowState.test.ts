import { describe, expect, it } from "vitest";
import { inWorkflowState, type Field, type FieldState } from "./meta";

const field = (name: string) => ({ name, type: "data" }) as unknown as Field;
const open: FieldState = { visible: true, required: false, disabled: false };

describe("a field in a workflow state", () => {
  it("is as the entity has it in a state that says nothing", () => {
    expect(inWorkflowState(field("email"), open, undefined)).toEqual(open);
    expect(inWorkflowState(field("email"), open, {})).toEqual(open);
  });

  it("is read-only unless the state lets it change", () => {
    const pending = { editable: ["email"] };
    expect(inWorkflowState(field("email"), open, pending).disabled).toBe(false);
    expect(inWorkflowState(field("customer_name"), open, pending).disabled).toBe(true);
  });

  it("is required where the state needs it, and stays locked when the form is", () => {
    const approved = { required: ["email"] };
    expect(inWorkflowState(field("email"), open, approved)).toEqual({ visible: true, required: true, disabled: false });
    expect(inWorkflowState(field("email"), { ...open, disabled: true }, { editable: ["email"] }).disabled).toBe(true);
  });
});
