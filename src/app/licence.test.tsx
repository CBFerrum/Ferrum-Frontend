// A sold app's licence in the install dialog: asked for, lapsed, or live.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LicenceNeeded, storeHost } from "./Apps";

const need = { app: "paidping", store: "http://localhost:8080", given: false, live: false };

describe("a sold app's licence", () => {
  it("is asked for, named for its app, until one is given", () => {
    const html = renderToString(<LicenceNeeded need={need} onGiven={() => {}} />);
    expect(html).toContain("paidping is sold in the store at localhost:8080");
    const id = /<label[^>]*for="([^"]+)"[^>]*>Licence for paidping/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Give the licence");
  });

  it("says why a given one does not do", () => {
    expect(renderToString(<LicenceNeeded need={{ ...need, given: true }} onGiven={() => {}} />)).toContain("has lapsed: renew it in the store");
    expect(renderToString(<LicenceNeeded need={{ ...need, given: true, last_error: "HTTP 502" }} onGiven={() => {}} />)).toContain("could not be checked: HTTP 502");
  });

  it("is live, with no field", () => {
    const html = renderToString(<LicenceNeeded need={{ ...need, given: true, live: true, period_end: "2027-01-01T00:00:00Z" }} onGiven={() => {}} />);
    expect(html).toContain("licence is live until");
    expect(html).not.toContain("<input");
  });

  it("names its store by host", () => {
    expect([storeHost("https://store.ferrum.cloud/"), storeHost("not a url")]).toEqual(["store.ferrum.cloud", "not a url"]);
  });
});
