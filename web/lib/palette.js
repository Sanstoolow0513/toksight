// Shared categorical palette for agent/model series. PALETTE holds the
// light-theme hex values, pinned to the :root --color-cat-1 … --color-cat-5
// custom properties in globals.css (design-spec §2) by test/palette.test.js;
// the dark ramp lives in globals.css next to the other [data-theme='dark']
// overrides. Rank encoding, not identity: callers pass the entity's position
// in a descending volume sort, so the leader is ink and the rest step down a
// warm-gray ramp — one hue, no rainbow.
export const PALETTE = ['#1a1917', '#6f6a63', '#a8a39a', '#d6d3cc', '#eae8e2'];

// Inline styles reference the custom property, not the hex: the same mark
// then follows the active theme (light ramp in :root, dark ramp under
// [data-theme='dark']).
export const colorAt = (i) => `var(--color-cat-${(i % PALETTE.length) + 1})`;
