// Marks the kit's sideways-scrolling rows with `data-more`, which edges have more to scroll to; src/styles.css draws the fade.
// A state set from the scroll position, not an animation, so it holds in a screenshot, under reduced motion and in every browser.
const ROWS = ".table-wrap, .tabs, .segmented, .scroll-cue";

/** "end": more after (at rest), "both": in the middle, "start": at the end; "" when the row fits. */
export function moreOf(el: { scrollWidth: number; clientWidth: number; scrollLeft: number }): "" | "end" | "start" | "both" {
  const room = el.scrollWidth - el.clientWidth, at = Math.abs(el.scrollLeft); // scrollLeft is negative right to left
  return room < 2 ? "" : at < 2 ? "end" : at > room - 2 ? "start" : "both";
}

function mark(el: HTMLElement) {
  const more = moreOf(el);
  if ((el.getAttribute("data-more") ?? "") !== more) more ? el.setAttribute("data-more", more) : el.removeAttribute("data-more");
}

/** Watches the page once: scrolling, resizing, and rows appearing or changing. */
export function watchEdges() {
  // A page without frames to wait for (jsdom in tests) has no layout to measure either: nothing is watched, nothing is left scheduled.
  if (typeof requestAnimationFrame !== "function") return;
  let queued = false;
  const soon = () => {
    // Asked again when it fires: a test that lent the page `requestAnimationFrame` may have taken it back (or torn the page down).
    if (queued || typeof requestAnimationFrame !== "function") return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      document.querySelectorAll<HTMLElement>(ROWS).forEach(mark);
    });
  };
  document.addEventListener("scroll", (e) => e.target instanceof HTMLElement && e.target.matches(ROWS) && mark(e.target), { capture: true, passive: true });
  addEventListener("resize", soon);
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
  void document.fonts?.ready.then(soon);
  soon();
}
