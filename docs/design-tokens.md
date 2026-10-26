# Design tokens — from `workforce-prototype-updated.html`

Inherited in `src/global.css` for Vite + Tailwind v4.

## What was extracted

### 1. Color system
| Category | Tokens |
|----------|--------|
| Brand | `blue`, `blue-dark`, `blue-focus`, `light` |
| Core | `ink`, `muted`, `line`, `line-soft`, `bg` |
| Status | `green`, `teal`, `amber`, `red` + surface pairs (success / warning / danger / info / open) |
| Neutrals | gray-400→900, border, surface, hover, tint |
| Avatars | blue / teal / lilac / sand bg+fg |
| Chrome | prototype bar, toast |

### 2. Typography
See `typography-scale.md`. Cap **28px**. Weights **400 / 500 / 600 / 700**.

### 3. Radius
`2 · 5 · 6 · 7 · 8 · 9 · 10 · 12 · 14 · pill` → `radius-xs` … `radius-5xl`, `radius-pill`  
Default card radius: **12px** (`--radius`).

### 4. Shadows
Card (`xs`), hover, menu, dropdown, dialog, hero metric, focus rings.

### 5. Spacing rhythm
Dominant gaps **8px / 12px**; content padding **32px**; scale `0.5` → `12` in rem.

### 6. Layout shell
| Token | Value |
|-------|------:|
| Proto bar | 40px |
| Sidebar | 248 / 215 / 74px |
| Topbar | 72 / 60px |
| Content max | 1450px |
| Dialog | 540 / 400 / 920px |
| Drawer | 500px |
| Mobile nav | 70px |

### 7. Controls
Heights **32 · 34 · 36 · 40 · 44 · 46px**; icon **20px** stroke **1.6**.

### 8. Breakpoints
`640 · 760 · 1024 · 1100 · 1200 · 1600` (aligned to prototype media queries).

### 9. Motion
`150ms` / `200ms`; unlock slide/fade; shimmer; reduced-motion reset.

### 10. Z-index
Proto 50 → sidebar 35 → dialog 100 → toast 200 → offline 300.

### 11. Base inheritance
Box-sizing, focus rings, button transitions, form controls, select chevron, SVG defaults — applied in `@layer base` so components inherit without re-declaring.

### 12. Dropdown chevrons
**5px** (`--dropdown-chevron-pad`) padding to the right on chevron/down icons in selector buttons.

Use `data-icon="chevron"` or `data-icon="down"` on the trailing SVG, or the `.dropdown-chevron` class:

```tsx
<button className="btn">
  Status
  <ChevronDown data-icon="chevron" />
</button>
```

Native `<select>` chevrons are also inset by the same 5px from the right edge.
