import { describe, expect, it } from "vitest";
import type { AppSummary } from "./Apps";
import { firstRunChoices } from "./FirstRun";

const app = (id: string, categories: string[], parent?: string): AppSummary => ({ id, name: id, version: "1.0.0", runtime: "native", summary: "", categories, parent });

describe("the first-run picker", () => {
  it("offers suites, then apps that stand on their own", () => {
    const { suites, apps } = firstRunChoices([
      app("crm", ["crm"]),
      app("business", ["suite"]),
      app("crm-erp", ["connector", "crm"]),
      app("india", ["finance"], "erp"),
      app("erp", ["finance"]),
    ]);
    expect(suites.map((a) => a.id)).toEqual(["business"]);
    expect(apps.map((a) => a.id)).toEqual(["crm", "erp"]);
  });
});
