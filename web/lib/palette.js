// Shared categorical palette for donut / model bars. Hex values match
// --color-cat-1 … --color-cat-8 in globals.css / design-spec.md (v2, black bg).
export const PALETTE = ['#3291ff', '#45d483', '#f5a524', '#bc8cff', '#f778ba', '#39c5cf', '#ff4d4d', '#8ddb8c'];

export const colorAt = (i) => PALETTE[i % PALETTE.length];
