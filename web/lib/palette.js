// Shared categorical palette for agent/model series. Hex values match
// --color-cat-1 … --color-cat-5 in globals.css / design-spec.md (v4, black bg).
// Rank encoding, not identity: callers pass the entity's position in a
// descending volume sort, so the leader is brand blue and the rest step down
// a neutral ramp — one hue, no rainbow.
export const PALETTE = ['#3291ff', '#9a9a9a', '#6e6e6e', '#4c4c4c', '#2e2e2e'];

export const colorAt = (i) => PALETTE[i % PALETTE.length];
