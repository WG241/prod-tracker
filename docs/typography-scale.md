# Typography scale — extracted from `workforce-prototype-updated.html`

Font family: **Inter** (`400 / 500 / 600 / 700`)  
App hard cap: **28px** (`1.75rem` at 16px root) — prototype values above 28px are clamped to display.

## Font weights

| Weight | Value | Prototype usage |
|--------|------:|-----------------|
| Regular | 400 | Body, muted copy, week-label small |
| Medium | 500 | Buttons, nav, labels, table headers, badges, task titles |
| Semibold | 600 | h3, profile name, eyebrows, active states, rates, pills |
| Bold | 700 | Logo, hero metric values, shimmer digits |

## Font sizes (categorical)

### Micro / chrome
| Size | rem | Token | Where it appears |
|-----:|----:|-------|------------------|
| 9px | 0.5625 | `text-micro` | Logo micro label, badge-count |
| 10px | 0.625 | `text-caption` | Legend, tag-meta, person-cell small, mobile nav, trails |
| 11px | 0.6875 | `text-xs` | Eyebrow, section-label, metric-bottom, badges, chart labels, subcells |

### Body / UI
| Size | rem | Token | Where it appears |
|-----:|----:|-------|------------------|
| 12px | 0.75 | `text-sm` | Dominant secondary: tables, small buttons, cards, timeline |
| 13px | 0.8125 | `text-md` | Crumb, banner, tabs, field labels, toasts, action menu |
| 14px | 0.875 | `text-base` | **Body default**, task titles, week label |

### Headings / emphasis
| Size | rem | Token | Where it appears |
|-----:|----:|-------|------------------|
| 15px | 0.9375 | `text-lg` | **h3**, leave summary, relief disclosure |
| 16px | 1 | `text-xl` | Dialog h2 (sm), mobile inputs |
| 18px | 1.125 | `text-2xl` | **h2**, dialog titles |
| 19px | 1.1875 | `text-3xl` | Summary-inline values |

### Display (capped)
| Size | rem | Token | Where it appears |
|-----:|----:|-------|------------------|
| 23px | 1.4375 | `text-4xl` | Detail title, more-btn glyph |
| 27px | 1.6875 | `text-5xl` | Logo, donut center |
| **28px** | **1.75** | `text-display` / `text-6xl` | **h1 max (hard cap)** |

### Prototype sizes clamped → 28px
These existed in the HTML but must not exceed the app max:

| Original | Role | Maps to |
|---------:|------|---------|
| 29–35px | Metric values (mobile / hero) | `text-display` |
| 32–40px | Metric / hero metric values | `text-display` |
| 40–43px | Login art h1 | `text-display` |

## Tailwind usage

```tsx
<p className="text-base font-regular">Body</p>
<h3 className="text-lg font-semibold">Section</h3>
<h1 className="text-display font-regular">Greeting</h1>
<span className="text-sm font-medium">Meta</span>
```
