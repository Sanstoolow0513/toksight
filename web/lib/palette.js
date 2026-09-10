// Shared categorical palette for agent/model series. Hex values match
// --color-cat-1 … --color-cat-5 in globals.css / design-spec.md (v7 §2,
// Editorial Paper); test/palette.test.js pins the two copies to each other.
// Rank encoding, not identity: callers pass the entity's position in a
// descending volume sort, so the leader is ink and the rest step down a
// warm-gray ramp — one hue, no rainbow.
export const PALETTE = ['#1a1917', '#6f6a63', '#a8a39a', '#d6d3cc', '#eae8e2'];

export const colorAt = (i) => PALETTE[i % PALETTE.length];
