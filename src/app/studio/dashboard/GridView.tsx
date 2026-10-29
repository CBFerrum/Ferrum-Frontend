// The dashboard grid: viewing lays widgets out with CSS grid (see grid.css: saved positions on
// wide screens, reading order on tablets and phones); editing uses react-grid-layout for dragging
// and resizing on the 12-column grid, at least 640px wide (narrow screens scroll it sideways).

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { GridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "./grid.css";
import { COLS, fromLayout, GAP_PX, phoneSpan, readingOrder, ROW_PX, sameGeometry, tabletSpan, toLayout, type Placed } from "./layout";

const MIN_EDIT_WIDTH = 640;

export function GridView<T extends { i: string; x: number; y: number; w: number; h: number }>({ items, render }: { items: readonly T[]; render: (it: T) => ReactNode }) {
  return (
    <div className="dash-grid">
      <div className="dash-cells">
        {readingOrder(items).map((it) => (
          <div
            key={it.i}
            className="dash-cell"
            style={{ "--x": it.x + 1, "--y": it.y + 1, "--w": it.w, "--h": it.h, "--tablet": tabletSpan(it.w), "--phone": phoneSpan(it.w) } as CSSProperties}
          >
            {render(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridEditor({ items, onChange, render }: { items: Placed[]; onChange: (items: Placed[]) => void; render: (it: Placed) => ReactNode }) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const canvas = Math.max(width, MIN_EDIT_WIDTH);
  const layout = useMemo(() => toLayout(items), [items]);
  return (
    <div ref={containerRef} className="overflow-x-auto pb-2">
      {mounted && (
        <div style={{ width: canvas }}>
          <GridLayout
            className="dash-edit"
            width={canvas}
            layout={layout}
            gridConfig={{ cols: COLS, rowHeight: ROW_PX, margin: [GAP_PX, GAP_PX], containerPadding: [0, 0] }}
            dragConfig={{ enabled: true, handle: ".dash-drag", threshold: 4 }}
            resizeConfig={{ enabled: true, handles: ["se"] }}
            compactor={verticalCompactor}
            onLayoutChange={(l) => {
              if (!sameGeometry(items, l)) onChange(fromLayout(items, l));
            }}
          >
            {items.map((it) => (
              <div key={it.i} data-item={it.i}>
                {render(it)}
              </div>
            ))}
          </GridLayout>
        </div>
      )}
    </div>
  );
}
