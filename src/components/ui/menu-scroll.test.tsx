// @vitest-environment jsdom
// An open menu that scrolls is itself in the tab order (axe scrollable-region-focusable), and still takes the arrow keys' focus.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("gives an open dropdown menu a tab index of 0, so the scrolling element is keyboard reachable", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <DropdownMenu open>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );
  const menu = document.querySelector("[role=menu]")!;
  expect(menu.getAttribute("tabindex")).toBe("0");
  expect(menu.getAttribute("data-slot")).toBe("dropdown-menu-content");
  await act(async () => root.unmount());
});
