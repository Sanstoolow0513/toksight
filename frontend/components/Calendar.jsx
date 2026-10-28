'use client';

// The continuous calendar column: every month from the first record to today,
// Monday-start weeks with an ISO-week cell, two zoom levels with a FLIP
// transition, and range / multi-day selection by pointer and keyboard.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton, TipRow, TipTitle, Tooltip, cx, useTip } from '@/components/ui';
import { daysInMonth, isoWeek, monthsBetween, rangeKeys, shiftDay, weekKeys, weekLabelParts } from '@/lib/period';
import { cacheHitRate, heatLevel, heatMax, sumDays } from '@/lib/report';
import { fmtCost, fmtCostShort, fmtInt, fmtPct, fmtTokens, fmtTokensShort } from '@/lib/format';
import { WEEKDAYS, dayLabel, periodLabel, weekdayLabel } from '@/lib/i18n';
import { CALENDAR_ZOOMS } from '@/lib/prefs';

const pad = (n) => String(n).padStart(2, '0');
const DURATION = 360;
const EASING = 'cubic-bezier(.2, .7, .1, 1)';
const EDGE = 48;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const monthTitle = (locale, year, month) => locale === 'en' ? periodLabel(locale, { mode: 'month', year, month }) : `${year}年${month}月`;

function weekText(tx, key, blockYear) {
  const { week, prefix } = weekLabelParts(key, blockYear);
  return prefix ? tx('calWeekLabelYear', { yy: prefix, n: week }) : tx('calWeekLabel', { n: week });
}

// Rows of seven day slots (null outside the month) for one month.
function monthWeeks(year, month) {
  const first = `${year}-${pad(month)}-01`;
  const total = daysInMonth(year, month);
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const slots = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => shiftDay(first, i))];
  while (slots.length % 7) slots.push(null);
  return Array.from({ length: slots.length / 7 }, (_, i) => slots.slice(i * 7, i * 7 + 7));
}

// One month block. Memoized: a block re-renders only when its own selection,
// focus or data change, not on hover.
const MonthBlock = memo(function MonthBlock({ year, month, days, max, today, start, selectedKeys, multi, weekSelected, focusKey, locale, tx }) {
  const weeks = useMemo(() => monthWeeks(year, month), [year, month]);
  const selected = useMemo(() => new Set(selectedKeys ? selectedKeys.split(',') : []), [selectedKeys]);
  const monthKeys = weeks.flat().filter(Boolean);
  const total = sumDays(days, monthKeys);
  const title = monthTitle(locale, year, month);
  return <div className="mblock" data-month={`${year}-${pad(month)}`}>
    <div className="mhead"><b>{title}</b><span>{total.totalTokens > 0 ? `${fmtTokensShort(total.totalTokens)} · ${fmtCostShort(total.costUsd)}` : tx('calMonthEmpty')}</span></div>
    <div className="cgrid" role="grid" aria-label={tx('calGridAria', { month: title })}>
      {weeks.map((week) => {
        const anyKey = week.find(Boolean);
        const keys = weekKeys(anyKey);
        const monday = keys[0];
        const live = keys.filter((key) => key <= today);
        const sums = sumDays(days, live);
        const future = monday > today;
        const { year: isoYear, week: isoNumber } = isoWeek(monday);
        const label = weekText(tx, monday, year);
        const value = sums.totalTokens > 0 ? `${fmtTokensShort(sums.totalTokens)}` : null;
        return <div role="row" className="crow" key={monday}>
          {week.map((key, i) => {
            if (!key) return <div role="gridcell" className="day is-blank" key={`b${i}`} />;
            const row = days.get(key);
            const tokens = row?.totalTokens || 0;
            const isFuture = key > today, disabled = isFuture || key < start;
            const on = selected.has(key);
            return <div role="gridcell" className="cell" key={key}>
              <button type="button" data-day={key} data-tip={`d:${key}`} tabIndex={key === focusKey ? 0 : -1}
                className={cx('day', `lv-${isFuture ? 0 : heatLevel(tokens, max)}`, isFuture && 'is-future', key === today && 'is-today', on && (multi ? 'is-msel' : 'is-sel'))}
                aria-disabled={disabled || undefined} aria-selected={on} aria-current={key === today ? 'date' : undefined}
                aria-label={`${dayLabel(locale, key, true)} ${weekdayLabel(locale, key)} · ${isFuture ? tx('tipFuture') : tokens > 0 ? `${fmtTokens(tokens)} tokens · ${fmtCost(row.costUsd)}` : tx('tipIdle')}`}>
                <span className="d">{Number(key.slice(8))}</span>
                {!isFuture ? tokens > 0 ? <><span className="t">{fmtTokensShort(tokens)}</span><span className="c">{fmtCostShort(row.costUsd)}</span></> : <span className="c">—</span> : null}
              </button>
            </div>;
          })}
          <div role="gridcell" className="cell">
            <button type="button" data-week={monday} data-tip={`w:${monday}`} tabIndex={`w:${monday}:${year}-${pad(month)}` === focusKey ? 0 : -1}
              className={cx('wk', future && 'is-future', weekSelected === monday && 'is-wsel')} aria-disabled={future || undefined}
              aria-label={tx('calWeekAria', { year: isoYear, n: isoNumber, tokens: fmtTokens(sums.totalTokens), cost: fmtCost(sums.costUsd) })}>
              <span className="d">{label}</span>
              {future ? null : value ? <><span className="t">{value}</span><span className="c">{fmtCostShort(sums.costUsd)}</span></> : <span className="c">—</span>}
            </button>
          </div>
        </div>;
      })}
    </div>
  </div>;
});

