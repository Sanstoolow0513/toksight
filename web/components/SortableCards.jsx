'use client';

// Vertical drag-to-reorder list. Pointer events (mouse + touch + pen) on a
// per-card handle; neighbours slide aside while dragging, the page scrolls
// near the viewport edges, and the drop settles with a FLIP animation.
// Arrow keys on the handle move a card one slot for keyboard users.

import { useLayoutEffect, useRef, useState } from 'react';

const EDGE = 80;
const MAX_SCROLL = 16;

function move(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function SortableCards({ order, onReorder, handleLabel, children }) {
  const nodes = useRef(new Map());
  const session = useRef(null);
  const settle = useRef(null);
  const [drag, setDrag] = useState(null);

  const snapshot = () => new Map([...nodes.current].map(([id, el]) => [id, el.getBoundingClientRect().top]));

  useLayoutEffect(() => {
    const pending = settle.current;
    if (!pending) return;
    settle.current = null;
    for (const [id, el] of nodes.current) {
      const before = pending.tops.get(id);
      if (before == null) continue;
      const delta = before - el.getBoundingClientRect().top;
      if (Math.abs(delta) >= 1 && !reducedMotion()) {
        el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
    if (pending.focus) nodes.current.get(pending.focus)?.querySelector('[data-drag-handle]')?.focus();
  });

  function finish(next, focus) {
    settle.current = { tops: snapshot(), focus };
    setDrag(null);
    if (next) onReorder(next);
  }

  function update() {
    const s = session.current;
    if (!s) return;
    const dy = s.clientY + window.scrollY - s.startY;
    const self = s.rects[s.from];
    const center = self.top + self.height / 2 + dy;
    let to = 0;
    s.rects.forEach((r, i) => {
      if (i !== s.from && center > r.top + r.height / 2) to += 1;
    });
    s.to = to;
    setDrag({ id: s.id, from: s.from, to, dy, size: self.height + s.gap });
  }

  function tick() {
    const s = session.current;
    if (!s) return;
    const vh = window.innerHeight;
    let speed = 0;
    if (s.clientY < EDGE) speed = -MAX_SCROLL * Math.min(1, (EDGE - s.clientY) / EDGE);
    else if (s.clientY > vh - EDGE) speed = MAX_SCROLL * Math.min(1, (s.clientY - (vh - EDGE)) / EDGE);
    if (speed) {
      window.scrollBy(0, speed);
      update();
    }
    s.raf = requestAnimationFrame(tick);
  }

  function onPointerDown(id, e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = order.map((key) => {
      const r = nodes.current.get(key).getBoundingClientRect();
      return { top: r.top + window.scrollY, height: r.height };
    });
    const gap = rects.length > 1 ? rects[1].top - (rects[0].top + rects[0].height) : 0;
    const from = order.indexOf(id);
    session.current = { id, from, to: from, rects, gap, pointerId: e.pointerId, startY: e.clientY + window.scrollY, clientY: e.clientY, raf: 0 };
    session.current.raf = requestAnimationFrame(tick);
    document.body.classList.add('is-dragging');
    update();
  }

  function onPointerMove(e) {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    s.clientY = e.clientY;
    update();
  }

  function onPointerEnd(e) {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    cancelAnimationFrame(s.raf);
    session.current = null;
    document.body.classList.remove('is-dragging');
    finish(s.to !== s.from ? move(order, s.from, s.to) : null);
  }

  function onKeyDown(id, e) {
    const from = order.indexOf(id);
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : null;
    if (to == null) return;
    e.preventDefault();
    if (to >= 0 && to < order.length) finish(move(order, from, to), id);
  }

  function offset(id, index) {
    if (!drag) return undefined;
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)` };
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: `translateY(${-drag.size}px)` };
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return { transform: `translateY(${drag.size}px)` };
    return { transform: 'translateY(0)' };
  }

  return (
    <div className={drag ? 'sortable is-sorting' : 'sortable'}>
      {order.map((id, index) => (
        <div
          key={id}
          className={drag?.id === id ? 'sortable-item is-lifted' : 'sortable-item'}
          style={offset(id, index)}
          ref={(el) => {
            if (el) nodes.current.set(id, el);
            else nodes.current.delete(id);
          }}
        >
          {children(id, {
            handleProps: {
              'data-drag-handle': '',
              'aria-label': handleLabel,
              title: handleLabel,
              onPointerDown: (e) => onPointerDown(id, e),
              onPointerMove,
              onPointerUp: onPointerEnd,
              onPointerCancel: onPointerEnd,
              onKeyDown: (e) => onKeyDown(id, e),
            },
          })}
        </div>
      ))}
    </div>
  );
}
