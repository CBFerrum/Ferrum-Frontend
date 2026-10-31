import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculate, loadEngine } from "./index";

describe("the pricing engine in the browser", () => {
  it("prices, taxes and rounds as the server does", async () => {
    await loadEngine(readFileSync(new URL("./ferrum_calc_bg.wasm", import.meta.url)));
    const out = await calculate({
      precision: 2,
      lines: [
        { key: "a", qty: "2", price: "10.00" },
        { key: "b", qty: "1", price: "5.50", discount_percent: "10" },
      ],
      taxes: [{ key: "gst", charge_type: "on_net_total", rate: "18" }],
      round_total_to: "1",
    });
    // 2 × 10.00 + 1 × 4.95 = 24.95; 18% = 4.49 (4.491); 29.44 → 29.00.
    expect([out.net_total, out.total_taxes, out.grand_total, out.rounded_total, out.rounding_adjustment]).toEqual(["24.95", "4.49", "29.44", "29.00", "-0.44"]);
    expect(out.lines.map((l) => Number(l.rate))).toEqual([10, 4.95]);
  });

  it("says what it refuses", async () => {
    await expect(calculate({ precision: 2, lines: [{ key: "a", qty: "1", price: "1" }], taxes: [{ key: "t", charge_type: "on_previous_row_amount", rate: "5", row_ref: 3 }] })).rejects.toThrow();
  });
});
