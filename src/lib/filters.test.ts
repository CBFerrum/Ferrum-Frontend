import { describe, expect, it } from "vitest";
import { filterable, isWord, joinNumber, periodRange, splitNumber, joinRange, readFilters, serializeFilters, splitRange, toApiFilters, writeFilters } from "./filters";

const fields = [
  { name: "status", type: "select" },
  { name: "customer", type: "link" },
  { name: "is_return", type: "check" },
  { name: "posting_date", type: "date" },
  { name: "created_on", type: "datetime" },
  { name: "po_no", type: "data" },
  { name: "qty", type: "int" },
  { name: "rate", type: "currency" },
];

describe("toApiFilters", () => {
  it("serializes each filter type", () => {
    expect(
      toApiFilters(fields, {
        status: "Paid",
        customer: "01a1832f-b13f-7102-8759-1d2c43bbced8",
        is_return: "0",
        posting_date: "2026-01-01..2026-03-31",
        created_on: "2026-02-01..",
        po_no: "PO-1",
        qty: "5",
        rate: "12.50",
      }),
    ).toEqual([
      ["status", "=", "Paid"],
      ["customer", "=", "01a1832f-b13f-7102-8759-1d2c43bbced8"],
      ["is_return", "=", false],
      ["posting_date", ">=", "2026-01-01"],
      ["posting_date", "<=", "2026-03-31"],
      ["created_on", ">=", new Date(2026, 1, 1).toISOString()],
      ["po_no", "like", "%PO-1%"],
      ["qty", "=", 5],
      ["rate", "=", "12.50"],
    ]);
  });

  it("skips empty and invalid values", () => {
    expect(toApiFilters(fields, { status: "", is_return: "maybe", qty: "1.5", rate: "abc", posting_date: ".." })).toEqual([]);
    expect(toApiFilters(fields, { unknown: "x" })).toEqual([]);
  });

  it("handles open-ended date ranges", () => {
    expect(toApiFilters(fields, { posting_date: "..2026-12-31" })).toEqual([["posting_date", "<=", "2026-12-31"]]);
  });
});

describe("serializeFilters", () => {
  it("returns JSON or undefined", () => {
    expect(serializeFilters(fields, {})).toBeUndefined();
    expect(serializeFilters(fields, { is_return: "1" })).toBe('[["is_return","=",true]]');
  });
});

describe("URL round trip", () => {
  it("reads and writes filters while keeping other params", () => {
    const sp = new URLSearchParams("q=acme&sort=posting_date+desc&f.status=Paid");
    expect(readFilters(sp)).toEqual({ status: "Paid" });
    const next = writeFilters(sp, { status: "", posting_date: joinRange("2026-01-01", "") });
    expect(next.get("q")).toBe("acme");
    expect(next.get("sort")).toBe("posting_date desc");
    expect(next.has("f.status")).toBe(false);
    expect(next.get("f.posting_date")).toBe("2026-01-01..");
    expect(splitRange(next.get("f.posting_date") ?? "")).toEqual(["2026-01-01", ""]);
    expect(joinRange("", "")).toBe("");
  });
});

