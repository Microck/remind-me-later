# remind me later v1.1.0

- Add a setting to keep reminder alerts open until the user dismisses them.
- Clarify due reminder titles, locations, notes, and message-preview labels.

## v1.0.4

- Fix the reminder submenu insertion for BetterDiscord's current grouped message-menu tree.

## v1.0.3

- Read the clicked message from BetterDiscord's current menu target instead of the removed `props.message` callback field.

## v1.0.2

- Match message menus by their message payload instead of Discord's private menu name.
- Add a saved setting to hide the floating reminder button.

## v1.0.1

- Fix the message context-menu item against the current BetterDiscord API.
- Replace the oversized card UI with a compact, true-black interface.
- Reduce the floating launcher to a 36px square button.

## v1.0.0

initial implementation. live Discord desktop testing is still pending.

- Right-click message reminders: 15 minutes, 30 minutes, 1 hour, 1 day, 1 week, or custom duration/local date and time.
- Private reminder inbox with search, due/upcoming filters, local due badge, and amber chat stripes.
- In-app alerts, optional desktop notifications, and a locally generated chime.
- Message jump, copy-link fallback, snooze, edit, finish, and cancel actions.
- Pasted-message-link scheduling fallback.
- Per-account local persistence, overdue catch-up, summary alerts for large batches, and stale-action guards.
- Opt-in saved message previews and opt-in desktop details; no network calls or runtime dependencies.
- Validation for timestamps and message links; unreadable data is preserved rather than overwritten.
- 62 core/runtime tests and 13 Chromium UI smoke scenarios with mocked Discord/BetterDiscord APIs.

Limitations: Discord must be running for timely alerts; no cross-device sync or multi-process coordination; private Discord internals can change; live-client compatibility and actual OS alert behavior are not yet verified.
