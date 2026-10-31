# Verify: design system and UI foundation

Status: partial, full verification remains outstanding. The implementation run on 2026-10-28 ended when native Computer Use could not confidently determine the Windows browser URL. This checklist was saved with the user's approval and remains available for resuming Feature 4.

## Remaining complete feature check

- [ ] Exercise every destination and Profile for all five final role menus. Check persona, title, breadcrumb, active destination and unfinished copy (AC-2, AC-3).
- [ ] Compare desktop, rail and mobile shell against the exact prototype views and inspect account disclosure dismissal and disabled actions (AC-1, AC-2, AC-7).
- [ ] Exercise every shared field/button/badge/avatar/table variant and confirm labels, required/error/disabled states, unknown status and initials edge cases (AC-4).
- [ ] Recheck all dialog sizes and drawers, long content, Tab/Shift+Tab, Escape, ordinary return, removed opener fallback and More navigation focus after the final fixes (AC-5, AC-7).
- [ ] Check 320 CSS pixels, 200 percent zoom, focus contrast, all actual color pairs, and reduced motion (AC-7).
- [ ] Run production and check Employee default, `/__ui` fallback, and absence of component preview modules and role controls (AC-6).
- [ ] Run lint and production build, then record all acceptance criteria with evidence before ticking Verify it (AC-8).

## Earlier partial observations

The approved HTTP prototype reference was inspected for all five landing shells, Employee form and drawer, account disclosure, and HR More. The shared implementation rendered in development and production. The previous run observed mobile More navigation focusing Settings, Escape returning to More, 320 pixel layout without overflow, and a corrected dialog Tab wrap and removed opener fallback.

The sand avatar foreground was darkened after measuring the original pair at 4.07:1. Enabled input and outlined button boundaries use gray 500. These adjustments are documented in `design.md`. A complete final measured matrix and the remaining checks above are still required.

The latest project lint, strict types and build also passed while implementing Feature 5, but that tooling result does not substitute for complete Feature 4 runtime verification.
