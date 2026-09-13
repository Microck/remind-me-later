# Privacy and security

remind me later runs inside a modified Discord desktop client and inherits that environment's privileges. review the installable source before use.

The plugin does not read authentication tokens, create bots or webhooks, send or edit messages, make HTTP/WebSocket requests, or download code. Its only persistent runtime writes are to its own account-scoped BetterDiscord data. Optional desktop notifications use the OS notification system. Audio is generated locally with Web Audio. Message navigation occurs only after a user action.

Message previews require explicit opt-in; desktop notification details are separately opt-in. Notes and previews are inserted as text, not HTML. Message-link input is restricted to HTTPS Discord hosts and numeric message/channel/server paths. A bad or unsupported data schema is not silently overwritten. Delayed callbacks verify the active account before acting. These controls have automated tests but are not a formal security audit.

Local files are not encrypted. Other plugins, processes, device users, and backups with filesystem access can read them. Per-account isolation does not protect against another component in the same privileged process. OS notification history can outlive the visible alert. Never include real message content, account IDs, message links, or config files in public bug reports.

Use synthetic messages to report functional bugs. Report sensitive vulnerabilities through a private channel agreed with the maintainer; no dedicated private reporting endpoint is configured.

the separate `scripts/publish.cjs` helper invokes Git and the authenticated GitHub CLI only when manually run. it creates or updates the public source repository. the Discord plugin never loads it.
