// Records keys on the API keys page: what is sent for what someone typed, and what a key reaches.

import { describe, expect, it } from "vitest";
import { keyReaches, recordsScope } from "./Admin";

describe("records keys", () => {
  it("are sent as the scope the server checks", () => {
    expect(recordsScope(" Customer = read ;  SalesInvoice=read + create ")).toBe("records:Customer=read;SalesInvoice=read+create");
    expect(recordsScope("Customer=read\nItem=read")).toBe("records:Customer=read;Item=read");
    expect(recordsScope("  ")).toBeUndefined();
  });

  it("say what they reach", () => {
    expect(keyReaches("records:Customer=read;SalesInvoice=create+read")).toBe("Customer: read, SalesInvoice: create and read");
    expect(keyReaches(null)).toBe("the whole API");
  });
});