function DayTip({ date, row, today, locale, tx }) {
  return <>
    <TipTitle>{dayLabel(locale, date, true)} · {weekdayLabel(locale, date)}</TipTitle>
    {date > today ? <div className="tip-muted">{tx('tipFuture')}</div>
      : !row?.requests ? <div className="tip-muted">{tx('tipIdle')}</div>
        : <>
          <TipRow label={tx('tipTokens')}>{fmtTokens(row.totalTokens)}</TipRow>
          <TipRow label={tx('tipCost')}>{fmtCost(row.costUsd)}</TipRow>
          <TipRow label={tx('tipRequests')}>{fmtInt(row.requests)} / {fmtInt(row.sessions)}</TipRow>
          <TipRow label={tx('tipCache')}>{fmtPct(cacheHitRate(row))}</TipRow>
        </>}
  </>;
}

function WeekTip({ monday, days, today, locale, tx }) {
  const keys = weekKeys(monday), { year, week } = isoWeek(monday);
  const sums = sumDays(days, keys.filter((key) => key <= today));
  return <>
    <TipTitle>{tx('calWeekTitle', { year, n: week, from: dayLabel(locale, keys[0]), to: dayLabel(locale, keys[6]) })}</TipTitle>
    {monday > today ? <div className="tip-muted">{tx('tipFuture')}</div>
      : !sums.requests ? <div className="tip-muted">{tx('tipIdle')}</div>
        : <>
          <TipRow label={tx('tipTokens')}>{fmtTokens(sums.totalTokens)}</TipRow>
          <TipRow label={tx('tipCost')}>{fmtCost(sums.costUsd)}</TipRow>
        </>}
  </>;
}

