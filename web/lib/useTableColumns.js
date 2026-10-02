'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// A detail row must span the columns that CSS currently displays. Counting
// the rendered header avoids adding implicit columns to narrow fixed tables.
export function useTableColumns(active) {
  const ref = useRef(null);
  const [columns, setColumns] = useState(7);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!active || !table) return;
    const update = () => setColumns([...table.tHead.rows[0].cells].filter((cell) => getComputedStyle(cell).display !== 'none').length);
    const observer = new ResizeObserver(update);
    observer.observe(table.parentElement);
    update();
    return () => observer.disconnect();
  }, [active]);
  return { ref, columns };
}
