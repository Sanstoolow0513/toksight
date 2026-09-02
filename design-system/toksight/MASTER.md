# Design System Master File

> **SOURCE OF TRUTH:** repo-root `design-spec.md`. This file is a **projection** of that spec
> (tokens, components, anti-patterns). If they conflict, `design-spec.md` wins.
> Do **not** regenerate this file with ui-ux-pro-max `--persist` and ship it as-is — the
> skill concatenates Brutalism *style copy* with generic SaaS component templates
> (8–16px radius, shadows, 200ms transitions, Google Fonts). That dump is what desynced
> the last pass. Hand-align to the spec, or `--force` and then immediately rewrite.

---

**Project:** toksight
**Generated:** 2026-09-02 (aligned to design-spec.md v6)
**Category:** Local-first CLI companion — AI coding-agent token / cost / cache dashboard
**Design Dials:** Variance 8/10 (Bold / Asymmetric) | Motion 3/10 (Subtle) | Density 9/10 (Dense / Dashboard)

---

## Global Rules

### Color Palette

ANSI phosphor on near-black. Structure is **lines**, not surface tint. Rank palette encodes
**order**, not identity.

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary (phosphor lime) | `#c9f24b` | `--color-primary` |
| On Primary (ink) | `#060609` | `--color-primary-ink` |
| Primary subtle | `rgba(201, 242, 75, 0.12)` | `--color-primary-subtle` |
| Background (page gutter) | `#060609` | `--color-bg` |
| Panel (worksheet cell) | `#0e0e15` | `--color-panel` |
| Panel nested (slots) | `#15151f` | `--color-panel-2` |
| Line (1px inner hairline) | `#26262f` | `--color-line` |
| Border strong (2px mosaic + chrome) | `#4a4a5e` | `--color-border-strong` |
| Text | `#e8e8f2` | `--color-text` |
| Text secondary | `#a0a0b6` | `--color-text-secondary` |
| Text muted | `#82829c` | `--color-text-muted` |
| Success (cache) | `#3ddc97` | `--color-success` |
| Warning | `#ffb020` | `--color-warning` |
| Error | `#ff5c5c` | `--color-error` |
| Chart input | `#c9f24b` | `--color-chart-input` |
| Chart cache-read | `#3ddc97` | `--color-chart-cache-read` |
| Chart cache-write | `#c86bff` | `--color-chart-cache-write` |
| Chart output | `#ffb84d` | `--color-chart-output` |
| Heat 0–4 | `#101018` / `#202d10` / `#374d16` / `#6f9b26` / `#c9f24b` | `--color-heat-0` … `--color-heat-4` |
| Rank cat 1–5 | `#c9f24b` `#9a9ab2` `#6a6a84` `#4a4a62` `#2e2e42` | `--color-cat-1` … `--color-cat-5` |

Must match `web/lib/palette.js`. Leader = lime; the rest step down the gray ramp.

**Color notes:** Dark only. No light theme. No rainbow categorical palette. No ambient glow.

### Typography

- **Data / chrome / logo / tables / chart ticks:** Geist Mono (`--font-geist-mono`), tabular-nums
- **Body / descriptions:** Geist Sans (`--font-geist-sans`)
- **Mood:** terminal worksheet, dense, precise — not marketing SaaS
- **Source:** `geist` npm package, bundled at build. **No Google Fonts `@import`** (breaks local-first).

**Type scale (px):** `11 / 12 / 14 / 16 / 24 / 34(hero)`

Micro-labels (stat-label, table heads, desc chrome): mono, uppercase, `letter-spacing: 0.08em`, 11px.
Hero KPI values: 34px mono 700.

### Spacing Variables

