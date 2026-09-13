"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const path = require("node:path");
const Plugin = require("../RemindMeLater.plugin.js");
const C = Plugin.testing;
const NOW = 1_800_000_000_000;
const OWNER = "111111111111111111";
const OTHER = "222222222222222222";
const TARGET = {guildId: "@me", channelId: "333333333333333333", messageId: "444444444444444444"};
const make = (state = C.freshState(), target = TARGET, due = NOW + 60_000, note = "") => C.upsert(state, target, due, note, NOW);

for (const [input, expected] of [["15m", 900000], ["30 minutes", 1800000], ["1h", 3600000], ["1d", 86400000], ["1w", 604800000],
    ["2h 30m", 9000000], ["1w2d3h4m5s", 788645000], [" 1.5 HOURS ", 5400000], ["10s", 10000], ["1hr 2mins 3secs", 3723000]]) {
    test(`duration ${JSON.stringify(input)}`, () => assert.equal(C.parseDuration(input), expected));
}
for (const input of ["", " ", "0m", "-1h", "1h -30m", "10", "tomorrow", "1 hour rubbish", "1e6m", "Infinityh", "999999999999w", "0.1s", "1,5h"]) {
    test(`reject invalid duration ${JSON.stringify(input)}`, () => assert.throws(() => C.parseDuration(input)));
}
test("duration limits include one second and 3650 days", () => {
    assert.equal(C.parseDuration("1s"), 1000); assert.equal(C.parseDuration("3650d"), C.MAX_DELAY);
    assert.throws(() => C.parseDuration("3651d")); assert.throws(() => C.parseDuration(null));
});
test("presets match every requested delay", () => assert.deepEqual(C.PRESETS.map(p => p[1]), [900000, 1800000, 3600000, 86400000, 604800000]));
test("parse server, DM, canary and PTB links without network access", () => {
    for (const host of ["discord.com", "canary.discord.com", "ptb.discord.com", "discordapp.com"]) {
        assert.deepEqual(C.parseMessageLink(`https://${host}/channels/@me/${TARGET.channelId}/${TARGET.messageId}`), TARGET);
    }
    assert.equal(C.parseMessageLink(`https://discord.com/channels/${OWNER}/${TARGET.channelId}/${TARGET.messageId}/?foo=bar`).guildId, OWNER);
});
for (const link of ["javascript:alert(1)", "https://discord.com.evil.test/channels/@me/12345/67890", "http://discord.com/channels/@me/12345/67890",
    "https://discord.com/channels/@me/12345", "https://discord.com:8443/channels/@me/12345/67890", "https://user@discord.com/channels/@me/12345/67890",
    "https://example.com/channels/@me/12345/67890", "https://discord.com/channels/@me/12345/67890/extra"]) {
    test(`reject untrusted or incomplete link ${link}`, () => assert.throws(() => C.parseMessageLink(link)));
}
test("navigation cannot use arbitrary paths or imprecise numeric IDs", () => {
    assert.equal(C.messagePath(TARGET), `/channels/@me/${TARGET.channelId}/${TARGET.messageId}`);
    assert.throws(() => C.messagePath({...TARGET, channelId: "../settings"}));
    assert.equal(C.validTarget({...TARGET, channelId: 333333333333333333}), false);
});
test("date/time preserves the selected local minute", () => {
    const future = Math.ceil((Date.now() + 3600000) / 60000) * 60000;
    assert.equal(C.parseLocalTime(C.localInput(future)), future);
});
test("invalid or past date/time is rejected", () => {
    for (const value of ["nonsense", "2028-02-30T12:00", "2028-13-01T12:00", "2028-01-01T25:00", "2000-01-01T12:00"])
        assert.throws(() => C.parseLocalTime(value));
});
test("Europe/Madrid nonexistent daylight-saving time is rejected", () => {
const file = path.resolve(__dirname, "../RemindMeLater.plugin.js");
    const code = `const {parseLocalTime}=require(${JSON.stringify(file)}).testing;try{parseLocalTime('2027-03-28T02:30',Date.UTC(2027,0,1));process.exit(1)}catch{};parseLocalTime('2027-03-28T03:30',Date.UTC(2027,0,1));`;
    const run = spawnSync(process.execPath, ["-e", code], {env: {...process.env, TZ: "Europe/Madrid"}});
    assert.equal(run.status, 0, run.stderr.toString());
});
test("fresh data has privacy-preserving defaults and independent copies", () => {
    const a = C.freshState(), b = C.validateState(undefined);
    assert.equal(a.settings.desktop, false); assert.equal(a.settings.desktopPreview, false); assert.equal(a.settings.savePreview, false);
    a.settings.desktop = true; a.reminders.push({});
    assert.equal(b.settings.desktop, false); assert.equal(b.reminders.length, 0);
});
test("create a message reminder without mutating the previous state", () => {
    const previous = C.freshState(), result = make(previous, TARGET, NOW + 10000, " Note ");
    assert.equal(previous.reminders.length, 0); assert.equal(result.reminder.note, "Note");
    assert.equal(result.reminder.status, "pending"); assert.equal(result.updated, false);
});
test("one active reminder per message; reselecting reschedules it", () => {
    const first = make(), second = make(first.state, TARGET, NOW + 120000, "updated");
    assert.equal(second.state.reminders.length, 1); assert.equal(second.reminder.id, first.reminder.id);
    assert.equal(second.reminder.createdAt, first.reminder.createdAt); assert.equal(second.reminder.dueAt, NOW + 120000);
    assert.equal(second.updated, true);
});
test("message preview is not stored without explicit opt-in", () => {
    assert.equal(make(C.freshState(), {...TARGET, preview: "sensitive"}).reminder.preview, "");
    const state = C.freshState(); state.settings.savePreview = true;
    assert.equal(make(state, {...TARGET, preview: "x".repeat(500)}).reminder.preview.length, 280);
});
test("note and preview lengths are capped", () => {
    assert.equal(make(C.freshState(), TARGET, NOW + 50000, "x".repeat(800)).reminder.note.length, 500);
});
test("scheduling rejects elapsed, fractional, infinite, and excessive timestamps", () => {
    for (const due of [NOW, NOW + 999, NOW + 1000.5, Infinity, NaN, NOW + C.MAX_DELAY + 1]) assert.throws(() => make(C.freshState(), TARGET, due));
});
test("restored reminders round-trip and unexpected object properties are stripped", () => {
    const saved = make().state; saved.secret = "not copied"; saved.reminders[0].extra = "not copied";
    const clean = C.validateState(saved);
    assert.equal(clean.secret, undefined); assert.equal(clean.reminders[0].extra, undefined);
    assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(clean))), clean);
});
test("malformed data is rejected rather than reset or partially overwritten", () => {
    for (const data of [42, [], {schema: 99, reminders: []}, {schema: 1, reminders: "bad"}]) assert.throws(() => C.validateState(data));
    const state = make().state; state.reminders[0].dueAt = "tomorrow"; assert.throws(() => C.validateState(state));
});
test("duplicate IDs and duplicate message targets are rejected", () => {
    const state = make().state; state.reminders.push({...state.reminders[0]}); assert.throws(() => C.validateState(state));
    state.reminders[1].id = "new-id"; assert.throws(() => C.validateState(state));
});
test("turning off saved previews strips them during validation", () => {
    const state = make().state; state.reminders[0].preview = "old private content";
    assert.equal(C.validateState(state).reminders[0].preview, "");
});
test("scheduler does not fire early and fires once at the boundary", () => {
    const first = make();
    assert.equal(C.advance(first.state, NOW + 59999).due.length, 0);
    const tick = C.advance(first.state, NOW + 60000);
    assert.equal(tick.due.length, 1); assert.equal(tick.state.reminders[0].status, "due");
    assert.equal(first.state.reminders[0].status, "pending");
    assert.equal(C.advance(tick.state, NOW + 70000).due.length, 0);
});
test("restart or wake catches up pending reminders without re-alerting already-due ones", () => {
    const state = C.validateState(JSON.parse(JSON.stringify(make().state)));
    const late = C.advance(state, NOW + 7 * 86400000);
    assert.equal(late.due.length, 1);
    assert.equal(C.advance(C.validateState(late.state), NOW + 8 * 86400000).due.length, 0);
});
test("snoozing a due message resets it to pending and permits one future alert", () => {
    const fired = C.advance(make().state, NOW + 60000);
    const snoozed = C.upsert(fired.state, TARGET, NOW + 960000, "", NOW + 60000);
    assert.equal(snoozed.state.reminders.length, 1); assert.equal(snoozed.reminder.status, "pending");
    assert.equal(C.advance(snoozed.state, NOW + 959999).due.length, 0);
    assert.equal(C.advance(snoozed.state, NOW + 960000).due.length, 1);
});
test("maximum reminder count blocks additions but permits rescheduling", () => {
    const state = C.freshState();
    for (let i = 0; i < C.MAX_REMINDERS; i++) state.reminders.push({...make().reminder, id: `test-${i}`, messageId: String(100000000 + i)});
    assert.throws(() => make(state));
    assert.equal(make(state, state.reminders[0]).state.reminders.length, C.MAX_REMINDERS);
});

