'use client';

// The heatmap card opened over the page. A double click (or the card's
// expand button) lifts it out of the report into this sheet: the calendar
// stays, the period stats give way to the picked day in full, and a scrim
// covers the rest. The report below never moves; its card only hides in
// place. Opening and closing are a container transform: the sheet's outline
// morphs between the card's rect and its own while a snapshot of the report
// card fades out (or back in) and the sheet's content fades the other way.
// Esc, "-", the − button or a click on the scrim close it.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus } from 'lucide-react';
import { HeatGrid } from '@/components/HeatmapCard';
import DayDetail from '@/components/DayDetail';
import { dailyMap } from '@/lib/report';
import { periodLabel } from '@/lib/i18n';

const OPEN = { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
const CLOSE = { duration: 360, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function boxIn(el, frame) {
  const r = el.getBoundingClientRect();
  return { top: r.top - frame.top, left: r.left - frame.left, width: r.width, height: r.height };
}

const geometry = ({ top, left, width, height }) => ({ top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` });

// A clip-path that shows only `box` of an element sized `frame`.
function clipTo(box, frame, radius) {
  const top = Math.max(0, box.top);
  const left = Math.max(0, box.left);
  const right = Math.max(0, frame.width - box.left - box.width);
  const bottom = Math.max(0, frame.height - box.top - box.height);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

// A static copy of the report card for the sheet to grow out of or fold into.
function snapshot(anchor, host, box) {
  const ghost = anchor.cloneNode(true);
  ghost.classList.remove('is-sheeted');
  ghost.classList.add('xghost');
  ghost.inert = true;
  Object.assign(ghost.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px` });
  host.replaceChildren(ghost);
  return ghost;
}

function shadows() {
  const root = getComputedStyle(document.documentElement);
  return { rest: root.getPropertyValue('--shadow').trim(), lift: root.getPropertyValue('--shadow-lift').trim() };
}

export default function ExpandedHeatmap({
  anchorRef,
  closing,
  onCollapse,
  onClosed,
  data,
  period,
  loading,
  today,
  day,
  onPick,
  dayReport,
  dayNav,
  onStep,
  sortBy,
  onSort,
  locale,
  tx,
  agentLabel,
}) {
  const layerRef = useRef(null);
  const backdropRef = useRef(null);
  const cardRef = useRef(null);
  const shellRef = useRef(null);
  const clipRef = useRef(null);
  const innerRef = useRef(null);
  const ghostRef = useRef(null);
  const headRef = useRef(null);
  const motion = useRef({ run: 0, anims: [] });
  const pressedScrim = useRef(false);
  const latest = useRef(null);
  latest.current = { onCollapse, onClosed, onStep, dayNav, closing };
  const titleId = useId();
  const days = useMemo(() => dailyMap(data.daily), [data.daily]);
  // Read while rendering: once this commits the page behind turns inert and
  // the browser drops focus from the control that opened the sheet.
  const [opener] = useState(() => document.activeElement);

  // Cancels the running morph; returns the id of the next one.
  const stop = () => {
    const m = motion.current;
    m.run += 1;
    for (const anim of m.anims) anim.cancel();
    m.anims = [];
    layerRef.current?.classList.remove('is-animating');
    return m.run;
  };
  const play = (run, anims, done) => {
    motion.current.anims = anims;
    layerRef.current.classList.add('is-animating');
    Promise.all(anims.map((anim) => anim.finished)).then(
      () => {
        if (motion.current.run === run) done();
      },
      () => {},
    );
  };
  const radius = () => parseFloat(getComputedStyle(shellRef.current).borderTopLeftRadius) || 0;

  // The page behind neither scrolls nor takes focus (the rest of the page is
  // inert); the scrollbar's width moves to body padding so nothing shifts.
  useEffect(() => {
    const html = document.documentElement;
    const { body } = document;
    const gap = window.innerWidth - html.clientWidth;
    const saved = [html.style.overflow, body.style.paddingRight];
    html.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    cardRef.current.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const current = latest.current;
      if (e.key === 'Escape' || e.key === '-') current.onCollapse();
      else if (current.closing) return;
      else if (e.key === 'ArrowLeft' && current.dayNav.canPrev) current.onStep(-1);
      else if (e.key === 'ArrowRight' && current.dayNav.canNext) current.onStep(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      [html.style.overflow, body.style.paddingRight] = saved;
      if (opener instanceof HTMLElement && opener !== body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  // The month calendar sticks just below the sticky header.
  useLayoutEffect(() => {
    const head = headRef.current;
    const card = cardRef.current;
    const sync = () => card.style.setProperty('--xhead', `${head.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || reducedMotion()) return undefined;
    const run = stop();
    const card = cardRef.current.getBoundingClientRect();
    const clip = clipRef.current.getBoundingClientRect();
    const from = boxIn(anchor, card);
    const round = radius();
    const { rest, lift } = shadows();
    const ghost = snapshot(anchor, ghostRef.current, from);
    const fill = 'both';
    play(
      run,
      [
        backdropRef.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out', fill }),
        shellRef.current.animate(
          [
            { ...geometry(from), boxShadow: rest },
            { top: '0px', left: '0px', width: '100%', height: '100%', boxShadow: lift },
          ],
          { ...OPEN, fill },
        ),
        clipRef.current.animate([{ clipPath: clipTo(boxIn(anchor, clip), clip, round) }, { clipPath: `inset(0px round ${round}px)` }], { ...OPEN, fill }),
        innerRef.current.animate(
          [
            { opacity: 0, transform: 'translateY(12px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 300, delay: 150, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill },
        ),
        ghost.animate([{ transform: 'none' }, { transform: `translate(${-from.left}px, ${-from.top}px)` }], { ...OPEN, fill }),
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: 'ease-out', fill }),
      ],
      () => {
        stop();
        ghostRef.current?.replaceChildren();
      },
    );
    return () => {
      stop();
      ghostRef.current?.replaceChildren();
    };
  }, [anchorRef]);

  // Closing starts from wherever an unfinished opening got to and holds its
  // last frame until the parent unmounts the sheet and shows the card again.
  useLayoutEffect(() => {
    if (!closing) return;
    const done = () => latest.current.onClosed();
    const anchor = anchorRef.current;
    if (reducedMotion()) {
      stop();
      done();
      return;
    }
    if (!anchor) {
      play(stop(), [layerRef.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' })], done);
      return;
    }
    const card = cardRef.current.getBoundingClientRect();
    const clip = clipRef.current.getBoundingClientRect();
    const shell = boxIn(shellRef.current, card);
    const openingGhost = ghostRef.current.firstElementChild;
    const now = {
      shadow: getComputedStyle(shellRef.current).boxShadow,
      clip: getComputedStyle(clipRef.current).clipPath,
      opacity: Number(getComputedStyle(innerRef.current).opacity),
      transform: getComputedStyle(innerRef.current).transform,
      backdrop: getComputedStyle(backdropRef.current).opacity,
      ghost: openingGhost ? Number(getComputedStyle(openingGhost).opacity) : 0,
    };
    const round = radius();
    const { rest } = shadows();
    const run = stop();
    const to = boxIn(anchor, card);
    const ghost = snapshot(anchor, ghostRef.current, to);
    const fill = 'forwards';
    play(
      run,
      [
        backdropRef.current.animate([{ opacity: now.backdrop }, { opacity: 0 }], { duration: CLOSE.duration, easing: 'ease', fill }),
        shellRef.current.animate(
          [
            { ...geometry(shell), boxShadow: now.shadow },
            { ...geometry(to), boxShadow: rest },
          ],
          { ...CLOSE, fill },
        ),
        clipRef.current.animate(
          [{ clipPath: now.clip === 'none' ? `inset(0px round ${round}px)` : now.clip }, { clipPath: clipTo(boxIn(anchor, clip), clip, round) }],
          { ...CLOSE, fill },
        ),
        innerRef.current.animate(
          [
            { opacity: now.opacity, transform: now.transform },
            { opacity: 0, transform: now.transform },
          ],
          { duration: 110, easing: 'ease-out', fill },
        ),
        ghost.animate([{ transform: `translate(${shell.left - to.left}px, ${shell.top - to.top}px)` }, { transform: 'none' }], { ...CLOSE, fill }),
        // The snapshot waits for the sheet's content to clear, if any shows.
        ghost.animate([{ opacity: now.ghost }, { opacity: 1 }], { duration: 200, delay: 130 * now.opacity, easing: 'ease-out', fill: 'both' }),
      ],
      done,
    );
  }, [closing, anchorRef]);

  const onScroll = (e) => headRef.current.toggleAttribute('data-stuck', e.currentTarget.scrollTop > cardRef.current.offsetTop);
  // Only a press that starts and ends on the scrim (not on its scrollbar) closes.
  const onScrimDown = (e) => {
    pressedScrim.current = e.target === e.currentTarget && e.clientX < e.currentTarget.clientWidth;
  };
  const onScrimClick = (e) => {
    if (pressedScrim.current && e.target === e.currentTarget) onCollapse();
  };

  return (
    <div ref={layerRef} className="xsheet">
      <div ref={backdropRef} className="xsheet-backdrop" aria-hidden="true" />
      <div className="xsheet-scroll" onScroll={onScroll} onPointerDown={onScrimDown} onClick={onScrimClick}>
        <div ref={cardRef} className={`xcard is-${period.mode}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div ref={shellRef} className="xcard-shell" />
          <div ref={clipRef} className="xcard-clip">
            <div ref={innerRef} className="xcard-inner">
              <header ref={headRef} className="xcard-head">
                <div className="card-heading">
                  <h2 id={titleId} className="card-title">
                    {tx('cardHeat')}
                  </h2>
                  <p className="card-sub">{tx('subHeat', { period: periodLabel(locale, period) })}</p>
                </div>
                <button type="button" className="icon-btn" onClick={onCollapse} aria-label={tx('sheetClose')} title={tx('sheetClose')}>
                  <Minus size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </header>
              <div className="xcard-body">
                <div className={loading ? 'xheat is-loading' : 'xheat'}>
                  <HeatGrid days={days} period={period} today={today} selected={day} onPick={onPick} hint={tx('sheetHint')} locale={locale} tx={tx} />
                </div>
                {day ? (
                  <DayDetail
                    day={day}
                    report={dayReport}
                    nav={dayNav}
                    today={today}
                    sortBy={sortBy}
                    onSort={onSort}
                    onStep={onStep}
                    locale={locale}
                    tx={tx}
                    agentLabel={agentLabel}
                  />
                ) : null}
              </div>
            </div>
          </div>
          <div ref={ghostRef} className="xcard-ghost" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