*Density: 9/10 — Dense / Dashboard. Base 4px, matching the spec (not the skill's 2px xs table).*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | Tight gaps |
| `--space-2` | `8px` | Icon / inline |
| `--space-3` | `12px` | Compact padding |
| `--space-4` | `16px` | Standard padding |
| `--space-5` | `20px` | Cell padding (tight) |
| `--space-6` | `24px` | Cell padding (default) |
| `--space-7` | `32px` | State-card padding |
| `--space-8` | `48px` | Rare large gaps |
| `--grid-line` | `2px` | Mosaic gap + outer frame |
| `--page-max` | `1680px` | `.wrap` max width |

### Radius / Shadow / Motion

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-*` | `0` | **All corners square. Never add radius.** |
| Shadows | none | No `box-shadow`, no glow |
| Blur | none | No `backdrop-filter`, no Gaussian |
| Hover | instant invert | lime fill + `--color-primary-ink` text; **no `transition` on hover** |
| Active press | `translateY(1px)` | Mechanical click, not lift |
| Allowed motion | page fade 240ms; agent-row `grid-template-rows` 0.25s; caret rotate 0.25s; trend wipe 450ms on *user* switch only; refresh spin; skeleton pulse | All killed under `prefers-reduced-motion` |

---

## Component Specs

Classes below are the ones in `web/app/globals.css`. Do not invent `.btn-primary` / `.card`.

### Buttons (`.btn`)

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--color-panel-2);
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
  padding: var(--space-1) var(--space-4);
  font-size: var(--font-size-xs);
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 0;
}
.btn:hover:not(:disabled) {
  background: var(--color-primary);
  color: var(--color-primary-ink);
  border-color: var(--color-primary);
}
.btn:active:not(:disabled) {
  transform: translateY(1px);
}
```

### Segmented control (`.seg`)

Square track, 1px strong border. Selected segment is lime invert. No pill (`border-radius: 999px` forbidden).

### Worksheet cell (`.cell` / `.stat`)

Not a floating card. Cells are tiles in a mosaic: parent (`.frame` / `.kpis` / `.sheet`) background is `--color-border-strong`; `gap: 2px` reveals the grid. Cell fill is `--color-panel`. Padding 20/24. Radius 0. No shadow.

### Inputs / checkbox

Square 14×14, `appearance: none`, 1px strong border. Checked = lime fill (the fill *is* the mark). No OS rounded checkbox.

### Tooltip (`.tip`)

Fixed, mouse-anchored, 1px strong border, panel fill, radius 0, no shadow, no blur. Shared `components/Tip.jsx` for every chart.

### Charts

- **Trend:** per-day **step-after stacked bands**, solid fill (`fill-opacity: 1`), no Bézier / monotone-cubic, no translucent mountain. Hover mark is a **square**. `shape-rendering: crispEdges`. Wipe 450ms only after the user changes range / mode / series.
- **Heatmap:** square cells, **2px** gutter, lime 5-step ramp, no `rx`.
- **Bars (hour / month):** square columns, lime, opacity 1, 2px gutters.
- **Model bar:** two **sibling** hard segments (cache green + rank color). Not `linear-gradient`. Functional two-color split is allowed; blends are not.
- **Legend swatches:** 8×8 squares, never circles.

---

## Style Guidelines

**Style:** Brutalism phosphor worksheet (CLI visualization, not a SaaS skin)

**Keywords:** Raw, stark, high contrast, visible 2px grid, square corners, mono data type, instant invert, no chrome

**Best For:** This product only — local token/cost dashboard

**Key Effects:** No smooth hover transitions (instant), sharp corners (0px), bold mono numerals (700), visible mosaic grid, large KPI blocks

### Page Pattern

**Pattern Name:** Worksheet / operations dashboard (not a marketing landing)

- **Section order:** masthead → optional banners → 4-cell KPI strip → 12-col sheet (trend 12, heatmap 12, agent 5 + model 7, hour 4 + month 4 + rhythm 4, sessions 12) → footer
- **Never** label telemetry as "live". Masthead shows last-fetch time from `generatedAt`.
- **CTA:** refresh is a square invert button; language is a square segmented control.

---

## Motion

Subtle. No GSAP. No scroll-reveal. No number tickers. No stagger entrance.

Allowed (see spec §4); everything else is forbidden. `prefers-reduced-motion` zeros animations and transitions.

---

## Anti-Patterns (Do NOT Use)

- ❌ Rounded corners, shadows, blur, gradient fills, ambient glow (hard two-color bar splits are the only exception)
- ❌ Light theme
- ❌ Smooth hover transitions (Brutalism is instant invert)
- ❌ Entrance choreography, number roll-up, grow-in bars/cells, breathing dots
- ❌ "Live" badge or pulse on the nav
- ❌ Rainbow categorical colors; rank is lime + gray
- ❌ Decorative icons on labels / titles / values (icons = actions and states only: RefreshCw, ChevronDown, warn/empty/error)
- ❌ Inter / Fira / Inter-like "upgrades"; this app is Geist, mono-led
- ❌ Google Fonts network import
- ❌ Hiding unpriced models — footer must list them
- ❌ UTC day boundaries; grouping follows the machine's local timezone
- ❌ Same agent/model getting a different color on a different chart (rank palette, same sort)
- ❌ Untranslated chrome in the zh-CN UI
- ❌ Skill-generated SaaS component CSS (`border-radius: 8px`, `box-shadow`, `transition: all 200ms`, white modal, backdrop blur)

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — lucide-react only, `strokeWidth={2}`, 14–18px
- ❌ **Missing cursor:pointer** on clickable elements
- ❌ **Layout-shifting hovers** other than the 1px active press
- ❌ **Low contrast text** — 4.5:1 body on panel
- ❌ **Invisible focus states** — 2px lime outline, 2px offset
- ❌ **Smooth 150–300ms hover** — that generic checklist item contradicts this product; do not reintroduce it

---

## Pre-Delivery Checklist

- [ ] Radius 0 everywhere (including UA buttons / checkboxes)
- [ ] Mosaic gaps use `--color-border-strong` (2px grid actually visible)
- [ ] Trend is step-after solid bands, not a smooth mountain
- [ ] Heatmap cells are squares with 2px gutters, no `rx`
- [ ] Model bars are two solid siblings, not a CSS gradient
- [ ] Hover invert has no transition
- [ ] Geist Mono on data; no Google Fonts
- [ ] `prefers-reduced-motion` respected
- [ ] Footer lists unpriced models
- [ ] Responsive: 375 / 768 / 1024 / 1440; KPI 2×2 at ≤900px
- [ ] No horizontal window scroll (heatmap may scroll internally)
