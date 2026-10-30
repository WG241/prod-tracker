# Reasoning for 0003

## Context

Features 1 through 3 established tooling, the Node service, and a migrated local data model. The browser still renders the scaffold. The next foundation needs a reusable shell and control set without pulling complete role journeys into the same run.

The repository requires the HTML prototype as the UI contract. Tokens already exist in `src/global.css`, but there are no shared React controls or role shell yet. The final prototype includes overrides that supersede some original markup and styles, so extraction must consider its final rendered state.

## Options considered

### Copy the prototype as one React page

This would expose the broad visual surface quickly and simplify early comparisons. It would also duplicate simulated workflows, pull later role features into this run, and preserve tightly coupled imperative behavior that later modules would have to replace.

### Shared React shell and native controls

This retains the current stack and allows role features to supply content to a stable shell. Native form controls and dialogs provide a smaller dependency surface. The team still has to verify accessible naming, modal state synchronization, focus restoration, and the prototype's responsive behavior.

### Shared shell with a component library

A dedicated accessible component library could provide more overlay and interaction primitives as the app grows. It adds a dependency and styling integration now, before those broader interaction needs have been demonstrated.

## Rationale

The user selected the shared shell and native control approach. It fits the agreed Feature 4 boundary while leaving database backed workflows in their planned role features. A component preview gives developers a concrete place to exercise the shared pieces without adding a new role sidebar item.

The preview page is an explicit user approved exception to the prototype page rule. Every control still follows a named prototype reference. Production removes the development tools and exposes only the temporary Employee shell with clearly marked unfinished destinations, until the sign in feature supplies the real role context.

No further research references were requested. The prototype file URL was blocked by browser policy during this conversation. Reading its source supports this spec but is not evidence of completed visual inspection or verification.

## Independent cross check

A second model reviewed the draft on 2026-10-26. It caught a menu table copied from the original prototype declaration rather than the later PRD 1.2 replacement. It also flagged an optional profile action, competing focus rules after More navigation, and wording that incorrectly called the production persona development only.

The user approved the recommended corrections: use the final effective menus, retain the prototype account menu with Profile & account leading to the placeholder and Sign out disabled until authentication, give navigation focus precedence over opener restoration, and identify the temporary production persona as fictional. These corrections are included in the build spec. The user also approved retaining the account menu rather than taking the reviewer's alternative of direct profile navigation.