describe("words a filter can use", () => {
  const date = [{ name: "due", type: "date" }];
  const now = new Date(2026, 10, 4, 15); // a Wednesday

  it("work out the period when the list asks, so a saved view keeps meaning it", () => {
    expect(toApiFilters(date, { due: "@today" }, now)).toEqual([
      ["due", ">=", "2026-11-04"],
      ["due", "<=", "2026-11-04"],
    ]);
    expect(toApiFilters(date, { due: "@today" }, new Date(2026, 10, 5))[0][2]).toBe("2026-11-05");
  });

  it("start a week on Monday and keep months whole", () => {
    expect(periodRange("@this_week", now)).toEqual(["2026-11-02", "2026-11-08"]);
    expect(periodRange("@last_week", now)).toEqual(["2026-10-26", "2026-11-01"]);
    expect(periodRange("@this_week", new Date(2026, 10, 8))).toEqual(["2026-11-02", "2026-11-08"]); // a Sunday
    expect(periodRange("@last_month", now)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(periodRange("@this_month", new Date(2028, 1, 10))).toEqual(["2028-02-01", "2028-02-29"]);
    expect(periodRange("@last_month", new Date(2027, 0, 31))).toEqual(["2026-12-01", "2026-12-31"]);
    expect(periodRange("@last_7", now)).toEqual(["2026-10-29", "2026-11-04"]);
    expect(periodRange("@next_7", now)).toEqual(["2026-11-04", "2026-11-10"]);
  });

  it("put what is overdue before today, with no start", () => {
    expect(toApiFilters(date, { due: "@overdue" }, now)).toEqual([["due", "<=", "2026-11-03"]]);
  });

  it("use the viewer's day for a moment in time", () => {
    const [[, , lo], [, , hi]] = toApiFilters([{ name: "at", type: "datetime" }], { at: "@today" }, now);
    expect(new Date(lo as string).getTime()).toBe(new Date(2026, 10, 4).getTime());
    expect(new Date(hi as string).getTime()).toBe(new Date(2026, 10, 4, 23, 59, 59, 999).getTime());
  });

  it("ask whether any field holds a value", () => {
    for (const type of ["data", "link", "select", "date", "currency", "int"]) {
      expect(toApiFilters([{ name: "x", type }], { x: "@empty" })).toEqual([["x", "is", "not set"]]);
      expect(toApiFilters([{ name: "x", type }], { x: "@set" })).toEqual([["x", "is", "set"]]);
    }
  });

  it("leave a text value that only looks like one alone", () => {
    expect(toApiFilters([{ name: "email", type: "data" }], { email: "@gmail" })).toEqual([["email", "like", "%@gmail%"]]);
    expect(isWord("@gmail")).toBe(false);
    expect(isWord("@today")).toBe(true);
  });
});

describe("number filters", () => {
  const int = [{ name: "n", type: "int" }];
  const money = [{ name: "m", type: "currency" }];

  it("compare as well as match, and keep decimals as text", () => {
    expect(toApiFilters(int, { n: "5" })).toEqual([["n", "=", 5]]);
    expect(toApiFilters(int, { n: ">=5" })).toEqual([["n", ">=", 5]]);
    expect(toApiFilters(money, { m: "<10.50" })).toEqual([["m", "<", "10.50"]]);
    expect(toApiFilters(money, { m: "10..20" })).toEqual([
      ["m", ">=", "10"],
      ["m", "<=", "20"],
    ]);
    expect(toApiFilters(money, { m: "..20" })).toEqual([["m", "<=", "20"]]);
  });

  it("drop what is not a number instead of asking the server to refuse it", () => {
    expect(toApiFilters(int, { n: ">=abc" })).toEqual([]);
    expect(toApiFilters(int, { n: "1.5" })).toEqual([]);
  });

  it("read back what they write", () => {
    for (const raw of ["5", ">=5", "<=5", ">5", "<5", "1..2", "..2", "1.."]) {
      const { op, a, b } = splitNumber(raw);
      expect(joinNumber(op, a, b)).toBe(raw);
    }
    expect(joinNumber(">=", "", "")).toBe("");
    expect(joinNumber("..", "", "")).toBe("");
  });
});

describe("which fields can be filtered", () => {
  const f = (name: string, type: string, more = {}) => ({ name, type, can_read: true, ...more });

  it("is any the viewer can read, with those the app puts forward first", () => {
    const got = filterable([f("note", "text"), f("status", "select", { in_filter: true }), f("amount", "currency")]);
    expect(got.map((x) => x.name)).toEqual(["status", "note", "amount"]);
  });

  it("leaves out what is closed to them and what a list cannot ask about", () => {
    const got = filterable([f("a", "table"), f("b", "attach"), f("c", "secret"), f("d", "json"), f("e", "data", { hidden: true }), f("g", "data", { can_read: false })]);
    expect(got).toEqual([]);
  });
});
