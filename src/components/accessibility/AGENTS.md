# Shared accessibility context

Root AGENTS.md applies. This area implements spec 0006 and the contract in `docs/accessibility.md`. It adds no domain API, actor authority or database model. Keep the exact prototype composition and feature owned validation.

`useFormValidation` consumes ordered named control refs and feature supplied errors. Submit renders errors before focusing the first invalid control in DOM order. A field already focused gets one alert fallback for that submit attempt. Editing rechecks only already invalid fields. Field error text itself is never a live region. Generic service errors retain logical focus.

`AnnouncementProvider` owns one bus and empty root hosts per context. `ModalAnnouncements` supplies empty hosts inside the native dialog. Events are plain text with a caller supplied id and status/alert intent. Modal opening waits for its empty hosts, and modal close drops queued work. Event ids deduplicate Strict Mode and repeated renders. Deliberate new actions need new ids.

`useAnnouncementReset` clears obsolete messages when an actor/workspace changes. `useAnnounce` captures the bus version, so delayed callbacks from an old context cannot publish into the new one. Subscribers receive a fresh callback after reset. A callback from an unmounted modal is rejected. A caller that completes after ordinary modal close can publish through a still relevant root callback after close; this helper never decides whether a domain write succeeded.

Shared `Button` busy state stays focusable with aria-disabled and a real activation guard. Forms also guard duplicate submits. Permanent unavailability remains native disabled. Dialogs keep native showModal/background inertness and the existing single boundary wrap. Ordinary dismissal restores a visible enabled opener or the current heading; More navigation gives the destination heading precedence. Tables add a keyboard scroll stop only when they overflow.

Tests use the existing Node/tsx runner, Playwright Library and axe, not a second runner. `tests/accessibility/surfaces.ts` is the required built/planned inventory. `npm run test:a11y:install` installs Chromium once; `npm run test:a11y` checks types and tests the real app. A11Y_BASE_URL is a loopback origin; A11Y_TARGET selects development or production inventory. Missing states fail. All applicable normative axe findings fail, regardless of impact; incomplete and advisory results stay visible.

Reports under `.local/verification/feature7/` must exclude credentials, tokens, raw browser storage and full request traces. Actual NVDA and native browser zoom require separate observed evidence. Do not equate an automated viewport, axe scan, accessibility tree or emulated color mode with those manual checks. See the feature verify.md for open coverage before marking it done.