export default function Calendar({ days, today, start, selected, anchor, zoom, onZoom, onSelect, locale, tx }) {
  const scroller = useRef(null);
  const column = useRef(null);
  const flip = useRef(null);
  const animating = useRef(false);
  const drag = useRef(null);
  const focusMoved = useRef(false);
  const { tip, hide, atElement, track } = useTip();
  const [focusKey, setFocusKey] = useState(() => selected.at(-1) ?? today);
  const [dragging, setDragging] = useState(false);
  const lastDay = `${today.slice(0, 8)}${pad(daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))))}`;
  const months = useMemo(() => monthsBetween(start, today), [start, today]);
  const max = useMemo(() => heatMax(days), [days]);
  const selectable = useCallback((key) => key >= start && key <= today, [start, today]);
  const multi = selected.length > 1;
  // A selection that is exactly one week's selectable days marks that week.
  const weekSelected = useMemo(() => {
    if (!multi) return null;
    const keys = weekKeys(selected[0]).filter(selectable);
    return keys.length === selected.length && keys.every((key, i) => key === selected[i]) ? keys[0] && weekKeys(keys[0])[0] : null;
  }, [multi, selected, selectable]);
  const byMonth = useMemo(() => {
    const map = new Map();
    for (const key of selected) {
      const month = key.slice(0, 7);
      map.set(month, map.has(month) ? `${map.get(month)},${key}` : key);
    }
    return map;
  }, [selected]);
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  // Focus keys: a day key, or `w:<monday>:<YYYY-MM>` for a week cell (a
  // week spanning two months has a cell in each month block).
  const elementFor = (key) => scroller.current?.querySelector(key.startsWith('w:')
    ? `.mblock[data-month="${key.slice(13)}"] [data-week="${key.slice(2, 12)}"]` : `[data-day="${key}"]`);
  const keyOf = (el) => {
    if (el?.dataset?.day) return el.dataset.day;
    if (el?.dataset?.week) return `w:${el.dataset.week}:${el.closest('.mblock').dataset.month}`;
    return null;
  };
  // Every week row in display order, for moving between week cells.
  const rows = useMemo(() => months.flatMap(({ year, month }) => monthWeeks(year, month)
    .map((week) => `w:${weekKeys(week.find(Boolean))[0]}:${year}-${pad(month)}`)), [months]);

  // ---- zoom (FLIP) ----
  const visibleAnchor = () => {
    const box = scroller.current.getBoundingClientRect(), mid = (box.top + box.bottom) / 2;
    for (const key of selected) {
      const r = elementFor(key)?.getBoundingClientRect();
      if (r && r.bottom > box.top && r.top < box.bottom) return elementFor(key);
    }
    let best = null, distance = Infinity;
    for (const el of scroller.current.querySelectorAll('[data-day]')) {
      const r = el.getBoundingClientRect();
      if (r.bottom < box.top || r.top > box.bottom) continue;
      const d = Math.abs(r.top - mid);
      if (d < distance) { distance = d; best = el; }
    }
    return best ?? elementFor(today);
  };
  const setZoom = (next, anchorEl = null) => {
    if (next === zoom || animating.current || !CALENDAR_ZOOMS.includes(next) || !scroller.current) return;
    const anchorNode = anchorEl ?? visibleAnchor();
    const view = scroller.current.getBoundingClientRect();
    const first = new Map();
    for (const node of scroller.current.querySelectorAll('.day, .wk, .mhead')) {
      const r = node.getBoundingClientRect();
      if (r.bottom > view.top - 300 && r.top < view.bottom + 300) first.set(node, r);
    }
    flip.current = { first, anchor: anchorNode, top: anchorNode?.getBoundingClientRect().top };
    hide();
    onZoom(next);
  };
  const step = (dir, anchorEl) => setZoom(CALENDAR_ZOOMS[Math.max(0, Math.min(CALENDAR_ZOOMS.length - 1, CALENDAR_ZOOMS.indexOf(zoom) + dir))], anchorEl);
  useLayoutEffect(() => {
    const pending = flip.current;
    flip.current = null;
    const sc = scroller.current;
    if (!pending || !sc) return;
    if (pending.anchor?.isConnected) sc.scrollTop += pending.anchor.getBoundingClientRect().top - pending.top;
    if (reducedMotion()) return;
    animating.current = true;
    column.current.classList.add('zooming');
    const view = sc.getBoundingClientRect();
    for (const node of sc.querySelectorAll('.day, .wk, .mhead')) {
      const r = node.getBoundingClientRect();
      if (!r.width || r.bottom < view.top - 50 || r.top > view.bottom + 50) continue;
      const before = pending.first.get(node);
      if (!before || !before.width) { node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: EASING }); continue; }
      const head = node.classList.contains('mhead');
      const sx = head ? 1 : before.width / r.width, sy = head ? 1 : before.height / r.height;
      node.animate([{ transformOrigin: '0 0', transform: `translate(${before.left - r.left}px, ${before.top - r.top}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' }], { duration: DURATION, easing: EASING });
    }
    const timer = setTimeout(() => { column.current?.classList.remove('zooming'); animating.current = false; }, DURATION);
    return () => { clearTimeout(timer); column.current?.classList.remove('zooming'); animating.current = false; };
  }, [zoom]);

  // Ctrl/⌘ + wheel and two-finger pinch change the level; plain wheel scrolls.
  const zoomRef = useRef(step);
  zoomRef.current = step;
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return undefined;
    let wheel = 0, pinch = 0;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      wheel += event.deltaY;
      if (Math.abs(wheel) < 40) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-day]');
      zoomRef.current(wheel < 0 ? 1 : -1, target);
      wheel = 0;
    };
    const onTouch = (event) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = event.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (!pinch) { pinch = d; return; }
      if (d / pinch > 1.25) { zoomRef.current(1); pinch = d; } else if (d / pinch < 0.8) { zoomRef.current(-1); pinch = d; }
    };
    const endTouch = () => { pinch = 0; };
    sc.addEventListener('wheel', onWheel, { passive: false });
    sc.addEventListener('touchmove', onTouch, { passive: false });
    sc.addEventListener('touchend', endTouch);
    return () => { sc.removeEventListener('wheel', onWheel); sc.removeEventListener('touchmove', onTouch); sc.removeEventListener('touchend', endTouch); };
  }, []);

  // ---- scrolling ----
  const scrollToKey = useCallback((key, smooth) => {
    const sc = scroller.current, el = elementFor(key);
    if (!sc || !el) return;
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTo({ top: Math.max(0, top - (zoom === 'large' ? 60 : sc.clientHeight / 2)), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }, [zoom]);
  // Open at the current month (the end of the list), or at an older selection.
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const last = selected.at(-1);
    if (last && last.slice(0, 7) !== today.slice(0, 7)) scrollToKey(last, false);
    else sc.scrollTop = sc.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keepVisible = (el) => {
    const sc = scroller.current;
    if (!sc || !el) return;
    const box = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
    const headroom = 40;
    if (r.top < box.top + headroom) sc.scrollTop -= box.top + headroom - r.top;
    else if (r.bottom > box.bottom) sc.scrollTop += r.bottom - box.bottom + 8;
  };
  useEffect(() => {
    if (!focusMoved.current) return;
    focusMoved.current = false;
    const el = elementFor(focusKey);
    if (el) { el.focus({ preventScroll: true }); keepVisible(el); atElement(el.dataset.tip, el); }
  }, [focusKey]);
  const moveFocus = (key) => { focusMoved.current = true; setFocusKey(key); if (key === focusKey) { focusMoved.current = false; elementFor(key)?.focus(); } };

  // ---- selection ----
  const selectOnly = (key) => onSelect([key], key);
  const toToday = () => { selectOnly(today); setFocusKey(today); requestAnimationFrame(() => scrollToKey(today, true)); };
  const weekSelection = (monday) => weekKeys(monday).filter(selectable);
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const week = event.target.closest?.('[data-week]');
    if (week) {
      const keys = weekSelection(week.dataset.week);
      if (!keys.length) return;
      event.preventDefault();
      onSelect(event.ctrlKey || event.metaKey ? [...selected, ...keys] : keys, keys[0]);
      setFocusKey(keyOf(week));
      return;
    }
    const key = event.target.closest?.('[data-day]')?.dataset.day;
    if (!key || !selectable(key)) return;
    event.preventDefault();
    setFocusKey(key);
    if (event.shiftKey && anchor) { onSelect(rangeKeys(anchor, key)); return; }
    if (event.ctrlKey || event.metaKey) {
      onSelect(selected.includes(key) ? (selected.length > 1 ? selected.filter((k) => k !== key) : selected) : [...selected, key], key);
      return;
    }
    selectOnly(key);
    drag.current = { start: key, last: key, pointer: null, frame: 0 };
    setDragging(true);
    hide();
    scroller.current.setPointerCapture?.(event.pointerId);
  };
  const dragTo = () => {
    const state = drag.current;
    if (!state?.pointer) return;
    // Near the edges the sticky month title or a gap can sit under the
    // pointer; probe toward the middle of the list for the nearest day.
    const box = scroller.current.getBoundingClientRect();
    const y = Math.max(box.top + 1, Math.min(box.bottom - 1, state.pointer.y));
    const toward = y < (box.top + box.bottom) / 2 ? 1 : -1;
    let key = null;
    for (let offset = 0; offset <= 96 && !key; offset += 8) {
      key = document.elementFromPoint(state.pointer.x, y + toward * offset)?.closest?.('[data-day]')?.dataset.day ?? null;
    }
    if (key && key !== state.last && selectable(key)) { state.last = key; onSelect(rangeKeys(state.start, key)); }
  };
  const autoScroll = () => {
    const state = drag.current;
    if (!state) return;
    state.frame = 0;
    const box = scroller.current.getBoundingClientRect(), y = state.pointer.y;
    const speed = y < box.top + EDGE ? -(box.top + EDGE - y) / 3 : y > box.bottom - EDGE ? (y - (box.bottom - EDGE)) / 3 : 0;
    if (speed) { scroller.current.scrollTop += speed; dragTo(); state.frame = requestAnimationFrame(autoScroll); }
  };
  const onPointerMove = (event) => {
    const state = drag.current;
    if (!state) return;
    state.pointer = { x: event.clientX, y: event.clientY };
    dragTo();
    if (!state.frame) state.frame = requestAnimationFrame(autoScroll);
  };
  const endDrag = () => {
    if (drag.current?.frame) cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setDragging(false);
  };
  // Keyboard and assistive-technology activation arrive as clicks (detail 0).
  const onClick = (event) => {
    if (event.detail !== 0) return;
    const week = event.target.closest?.('[data-week]');
    if (week) { const keys = weekSelection(week.dataset.week); if (keys.length) onSelect(keys, keys[0]); return; }
    const key = event.target.closest?.('[data-day]')?.dataset.day;
    if (key && selectable(key)) selectOnly(key);
  };

  const onKeyDown = (event) => {
    const key = event.key;
    if (key === '+' || key === '=') { event.preventDefault(); step(1, document.activeElement?.closest?.('[data-day]')); return; }
    if (key === '-') { event.preventDefault(); step(-1, document.activeElement?.closest?.('[data-day]')); return; }
    if (key === 'Escape') { event.preventDefault(); selectOnly(today); moveFocus(today); return; }
    const current = keyOf(event.target) ?? focusKey;
    const onWeek = current.startsWith('w:');
    const monday = onWeek ? current.slice(2, 12) : null, rowMonth = onWeek ? current.slice(13) : null;
    // A week cell stands for the last day of its row inside its month.
    const day = onWeek ? weekKeys(monday).filter((k) => k.slice(0, 7) === rowMonth).at(-1) : current;
    const ctrl = event.ctrlKey || event.metaKey;
    if (onWeek && (key === 'Enter' || key === ' ')) {
      event.preventDefault();
      const keys = weekSelection(monday);
      if (keys.length) onSelect(ctrl ? [...selected, ...keys] : keys, keys[0]);
      return;
    }
    if ((key === 'Enter' || key === ' ') && !ctrl && !onWeek) {
      event.preventDefault();
      if (selectable(day)) selectOnly(day);
      return;
    }
    if (key === ' ' && ctrl && !onWeek) {
      event.preventDefault();
      if (selectable(day)) onSelect(selected.includes(day) ? (selected.length > 1 ? selected.filter((k) => k !== day) : selected) : [...selected, day], day);
      return;
    }
    let next = null;
    const weekday = weekKeys(day).indexOf(day);
    const rowEnd = weekday === 6 || shiftDay(day, 1).slice(0, 7) !== day.slice(0, 7);
    if (key === 'ArrowLeft') next = onWeek ? day : shiftDay(day, -1);
    else if (key === 'ArrowRight') next = onWeek ? null : rowEnd && zoom === 'large' ? `w:${weekKeys(day)[0]}:${day.slice(0, 7)}` : shiftDay(day, 1);
    else if (key === 'ArrowUp') next = onWeek ? rows[rows.indexOf(current) - 1] ?? null : shiftDay(day, -7);
    else if (key === 'ArrowDown') next = onWeek ? rows[rows.indexOf(current) + 1] ?? null : shiftDay(day, 7);
    else if (key === 'Home') next = shiftDay(day, -weekday);
    else if (key === 'End') next = shiftDay(day, 6 - weekday);
    else if (key === 'PageUp' || key === 'PageDown') {
      let [y, m] = day.split('-').map(Number);
      m += key === 'PageUp' ? -1 : 1;
      if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
      next = `${y}-${pad(m)}-${pad(Math.min(Number(day.slice(8)), daysInMonth(y, m)))}`;
    }
    if (!next) return;
    event.preventDefault();
    if (!next.startsWith('w:') && (next < `${start.slice(0, 7)}-01` || next > lastDay)) return;
    moveFocus(next);
    if (event.shiftKey && !next.startsWith('w:') && selectable(next)) onSelect(rangeKeys(anchor ?? day, next));
  };
  const onFocus = (event) => {
    const focused = keyOf(event.target);
    if (focused && focused !== focusKey) setFocusKey(focused);
    const el = event.target.closest?.('[data-tip]');
    if (el && event.target.matches(':focus-visible')) atElement(el.dataset.tip, el);
  };

  const tipKey = tip?.key ?? null;
  const tracked = track('tip');
  return <section ref={column} className="calcol plate" data-zoom={zoom}>
    <div className="cal-head">
      <span className="label">{tx('calAllAgents')}</span>
      <div className="cal-tools no-export">
        <IconButton label={tx('calZoomOut')} disabled={zoom === 'compact'} onClick={() => step(-1)}><ZoomOut /></IconButton>
        <div className="zoom-level" aria-live="polite"><span>{tx(zoom === 'large' ? 'calZoomLarge' : 'calZoomCompact')}</span>
          <span className="zoom-dots" aria-hidden="true">{CALENDAR_ZOOMS.map((level) => <i key={level} className={level === zoom ? 'is-on' : undefined} />)}</span></div>
        <IconButton label={tx('calZoomIn')} disabled={zoom === 'large'} onClick={() => step(1)}><ZoomIn /></IconButton>
        <span className="cal-divider" aria-hidden="true" />
        <IconButton label={tx('calToday')} onClick={toToday}><CalendarDays /></IconButton>
      </div>
    </div>
    <div className="dowbar" aria-hidden="true">{WEEKDAYS[locale].map((name) => <span key={name}>{name}</span>)}<span className="wkh">{tx('calWeekCol')}</span></div>
    <div ref={scroller} className={cx('cal-scroller', dragging && 'is-dragging')} data-export-clip=".mblock"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onClick={onClick} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={hide}
      onMouseMove={dragging ? undefined : tracked.onMouseMove} onMouseLeave={tracked.onMouseLeave}>
      <div className="months">
        {months.map(({ year, month }) => {
          const prefix = `${year}-${pad(month)}`;
          return <MonthBlock key={prefix} year={year} month={month} days={days} max={max} today={today} start={start}
            selectedKeys={byMonth.get(prefix) ?? ''} multi={multi} weekSelected={weekSelected} locale={locale} tx={tx}
            focusKey={(focusKey.startsWith('w:') ? focusKey.slice(13) : focusKey.slice(0, 7)) === prefix ? focusKey : null} />;
        })}
      </div>
    </div>
    <div className="cal-foot">
      <span className="no-export">{tx('calHint', { mod })}</span>
      <span className="heat-ramp">{tx('heatLess')}{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`lv-${level}`} />)}{tx('heatMore')}</span>
    </div>
    {tipKey && !dragging ? <Tooltip x={tip.x} y={tip.y}>
      {tipKey.startsWith('w:') ? <WeekTip monday={tipKey.slice(2)} days={days} today={today} locale={locale} tx={tx} />
        : <DayTip date={tipKey.slice(2)} row={days.get(tipKey.slice(2))} today={today} locale={locale} tx={tx} />}
    </Tooltip> : null}
  </section>;
}
