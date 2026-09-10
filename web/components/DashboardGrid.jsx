'use client';

// Dashboard card grid (react-grid-layout v2). At container widths ≥
// GRID_BREAKPOINT every card is a draggable/resizable grid item — drag by
// the card head (or the whole card for the headless KPI/cost cards), resize
// from the bottom-right corner; the layout persists to localStorage and the
// masthead reset button restores defaultLayout(). Below the breakpoint — and
// before the first measurement, including the static export — the same cards
// render in the legacy static stream (.kpis + .sheet) that the existing
// media queries collapse to a single column, so mobile is unchanged.
//
// absoluteStrategy (top/left, no transforms) keeps the position:fixed Tip
// tooltips working — a transformed ancestor would become their containing
// block. RGL clones each direct child with ref/className/style, so every
// grid item is wrapped in a plain div keyed by its layout id.

import { Fragment, useCallback, useEffect, useState } from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import { absoluteStrategy } from 'react-grid-layout/core';
import { GRID_BREAKPOINT, GRID_COLS, LAYOUT_STORAGE_KEY, defaultLayout, sanitizeLayout } from '@/lib/layout';

const KPI_IDS = ['kpi-tokens', 'kpi-cost', 'kpi-cache', 'kpi-days'];
const SHEET_IDS = ['trend', 'heatmap', 'agents', 'models', 'hour', 'month', 'rhythm', 'sessions'];
// Cards without a .cell-head drag region drag by the whole card; they hold
// no interactive controls the cancel list would miss.
const FULL_HANDLE_IDS = new Set([...KPI_IDS, 'cost']);

function readStoredLayout() {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? sanitizeLayout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export default function DashboardGrid({ items, tx, resetRef }) {
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true });
  const [layout, setLayout] = useState(() => (typeof window === 'undefined' ? null : readStoredLayout()) ?? defaultLayout());

  const persist = useCallback((next) => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))));
    } catch {
      /* private mode */
    }
  }, []);

  const onLayoutChange = useCallback((next) => {
    setLayout(next.map((item) => ({ ...item })));
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    } catch {
      /* private mode */
    }
    setLayout(defaultLayout());
  }, []);

  useEffect(() => {
    if (resetRef) resetRef.current = reset;
  }, [resetRef, reset]);

  const gridMode = mounted && width >= GRID_BREAKPOINT;

  return (
    <div ref={containerRef} className={gridMode ? 'dashboard-grid' : 'dashboard-grid dashboard-grid-static'}>
      {gridMode ? (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: 36, margin: [16, 16], containerPadding: [0, 0] }}
          dragConfig={{ handle: '.cell-head, .grid-item-handle', cancel: 'a,button,input,select,textarea,summary,.no-drag' }}
          positionStrategy={absoluteStrategy}
          onLayoutChange={onLayoutChange}
          onDragStop={persist}
          onResizeStop={persist}
        >
          {layout.map((item) => (
            <div key={item.i} className={FULL_HANDLE_IDS.has(item.i) ? 'grid-item grid-item-handle' : 'grid-item'}>
              {items[item.i]}
            </div>
          ))}
        </ReactGridLayout>
      ) : (
        <>
          <section className="kpis" aria-label={tx('heroAria')}>
            {KPI_IDS.map((id) => (
              <Fragment key={id}>{items[id]}</Fragment>
            ))}
          </section>
          {items.cost}
          {items.comparison}
          <div className="sheet">
            {SHEET_IDS.map((id) => (
              <Fragment key={id}>{items[id]}</Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
