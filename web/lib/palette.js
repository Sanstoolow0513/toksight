// Shared categorical palette for agent/model series. Hex values match
// --color-cat-1 … --color-cat-5 in globals.css / design-spec.md (v6, phosphor).
// Rank encoding, not identity: callers pass the entity's position in a
// descending volume sort, so the leader is brand lime and the rest step down
// a slate-gray ramp — one hue, no rainbow.
export const PALETTE = ['#c9f24b', '#9a9ab2', '#6a6a84', '#4a4a62', '#2e2e42'];

export const colorAt = (i) => PALETTE[i % PALETTE.length];
