// Shared categorical palette for donut/bars/charts, so every section colors
// the same entity the same way.
export const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f778ba', '#39c5cf', '#f85149', '#8ddb8c'];

export const colorAt = (i) => PALETTE[i % PALETTE.length];
