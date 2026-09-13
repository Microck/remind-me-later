<div align="center">

  <h1>remind me later</h1>

  <p>private message reminders for BetterDiscord</p>

  <p>
    <a href="https://raw.githubusercontent.com/Microck/remind-me-later/main/RemindMeLater.plugin.js"><img src="https://img.shields.io/badge/download-plugin-000000?style=flat-square" alt="download plugin badge"></a>
    <a href="https://github.com/Microck/remind-me-later/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/Microck/remind-me-later/test.yml?branch=main&style=flat-square&label=ci&color=000000" alt="ci badge"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-mit-000000?style=flat-square" alt="license badge"></a>
  </p>
</div>

---

`remind me later` adds private, local message reminders to Discord. right-click a message, pick a time, and jump back when it is due. there is no bot, server, account, telemetry, or runtime dependency.

[download](https://raw.githubusercontent.com/Microck/remind-me-later/main/RemindMeLater.plugin.js) | [testing](TESTING.md) | [security](SECURITY.md) | [changelog](CHANGELOG.md)

## why

Discord has no built-in way to bring a message back at a useful time. this plugin keeps the whole reminder on your computer:

- one active reminder per message
- presets, custom durations, and local dates
- a searchable inbox for due and upcoming reminders
- snooze, reschedule, edit, open, finish, and delete actions
- optional desktop notifications and a local chime
- no network requests, remote code, message sends, reactions, or fake pings

## install

you need the Discord desktop app with [BetterDiscord](https://betterdiscord.app/) installed.

1. download [`RemindMeLater.plugin.js`](https://raw.githubusercontent.com/Microck/remind-me-later/main/RemindMeLater.plugin.js).
2. open Discord, then go to User Settings > BetterDiscord > Plugins > Open Plugins Folder.
3. put `RemindMeLater.plugin.js` in that folder.
4. enable **Remind Me Later**.

the usual plugin folders are:

| system | folder |
| --- | --- |
| Windows | `%APPDATA%\BetterDiscord\plugins` |
| macOS | `~/Library/Application Support/BetterDiscord/plugins` |
| Linux | `~/.config/BetterDiscord/plugins` |

## use

right-click a message and choose **Remind me**. presets cover 15 minutes, 30 minutes, 1 hour, 1 day, and 1 week. custom input accepts values such as `45m`, `2h 30m`, or `1w 2d`, plus a date and time in your local timezone.

the private **Reminders** button opens the inbox. reminders stay there until you finish or snooze them. opening a message does not dismiss its reminder.

when a reminder is due, the plugin can:

- show an in-app alert with open, snooze, and done actions
- add a due count to the Reminders button
- mark visible chat links with an amber stripe
- play a short local chime
- show an optional desktop notification

Discord must be running with the plugin enabled to alert on time. if the computer sleeps or Discord closes, the next start or scheduler check catches up overdue reminders.

## privacy

the plugin stores reminders through `BdApi.Data`, split by Discord account. records contain Discord message, channel, and server IDs, timestamps, status, an optional note, and an optional saved preview.

message previews are off by default. desktop notifications are also off by default, and notification details need a separate opt-in. turning saved previews off erases existing previews for that account.

storage is plain JSON, not encryption. other plugins, local processes, device users, and backups may read it. there is no cross-device sync.

## limits

- 500 reminders per Discord account
- delays from 1 second to 3,650 days
- one Discord instance per BetterDiscord data folder
- no alert while Discord is fully closed
- message jumps depend on Discord internals that can change

BetterDiscord is an unofficial client modification. its [FAQ](https://docs.betterdiscord.app/users/getting-started/faq) says it is against Discord's Terms of Service. this project is not affiliated with Discord or BetterDiscord.

## development

the plugin file is both the source and the distributable. there is no build step and no dependency install.

```sh
npm run check
npm test
```

the core suite uses Node.js 22+. the optional UI smoke suite uses Python, Playwright, and an isolated mock Discord page:

```sh
python test/ui_smoke.py
```

automated tests do not prove live Discord or operating-system notification compatibility. see [TESTING.md](TESTING.md) for the live-client checklist.

## remove

disable **Remind Me Later**, remove `RemindMeLater.plugin.js`, and delete its BetterDiscord config file if you also want to erase saved reminders.
