// An app mounts its shell the way an app does (a root route with lazy children, as the app's routes file has it) and
// React Router must not warn that it has no HydrateFallback.

import { renderToString } from "react-dom/server";
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withHydrateFallback } from "./appRouter";

const appRoutes: RouteObject[] = [
  { path: "/", element: <Outlet />, children: [{ path: "orders", lazy: () => Promise.resolve({ Component: () => <p>orders</p> }) }] },
];

function mount(routes: RouteObject[]) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const router = createMemoryRouter(routes, { initialEntries: ["/orders"] });
  renderToString(<RouterProvider router={router} />);
  return warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("HydrateFallback"));
}

describe("an app's router", () => {
  afterEach(() => vi.restoreAllMocks());
  it("warns without a fallback (the fault)", () => {
    expect(mount(appRoutes)).toHaveLength(1);
  });
  it("does not warn once withHydrateFallback has given the root one", () => {
    expect(mount(withHydrateFallback(appRoutes))).toEqual([]);
  });
  it("keeps a root's own fallback", () => {
    const own = () => <p>mine</p>;
    expect(withHydrateFallback([{ path: "/", HydrateFallback: own }])[0].HydrateFallback).toBe(own);
  });
});
