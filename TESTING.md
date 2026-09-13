# Testing

## Verified in this environment

Node.js v22.16.0: 62 core/runtime tests pass.

Chromium with a mocked BetterDiscord/Discord environment: 13 UI smoke checks pass. These checks include multiple assertions per scenario. The full smoke run makes zero network requests. The actual installable plugin file is loaded; no substitute implementation is used for the plugin itself.

The UI checks exercise startup, context-menu creation, all requested presets, custom validation, message-link input, search and filtering, safe text rendering, local due counts, chat stripes, notification actions, snooze, message routing, desktop notification opt-in, preview erasure, date editing without moving the deadline, Escape handling, account switching, stale callbacks, persistence across plugin restarts, settings panels, delete confirmation, and teardown.

The Discord stores, menu components, router, BetterDiscord persistence/notification functions, and desktop Notification class are mocked. Actual BetterDiscord rendering, filesystem writes, OS notifications, chime audibility, and live Discord message jumps have not been verified. No live Discord session is available in this environment.

## Run core tests

Requires Node.js 22 or newer. No dependencies are installed.

```sh
npm run check
npm test
```

The tests cover duration boundaries, invalid dates, daylight-saving gaps, link allowlists, unsafe/invalid navigation targets, opt-in previews, length limits, immutable state changes, duplicate reminders, state validation, overdue/restart catch-up, snooze, limits, per-account storage, logout handling, corrupt data, failed writes, save-before-alert ordering, and batched catch-up.

## Run UI smoke tests

Requires Python 3 and Playwright. These are development-only dependencies.

```sh
python -m pip install playwright
python -m playwright install chromium
python test/ui_smoke.py
```

The runner also supports a system `chromium` executable or an explicit `CHROMIUM_PATH` environment variable. It generates `test/ui-results.json` and `test/ui-preview.png`, both ignored by Git. The screenshot uses synthetic content and identifies itself as an isolated test fixture.

## Live-client acceptance checklist

Before treating a release as production-verified:

1. Record the OS, Discord channel/build, and BetterDiscord version. Install and enable the file, and confirm there are no startup errors.
2. In a DM, group DM, server channel, and thread, right-click a message and confirm the Remind me submenu appears. Check every preset and a 10-second custom reminder.
3. Confirm the in-app alert, badge, and chat stripe. Use Open message, Snooze 15m, custom snooze, and Done. Check that opening a message alone does not dismiss the reminder.
4. Edit a note on a reminder that is less than a minute away. Confirm its exact due timestamp remains unchanged. Test a future local date/time and invalid input.
5. Opt into desktop alerts; test allow/deny and system Do Not Disturb. Confirm details remain hidden until separately enabled. Test the generated chime and its off setting.
6. Close Discord before a reminder is due and reopen it afterward. Test suspend/resume as well. Confirm one catch-up alert and persistent due state without repeated restart alerts.
7. Switch accounts while a dialog and notification are open. Verify that no old content remains visible and old actions cannot alter the new account. Switch back and confirm original reminders remain.
8. Toggle saved previews on and off. Verify existing previews are erased when disabled. Confirm local JSON contains only the expected account-scoped fields.
9. Delete or lose access to a target message, and confirm the local reminder can still be removed. Test the message-link and clipboard fallbacks.
10. Disable the plugin. Confirm no button, dialog, highlight, active timer, menu hook, or plugin notification remains.

Mocked tests are not a claim that the checklist above has been completed.
