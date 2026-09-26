// Packs the day deck's cards into pages no taller than `maxHeight`.
// Greedy in display order: a page takes cards until the next one would
// overflow; a card that alone reaches `maxHeight` gets its own page flagged
// `scroll` (the card scrolls internally, the page never exceeds the bound).
// Returns { pages: number[][], scroll: boolean[] } — card indexes per page.
export function packCards(heights, maxHeight, gap = 0) {
  if (!heights.length) return { pages: [], scroll: [] };
  if (!(maxHeight > 0)) return { pages: [heights.map((_, i) => i)], scroll: [false] };
  const pages = [];
  const scroll = [];
  let current = [];
  let used = 0;
  for (let i = 0; i < heights.length; i += 1) {
    const height = Math.max(0, heights[i] || 0);
    if (height >= maxHeight) {
      if (current.length) {
        pages.push(current);
        scroll.push(false);
      }
      pages.push([i]);
      scroll.push(true);
      current = [];
      used = 0;
      continue;
    }
    const need = current.length ? used + gap + height : height;
    if (need <= maxHeight) {
      current.push(i);
      used = need;
    } else {
      pages.push(current);
      scroll.push(false);
      current = [i];
      used = height;
    }
  }
  if (current.length) {
    pages.push(current);
    scroll.push(false);
  }
  return { pages, scroll };
}