function runtime() {
    const p = new Plugin(), writes = [], storage = new Map(); let account = OWNER;
    p.running = true; p.accountId = OWNER; p.state = make().state;
    p.userStore = {getCurrentUser: () => account ? {id: account} : null};
    p.api = {Data: {load: (_, key) => storage.get(key), save: (_, key, value) => { writes.push({key, value}); storage.set(key, structuredClone(value)); }}, UI: {showToast() {}}};
    for (const method of ["refreshDock", "refreshHighlights", "clearHighlights", "closeDialog", "clearAlerts"]) p[method] = () => {};
    return {p, writes, storage, setAccount: id => { account = id; }};
}
test("persistence is account-scoped", () => {
    const {p, writes} = runtime(); p.commit(p.state);
    assert.equal(writes[0].key, `account_${OWNER}`);
});
test("failed disk writes leave the current state untouched", () => {
    const {p} = runtime(), before = p.state;
    p.api.Data.save = () => { throw new Error("Disk full"); };
    assert.throws(() => p.commit({...p.state, reminders: []}), /Disk full/);
    assert.equal(p.state, before); assert.equal(p.state.reminders.length, 1);
});
test("account switch clears visible data and blocks stale callbacks", () => {
    const {p, writes, setAccount} = runtime(); setAccount(OTHER);
    assert.equal(p.active(OWNER), false); assert.equal(p.accountId, OTHER); assert.equal(p.state.reminders.length, 0);
    assert.throws(() => p.commit(make().state, OWNER)); assert.equal(writes.length, 0);
});
test("switching back loads that account's own saved reminders", () => {
    const {p, storage, setAccount} = runtime(); storage.set(`account_${OWNER}`, make().state);
    setAccount(OTHER); p.syncAccount(); assert.equal(p.state.reminders.length, 0);
    setAccount(OWNER); p.syncAccount(); assert.equal(p.state.reminders.length, 1);
});
test("logged-out mode cannot write or expose the previous account", () => {
    const {p, writes, setAccount} = runtime(); setAccount(null); p.syncAccount();
    assert.equal(p.accountId, null); assert.equal(p.state.reminders.length, 0); assert.equal(p.active(OWNER), false); assert.equal(writes.length, 0);
});
test("corrupt account storage is read-only and left intact", () => {
    const {p, storage, setAccount, writes} = runtime(); const corrupt = {schema: 999, reminders: []};
    storage.set(`account_${OTHER}`, corrupt); setAccount(OTHER); p.syncAccount();
    assert.ok(p.loadError); assert.equal(p.active(OTHER), false); assert.equal(writes.length, 0); assert.equal(storage.get(`account_${OTHER}`), corrupt);
});
test("scheduler persists due status before displaying notifications", () => {
    const {p} = runtime(); p.state.reminders[0].dueAt = 1000;
    const order = []; p.api.Data.save = () => order.push("save"); p.notifyDue = () => order.push("notify");
    p.tick(); clearTimeout(p.timer);
    assert.deepEqual(order, ["save", "notify"]); assert.equal(p.state.reminders[0].status, "due");
});
test("scheduler does not show an alert after a failed save", () => {
    const {p} = runtime(); p.state.reminders[0].dueAt = 1000;
    p.api.Data.save = () => { throw new Error("Disk full"); }; let alerts = 0; p.notifyDue = () => alerts++;
    p.tick(); clearTimeout(p.timer);
    assert.equal(alerts, 0); assert.equal(p.state.reminders[0].status, "pending");
});
test("large catch-up batches use a summary rather than a notification storm", () => {
    const {p} = runtime(); p.state.settings.sound = false;
    const calls = []; p.showInApp = (...args) => calls.push(args); p.showDesktop = () => {};
    p.notifyDue(Array.from({length: 12}, () => make().reminder));
    assert.equal(calls.length, 1); assert.equal(calls[0][0], "batch"); assert.match(calls[0][1], /12/);
});
test("plugin source has no runtime network clients or remote code loading", () => {
    const source = require("node:fs").readFileSync(path.resolve(__dirname, "../RemindMeLater.plugin.js"), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\brequire\s*\(|\bimport\s*\(|\beval\s*\(/);
    assert.doesNotMatch(source, /sendMessage|createMessage|markUnread|incrementMention/);
});
