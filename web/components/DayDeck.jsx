'use client';

// The day column's card deck: cards pack greedily into pages no taller than
// one visible screenful of the sheet (the parent card bounds the height).
// A card that alone fills a page gets that page to itself and scrolls
// internally. Turning a page overlaps like a deck — the old cards lift and
// fade while the new ones rise into place, staggered. ‹ ›, the dots or
// ↑ / ↓ turn pages; the page index survives day switches while it exists.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { packCards } from '@/lib/deck';

const GAP = 16;
// Below the deck box: the sheet card's bottom padding plus the pager row.
const RESERVE = 74;
const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true };

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function DeckCard({ title, note, children }) {
  return (
    <section className="xdeck-card">
      {title ? (
        <header className="day-section-head">
          <h4>{title}</h4>
          {note ? <span>{note}</span> : null}
        </header>
      ) : null}
      <div className="xdeck-card-body">{children}</div>
    </section>
  );
}

const withMargin = (el) => (el ? el.offsetHeight + (parseFloat(getComputedStyle(el).marginBottom) || 0) : 0);

export default function DayDeck({ cards, tx }) {
  const boxRef = useRef(null);
  const measureRef = useRef(null);
  const [heights, setHeights] = useState([]);
  const [maxHeight, setMaxHeight] = useState(0);
  const [page, setPage] = useState(0);
  const [leaving, setLeaving] = useState(null);

  // Every card renders once in a hidden column at the deck's width so its
  // natural height stays measurable; the observer catches content changes
  // (agent expansion, sorting, another day, locale, a narrower column).
  useLayoutEffect(() => {
    const host = measureRef.current;
    if (!host) return undefined;
    const read = () =>
      setHeights((prev) => {
        const next = [...host.children].map((el) => el.offsetHeight);
        return prev.length === next.length && prev.every((h, i) => h === next[i]) ? prev : next;
      });
    read();
    const observer = new ResizeObserver(read);
    for (const el of host.children) observer.observe(el);
    return () => observer.disconnect();
  }, [cards]);

  // One screenful below the sheet's sticky header and the day head, minus
  // the bottom padding and pager — independent of scroll position, so the
  // same bound fits the two-column month layout and the stacked layouts.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const scroller = box?.closest('.xsheet-scroll');
    const card = box?.closest('.xcard');
    if (!box || !scroller || !card) return undefined;
    const read = () => {
      const gap = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const head = card.querySelector('.xcard-head');
      const dayHead = box.closest('.xday')?.querySelector('.xday-head');
      const available = Math.floor(scroller.clientHeight - 2 * gap - withMargin(head) - withMargin(dayHead) - RESERVE);
      setMaxHeight((prev) => (prev === available ? prev : available));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(scroller);
    window.addEventListener('resize', read);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', read);
    };
  }, [cards]);

  const { pages, scroll } = useMemo(() => packCards(heights, maxHeight, GAP), [heights, maxHeight]);
  const pageCount = pages.length;

  // Repacking may drop pages (a shorter day, a wider viewport); clamp.
  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const goTo = (next) => {
    if (next === page || next < 0 || next >= pageCount) return;
    if (reducedMotion()) setPage(next);
    else {
      setLeaving(page);
      setPage(next);
    }
  };

  // The deck turn: outgoing cards lift away, incoming cards rise staggered.
  useLayoutEffect(() => {
    if (leaving == null) return undefined;
    const box = boxRef.current;
    if (!box) {
      setLeaving(null);
      return undefined;
    }
    const anims = [];
    box.querySelectorAll('.xdeck-page.is-leaving .xdeck-card').forEach((el, i) =>
      anims.push(
        el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px) scale(0.985)' }], {
          duration: 180,
          delay: i * 24,
          easing: 'cubic-bezier(0.4, 0, 1, 1)',
          fill: 'both',
        }),
      ),
    );
    box.querySelectorAll('.xdeck-page.is-active .xdeck-card').forEach((el, i) =>
      anims.push(
        el.animate([{ opacity: 0, transform: 'translateY(18px) scale(0.98)' }, { opacity: 1, transform: 'none' }], {
          duration: 260,
          delay: 80 + i * 30,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          fill: 'both',
        }),
      ),
    );
    let cancelled = false;
    Promise.all(anims.map((anim) => anim.finished)).then(
      () => {
        if (!cancelled) setLeaving(null);
      },
      () => {},
    );
    return () => {
      cancelled = true;
      for (const anim of anims) anim.cancel();
    };
  }, [leaving, page]);

  // ↑ / ↓ turn pages while the sheet owns the keyboard (← / → step days).
  useEffect(() => {
    if (pageCount < 2) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowUp') goTo(page - 1);
      else if (e.key === 'ArrowDown') goTo(page + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="xdeck-wrap">
      <div ref={boxRef} className="xdeck" style={maxHeight > 0 ? { height: `${maxHeight}px` } : undefined}>
        {pages.map((cardIds, pi) => {
          if (pi !== page && pi !== leaving) return null;
          const active = pi === page;
          return (
            <div
              key={pi}
              className={`xdeck-page${active ? ' is-active' : ' is-leaving'}${scroll[pi] ? ' is-scroll' : ''}`}
              aria-hidden={!active}
            >
              {cardIds.map((ci) => {
                const card = cards[ci];
                return (
                  <DeckCard key={card.id} title={card.title} note={card.note}>
                    {card.node}
                  </DeckCard>
                );
              })}
            </div>
          );
        })}
        <div ref={measureRef} className="xdeck-measure" aria-hidden="true">
          {cards.map((card) => (
            <DeckCard key={card.id} title={card.title} note={card.note}>
              {card.node}
            </DeckCard>
          ))}
        </div>
      </div>
      {pageCount > 1 ? (
        <div className="xdeck-pager">
          <button type="button" className="icon-btn" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label={tx('deckPrev')} title={tx('deckPrev')}>
            <ChevronLeft {...icon} />
          </button>
          {pages.map((_, pi) => (
            <button
              key={pi}
              type="button"
              className={pi === page ? 'xdeck-dot is-active' : 'xdeck-dot'}
              onClick={() => goTo(pi)}
              aria-label={tx('deckPage', { n: pi + 1 })}
              aria-current={pi === page || undefined}
            />
          ))}
          <button
            type="button"
            className="icon-btn"
            onClick={() => goTo(page + 1)}
            disabled={page >= pageCount - 1}
            aria-label={tx('deckNext')}
            title={tx('deckNext')}
          >
            <ChevronRight {...icon} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
