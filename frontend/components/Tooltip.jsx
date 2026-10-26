'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const OFFSET = 14;

// Rendered into <body>, outside the exported report, and flipped to stay
// inside the viewport.
export default function Tooltip({ x, y, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x + OFFSET, top: y + OFFSET });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + OFFSET + width > window.innerWidth - 8 ? x - OFFSET - width : x + OFFSET;
    const top = y + OFFSET + height > window.innerHeight - 8 ? y - OFFSET - height : y + OFFSET;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);
  return createPortal(
    <div ref={ref} className="tooltip" role="tooltip" style={pos}>
      {children}
    </div>,
    document.body,
  );
}
