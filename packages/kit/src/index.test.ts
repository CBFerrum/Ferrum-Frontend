// @vitest-environment jsdom
// The kit's entry point carries what apps are told they may import: a name dropped from it breaks 40 apps at build time.
import { describe, expect, it } from "vitest";
import * as kit from "./index";

describe("@ferrum/kit", () => {
  it("exports the toast placement hook, so no app needs the data-toast-placement attribute", () => {
    expect(typeof kit.useToastPlacement).toBe("function");
    expect(typeof kit.toast).toBe("function");
    expect(typeof kit.Toaster).toBe("function");
    const placement: kit.ToastPlacement = "bottom-start";
    expect(placement).toBe("bottom-start");
  });
});
