/**
 * @name Remind Me Later
 * @author Microck
 * @version 1.0.2
 * @description Private, local message reminders. Right-click a message, pick a time, and jump back when it is due. No bot, server, telemetry, or external libraries.
 * @website https://github.com/Microck/remind-me-later
 * @source https://raw.githubusercontent.com/Microck/remind-me-later/main/RemindMeLater.plugin.js
 */
/* SPDX-License-Identifier: MIT
 * Runtime dependencies: BetterDiscord's BdApi and standard browser APIs only.
 * This file is both the source and the installable plugin; no build step.
 */
"use strict";

const NAME = "Remind Me Later";
const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_DELAY = 3650 * DAY;
const MAX_REMINDERS = 500;
const ID = /^\d{5,25}$/;
const PRESETS = Object.freeze([
    ["15 minutes", 15 * MINUTE], ["30 minutes", 30 * MINUTE],
    ["1 hour", 60 * MINUTE], ["1 day", DAY], ["1 week", 7 * DAY]
]);
const DEFAULTS = Object.freeze({desktop: false, desktopPreview: false, sound: true, savePreview: false, highlight: true, showButton: true, dockLeft: false});

function text(value, max) { return typeof value === "string" ? value.slice(0, max) : ""; }
function freshState() { return {schema: 1, settings: {...DEFAULTS}, reminders: []}; }
function validTarget(r) {
    return !!r && typeof r.channelId === "string" && typeof r.messageId === "string" && typeof r.guildId === "string" &&
        ID.test(r.channelId) && ID.test(r.messageId) && (r.guildId === "@me" || ID.test(r.guildId));
}
function parseDuration(input) {
    if (typeof input !== "string" || input.length > 120) throw new Error("Use a duration such as 45m, 2h 30m, or 1w 2d.");
    const value = input.trim().toLowerCase();
    const units = {s: 1000, m: MINUTE, h: 60 * MINUTE, d: DAY, w: 7 * DAY};
    const pattern = /(\d+(?:\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gy;
    let cursor = 0, total = 0, count = 0;
    while (cursor < value.length) {
        while (/\s/.test(value[cursor] || "") && cursor < value.length) cursor++;
        if (cursor === value.length) break;
        pattern.lastIndex = cursor;
        const match = pattern.exec(value);
        if (!match) throw new Error("Use units: 45m, 2h 30m, or 1w 2d. Negative values are not allowed.");
        total += Number(match[1]) * units[match[2][0]];
        cursor = pattern.lastIndex;
        count++;
    }
    if (!count || !Number.isFinite(total) || total < 1000 || total > MAX_DELAY) throw new Error("Choose between 1 second and 3,650 days.");
    return Math.round(total);
}
function localInput(timestamp) {
    const d = new Date(timestamp);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseLocalTime(value, now = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid local date and time.");
    const timestamp = new Date(value).getTime();
    // Reject calendar overflow and nonexistent spring-forward times rather than silently shifting them.
    if (!Number.isFinite(timestamp) || localInput(timestamp) !== value) throw new Error("That local time does not exist. Choose another time.");
    if (timestamp < now + 1000 || timestamp - now > MAX_DELAY) throw new Error("Choose a future time within 3,650 days.");
    return timestamp;
}
function parseMessageLink(input) {
    let url;
    try { url = new URL(String(input).trim()); } catch { throw new Error("Paste a full Discord message link."); }
    const allowed = ["discord.com", "ptb.discord.com", "canary.discord.com", "discordapp.com"];
    const match = /^\/channels\/(@me|\d{5,25})\/(\d{5,25})\/(\d{5,25})\/?$/.exec(url.pathname);
    if (url.protocol !== "https:" || !allowed.includes(url.hostname) || url.port || url.username || url.password || !match) {
        throw new Error("Use an https://discord.com/channels/server/channel/message link.");
    }
    return {guildId: match[1], channelId: match[2], messageId: match[3]};
}
function messagePath(r) {
    if (!validTarget(r)) throw new Error("Invalid message reference.");
    return `/channels/${r.guildId}/${r.channelId}/${r.messageId}`;
}
function validateState(raw) {
    if (raw === undefined || raw === null) return freshState();
    if (typeof raw !== "object" || raw.schema !== 1 || !Array.isArray(raw.reminders) || raw.reminders.length > MAX_REMINDERS) {
        throw new Error("Unrecognized reminder data. The original data has not been overwritten.");
    }
    const result = freshState(), seen = new Set(), targets = new Set();
    for (const key of Object.keys(DEFAULTS)) if (typeof raw.settings?.[key] === "boolean") result.settings[key] = raw.settings[key];
    for (const r of raw.reminders) {
        if (!validTarget(r) || typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) || seen.has(r.id) ||
            !["pending", "due"].includes(r.status) || !Number.isSafeInteger(r.dueAt) || r.dueAt <= 0 || r.dueAt > 8.64e15 ||
            !Number.isSafeInteger(r.createdAt) || r.createdAt < 0 || r.createdAt > 8.64e15) {
            throw new Error("A saved reminder is invalid. The original data has not been overwritten.");
        }
        const target = `${r.channelId}/${r.messageId}`;
        if (targets.has(target)) throw new Error("Duplicate saved reminder. The original data has not been overwritten.");
        seen.add(r.id); targets.add(target);
        result.reminders.push({id: r.id, guildId: String(r.guildId), channelId: String(r.channelId), messageId: String(r.messageId),
            dueAt: r.dueAt, createdAt: r.createdAt, status: r.status, note: text(r.note, 500),
            preview: result.settings.savePreview ? text(r.preview, 280) : ""});
    }
    return result;
}
function advance(state, now) {
    const due = [];
    const reminders = state.reminders.map(r => {
        if (r.status !== "pending" || r.dueAt > now) return r;
        const updated = {...r, status: "due"}; due.push(updated); return updated;
    });
    return {state: {...state, reminders}, due};
}
function upsert(state, target, dueAt, note = "", now = Date.now()) {
    if (!validTarget(target)) throw new Error("This message has no usable message link.");
    if (!Number.isSafeInteger(dueAt) || dueAt < now + 1000 || dueAt - now > MAX_DELAY) throw new Error("Choose a future time between 1 second and 3,650 days.");
    const previous = state.reminders.find(r => r.channelId === target.channelId && r.messageId === target.messageId);
    if (!previous && state.reminders.length >= MAX_REMINDERS) throw new Error("The limit is 500 reminders. Remove some before adding another.");
    const id = previous?.id || globalThis.crypto?.randomUUID?.() || `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
    const reminder = {id, guildId: String(target.guildId), channelId: String(target.channelId), messageId: String(target.messageId),
        dueAt, createdAt: previous?.createdAt ?? now, status: "pending", note: text(note, 500).trim(),
        preview: state.settings.savePreview ? text(target.preview || previous?.preview, 280) : ""};
    return {state: {...state, reminders: [...state.reminders.filter(r => r.id !== id), reminder]}, reminder, updated: !!previous};
}

const STYLES = `
:host { font: 14px/1.4 var(--font-primary, system-ui, sans-serif); color: #fff; }
*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.dock { position: fixed; right: 16px; bottom: 80px; z-index: 1002; display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid #3a3a3a; border-radius: 4px; padding: 0; color: #fff; background: #000; box-shadow: 0 4px 12px #0008; }
.dock.left { right: auto; left: 88px; }
.dock:hover { background: #151515; }
.dock[data-due="true"] { border-color: #fff; }
.count { position: absolute; top: -7px; right: -7px; display: grid; place-items: center; min-width: 18px; height: 18px; border: 2px solid #000; border-radius: 9px; padding: 0 4px; background: #fff; color: #000; font-size: 11px; font-weight: 700; }
.clock { font-size: 13px; font-weight: 700; line-height: 1; }
dialog { padding: 0; border: 1px solid #303030; border-radius: 8px; width: min(560px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 32px)); color: #fff; background: #000; box-shadow: 0 18px 56px #000c; overflow: auto; }
dialog::backdrop { background: #000b; }
.shell { padding: 20px; }
.header, .row, .actions, .tabs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.header { justify-content: space-between; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #292929; }
h2 { margin: 0; font-size: 18px; line-height: 1.25; } h3 { margin: 0; font-size: 14px; }
p { margin: 8px 0 12px; }
.muted { color: #a8a8ad; font-size: 12px; }
.btn { min-height: 32px; border: 1px solid #343434; border-radius: 4px; padding: 5px 10px; background: #181818; color: #fff; }
.btn:hover { background: #242424; }
.btn:active { background: #303030; }
.primary { border-color: #fff; background: #fff; color: #000; font-weight: 600; }
.primary:hover { background: #dedede; }
.danger { color: #ff8088; }
.close { min-width: 32px; border-color: transparent; background: transparent; font-size: 20px; line-height: 1; padding: 3px 8px; }
input:not([type="checkbox"]), textarea, select { width: 100%; border: 1px solid #343434; border-radius: 4px; padding: 8px 10px; color: #fff; background: #090909; }
textarea { min-height: 72px; resize: vertical; }
label.field { display: block; margin: 14px 0; }
label.field > span { display: block; margin-bottom: 6px; }
.actions { margin-top: 12px; }
.tabs { gap: 18px; margin: 12px 0; border-bottom: 1px solid #292929; }
.tab { min-height: 34px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 4px 0; background: transparent; color: #a8a8ad; }
.tab:hover { background: transparent; color: #fff; }
.tab[aria-pressed="true"] { border-bottom-color: #fff; color: #fff; }
.search { margin-bottom: 4px; }
.list { display: grid; max-height: 380px; overflow: auto; }
.card { border-bottom: 1px solid #292929; padding: 14px 0; background: transparent; overflow-wrap: anywhere; }
.card.due { box-shadow: inset 2px 0 0 #fff; padding-left: 12px; }
.card .actions { gap: 6px; }
.card .btn, .card select { font-size: 12px; padding: 6px 9px; }
.card select { width: auto; max-width: 170px; }
.preview { white-space: pre-wrap; margin: 10px 0; font-size: 13px; color: #a8a8ad; }
.note { white-space: pre-wrap; margin: 8px 0; }
.error { color: #ff8088; margin: 12px 0; }
.success { color: #7ee2a8; margin: 12px 0; }
.empty { padding: 28px 0; color: #a8a8ad; }
.setting { display: flex; gap: 10px; align-items: flex-start; padding: 11px 0; border-bottom: 1px solid #292929; }
.setting input { margin-top: 4px; accent-color: #fff; width: 16px; height: 16px; flex: 0 0 auto; }
.setting span { display: block; }
.settings-panel { padding: 4px; }
[hidden] { display: none !important; }
@media (max-width: 500px) { .shell { padding: 16px; } .dock { bottom: 72px; right: 10px; } .list { max-height: 48vh; } }
`;
const CHANNEL_STYLE = `a[data-lr-due] { box-shadow: inset 3px 0 0 #eeb451 !important; border-radius: 4px; }
a[data-lr-due]:focus-visible { outline: 2px solid #eeb451; }`;

module.exports = class RemindMeLater {
    constructor() {
        this.state = freshState(); this.accountId = null; this.running = false; this.loadError = "";
        this.listeners = new Set(); this.notifications = new Map(); this.nativeNotifications = new Set();
        this.audio = new Set(); this.unpatch = []; this.timer = null; this.observerTimer = null;
        this.accountChanged = () => { if (this.running) this.tick(); };
        this.wake = () => { if (this.running) this.tick(); };
    }
    start() {
        if (this.running) return;
        this.api = globalThis.BdApi;
        if (!this.api?.Data?.load || !this.api?.ContextMenu?.patch || !this.api?.ContextMenu?.buildItem) throw new Error("Remind Me Later requires BetterDiscord with the Data and ContextMenu APIs.");
        this.running = true;
        try {
            this.userStore = this.getStore("UserStore");
            this.channelStore = this.getStore("ChannelStore");
            this.guildStore = this.getStore("GuildStore");
            if (!this.userStore?.getCurrentUser) throw new Error("Discord's UserStore is unavailable. Update BetterDiscord and reload Discord.");
            this.mount();
            this.api.DOM?.addStyle(NAME, CHANNEL_STYLE);
            // Discord's private menu names change. The message payload is the stable boundary.
            this.unpatch.push(this.api.ContextMenu.patch(/.*/, (tree, props) => this.patchMessageMenu(tree, props)));
            this.userStore.addChangeListener?.(this.accountChanged);
            window.addEventListener("focus", this.wake);
            document.addEventListener("visibilitychange", this.wake);
            this.observer = new MutationObserver(() => {
                if (!this.running || this.observerTimer || !this.state.settings.highlight || !this.state.reminders.some(r => r.status === "due")) return;
                this.observerTimer = setTimeout(() => { this.observerTimer = null; if (this.running) this.refreshHighlights(); }, 250);
            });
            this.observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["href"]});
            this.tick();
        } catch (error) { this.stop(); throw error; }
    }
    stop() {
        this.running = false;
        clearTimeout(this.timer); clearTimeout(this.observerTimer);
        this.timer = this.observerTimer = null;
        this.observer?.disconnect(); this.observer = null;
        try { this.userStore?.removeChangeListener?.(this.accountChanged); } catch { /* Store may have been replaced. */ }
        if (typeof window !== "undefined") window.removeEventListener("focus", this.wake);
        if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", this.wake);
            this.clearHighlights();
        }
        for (const undo of this.unpatch.splice(0)) { try { undo?.(); } catch { /* Already unpatched. */ } }
        this.closeDialog(); this.clearAlerts();
        this.host?.remove(); this.host = this.shadow = this.dock = null;
        this.api?.DOM?.removeStyle(NAME);
        this.accountId = null; this.state = freshState(); this.loadError = "";
        this.emit(); this.listeners.clear();
    }
    getStore(name) { try { return this.api.Webpack?.getStore?.(name); } catch { return null; } }
    currentAccount() {
        try { const id = this.userStore?.getCurrentUser?.()?.id; return typeof id === "string" && ID.test(id) ? id : null; }
        catch { return null; }
    }
    syncAccount() {
        const id = this.currentAccount();
        if (id === this.accountId) return false;
        this.closeDialog(); this.clearAlerts(); this.clearHighlights();
        this.accountId = id; this.state = freshState(); this.loadError = "";
        if (id) {
            try { this.state = validateState(this.api.Data.load(NAME, `account_${id}`)); }
            catch (error) { this.loadError = error.message || "Could not load reminders. Existing data has not been overwritten."; this.toast(this.loadError, "error"); }
        }
        this.emit(); return true;
    }
    active(owner = this.accountId) {
        if (!this.running) return false;
        this.syncAccount();
        return this.running && !!owner && owner === this.accountId && !this.loadError;
    }
    commit(next, owner = this.accountId) {
        if (!this.active(owner)) throw new Error("Reminders are paused, unavailable, or the Discord account changed.");
        const clean = validateState(next);
        // Persist before exposing the change or alerting. A failed write must not look successful.
        this.api.Data.save(NAME, `account_${owner}`, clean);
        this.state = clean;
        this.emit();
    }
    tick() {
        clearTimeout(this.timer); this.timer = null;
        if (!this.running) return;
        this.syncAccount();
        if (this.accountId && !this.loadError) {
            const result = advance(this.state, Date.now());
            if (result.due.length) {
                try {
                    this.commit(result.state);
                    this.notifyDue(result.due);
                } catch (error) { this.report(error); }
            }
            this.refreshDock(); this.refreshHighlights();
        }
        const future = this.state.reminders.filter(r => r.status === "pending").map(r => r.dueAt);
        const wait = future.length ? Math.max(1000, Math.min(30_000, Math.min(...future) - Date.now())) : 30_000;
        this.timer = setTimeout(() => this.tick(), this.loadError ? 30_000 : wait);
    }
    emit() {
        this.refreshDock();
        if (typeof document !== "undefined") this.refreshHighlights();
        for (const fn of this.listeners) { try { fn(); } catch { /* A closed panel must not interrupt persistence. */ } }
    }
    toast(message, type = "info") { try { this.api?.UI?.showToast?.(message, {type, timeout: 5000}); } catch { /* The dock remains usable. */ } }
    report(error) {
        const now = Date.now();
        if (!this.lastErrorAt || now - this.lastErrorAt > 15_000) {
            this.lastErrorAt = now; this.toast(error?.message || "Remind Me Later could not finish that action.", "error");
        }
    }
    run(owner, action) {
        if (!this.active(owner)) { this.toast("That reminder belongs to a different account, or the plugin is paused.", "error"); return; }
        try { action(); } catch (error) { this.report(error); }
    }
    capture(message, channel) {
        this.syncAccount();
        const channelId = String(message?.channel_id || channel?.id || "");
        const actualChannel = channel || this.channelStore?.getChannel?.(channelId);
        const target = {owner: this.accountId, channelId, messageId: String(message?.id || ""),
            guildId: String(actualChannel?.guild_id || message?.guild_id || "@me"),
            preview: this.state.settings.savePreview ? text(message?.content, 280) : ""};
        return validTarget(target) && target.owner ? target : null;
    }
    patchMessageMenu(tree, props) {
        if (!this.running || !props?.message || !tree?.props) return;
        try {
            const target = this.capture(props.message, props.channel);
            if (!target || this.loadError) return;
            const existing = this.state.reminders.find(r => r.channelId === target.channelId && r.messageId === target.messageId);
            const items = PRESETS.map(([label, delay], i) => ({id: `lr-preset-${i}`, label: `In ${label}`, action: () => this.run(target.owner, () => this.schedule(target, Date.now() + delay, existing?.note || ""))}));
            items.push({id: "lr-custom", label: "Custom…", action: () => this.run(target.owner, () => this.openCustom({...target, note: existing?.note || ""}))});
            if (existing) items.push({id: "lr-cancel", label: "Cancel this reminder", action: () => this.run(target.owner, () => this.remove(existing.id, target.owner))});
            items.push({type: "separator"}, {id: "lr-manage", label: "Manage reminders…", action: () => this.run(target.owner, () => this.openManager())});
            const submenu = this.api.ContextMenu.buildItem({type: "submenu", id: "lr-remind", label: existing ? "Reschedule reminder" : "Remind me", items});
            const children = tree.props.children;
            if (Array.isArray(children)) {
                if (!children.some(c => c?.props?.id === "lr-remind")) children.push(submenu);
            } else tree.props.children = [children, submenu].filter(Boolean);
        } catch (error) { this.report(error); }
    }
    schedule(target, dueAt, note = "") {
        const owner = target.owner || this.accountId;
        if (!this.active(owner)) throw new Error("The Discord account changed. Reopen the message menu.");
        const result = upsert(this.state, target, dueAt, note);
        this.commit(result.state, owner);
        this.closeAlert(result.reminder.id);
        this.tick();
        this.toast(`${result.updated ? "Reminder updated" : "Reminder set"}: ${new Date(dueAt).toLocaleString()}`, "success");
        return result.reminder;
    }
    remove(id, owner = this.accountId) {
        if (!this.active(owner)) return;
        this.commit({...this.state, reminders: this.state.reminders.filter(r => r.id !== id)}, owner);
        this.closeAlert(id); this.tick();
    }
    snooze(id, delay, owner = this.accountId) {
        if (!this.active(owner)) return;
        const r = this.state.reminders.find(item => item.id === id);
        if (r) this.schedule({...r, owner}, Date.now() + delay, r.note);
    }
    locationLabel(r) {
        try {
            const channel = this.channelStore?.getChannel?.(r.channelId);
            if (r.guildId === "@me") return channel?.name ? `DM · ${channel.name}` : "Direct message";
            const guild = this.guildStore?.getGuild?.(r.guildId);
            return [guild?.name, channel?.name ? `#${channel.name}` : "Channel"].filter(Boolean).join(" · ");
        } catch { return r.guildId === "@me" ? "Direct message" : "Channel message"; }
    }
    openMessage(r, owner = this.accountId) {
        this.run(owner, () => {
            const path = messagePath(r);
            let router;
            try { router = this.api.Webpack?.getByKeys?.("transitionTo"); } catch { /* Optional private Discord module. */ }
            if (typeof router?.transitionTo === "function") {
                this.closeDialog(); window.focus(); router.transitionTo(path);
            } else {
                this.copyLink(r, owner);
                this.toast("Discord's message navigation is unavailable. The message link was copied instead.");
            }
        });
    }
    copyLink(r, owner = this.accountId) {
        if (!this.active(owner)) return;
        const value = `https://discord.com${messagePath(r)}`;
        // Synchronous clipboard fallback runs inside the user's click. No external navigation.
        const input = document.createElement("textarea"); input.value = value;
        const parent = this.dialog || document.body;
        input.style.cssText = "position:fixed;left:-10000px;top:0;";
        parent.append(input); input.focus(); input.select();
        let copied = false;
        try { copied = document.execCommand("copy"); } catch { /* Fall back to Clipboard API. */ }
        input.remove();
        if (copied) this.toast("Message link copied.", "success");
        else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(() => {
            if (this.active(owner)) this.toast("Message link copied.", "success");
        }).catch(() => { if (this.active(owner)) this.toast("Clipboard unavailable. Use Discord's Copy Message Link action.", "error"); });
        else this.toast("Clipboard unavailable. Use Discord's Copy Message Link action.", "error");
    }
    notifyDue(due) {
        if (!due.length || !this.active()) return;
        const owner = this.accountId;
        if (due.length <= 3) for (const r of due) this.notifyOne(r, owner);
        else {
            const title = `${due.length} message reminders are due`;
            this.showInApp("batch", title, "Your reminders are waiting in the local inbox.", [
                {label: "Open reminders", onClick: () => this.run(owner, () => this.openManager("due"))}
            ]);
            this.showDesktop(title, "Open your local reminder inbox to review them.", () => this.run(owner, () => this.openManager("due")), "batch");
        }
        if (this.state.settings.sound) this.chime();
    }
    notifyOne(r, owner) {
        const body = [this.locationLabel(r), r.note, r.preview].filter(Boolean).join("\n");
        this.showInApp(r.id, "Message reminder", body, [
            {label: "Open message", onClick: () => this.openMessage(r, owner)},
            {label: "Snooze 15m", onClick: () => this.run(owner, () => this.snooze(r.id, 15 * MINUTE, owner))},
            {label: "Done", onClick: () => this.run(owner, () => this.remove(r.id, owner))}
        ]);
        this.showDesktop("Message reminder", this.state.settings.desktopPreview ? body : "A private message reminder is due. Click to open the message.", () => this.openMessage(r, owner), r.id);
    }
    showInApp(id, title, content, actions) {
        try {
            const handle = this.api.UI?.showNotification?.({id: `${NAME}-${id}`, title, content,
                duration: 15_000, actions, onClose: () => this.notifications.delete(id)});
            if (handle) { this.notifications.set(id, handle); return; }
        } catch { /* Older BetterDiscord: still show a toast and keep the due badge. */ }
        this.toast(`${title}. Open the Reminders button to review.`);
    }
    showDesktop(title, body, onClick, id = "test") {
        if (!this.state.settings.desktop || typeof Notification === "undefined" || Notification.permission !== "granted") return;
        try {
            for (const old of [...this.nativeNotifications]) if (old._lrId === id) { old.onclick = null; old.close(); this.nativeNotifications.delete(old); }
            const n = new Notification(title, {body, silent: true, tag: `${NAME}-${id}`});
            n._lrId = id; this.nativeNotifications.add(n);
            n.onclick = () => { n.close(); onClick(); };
            n.onclose = () => this.nativeNotifications.delete(n);
        } catch { /* OS notifications can be blocked; the local inbox is authoritative. */ }
    }
    closeAlert(id) {
        try { this.notifications.get(id)?.close?.(); } catch { /* Already gone. */ }
        this.notifications.delete(id);
        for (const n of [...this.nativeNotifications]) if (n._lrId === id) {
            try { n.onclick = null; n.close(); } catch { /* Already gone. */ }
            this.nativeNotifications.delete(n);
        }
    }
    clearAlerts() {
        for (const handle of [...this.notifications.values()]) { try { handle?.close?.(); } catch { /* Closed. */ } }
        this.notifications.clear();
        for (const n of [...this.nativeNotifications]) { try { n.onclick = null; n.close(); } catch { /* Closed. */ } }
        this.nativeNotifications.clear();
        for (const ctx of this.audio) { try { ctx.close().catch(() => {}); } catch { /* Closed. */ } }
        this.audio.clear();
    }
    async chime() {
        const owner = this.accountId;
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio || !this.active(owner)) return;
        let ctx;
        try {
            ctx = new Audio(); this.audio.add(ctx);
            await ctx.resume();
            if (!this.active(owner) || !this.audio.has(ctx)) return;
            const now = ctx.currentTime;
            [740, 988].forEach((frequency, i) => {
                const osc = ctx.createOscillator(), gain = ctx.createGain();
                osc.type = "sine"; osc.frequency.value = frequency;
                gain.gain.setValueAtTime(0, now + i * .15);
                gain.gain.linearRampToValueAtTime(.08, now + i * .15 + .012);
                gain.gain.exponentialRampToValueAtTime(.001, now + i * .15 + .22);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(now + i * .15); osc.stop(now + i * .15 + .24);
                if (i === 1) osc.onended = () => { this.audio.delete(ctx); ctx.close().catch(() => {}); };
            });
        } catch { if (ctx) { this.audio.delete(ctx); try { await ctx.close(); } catch { /* Closed. */ } } }
    }
    clearHighlights() { document.querySelectorAll("[data-lr-due]").forEach(el => el.removeAttribute("data-lr-due")); }
    refreshHighlights() {
        const counts = new Map();
        if (this.running && this.accountId && this.currentAccount() === this.accountId && this.state.settings.highlight) {
            for (const r of this.state.reminders) if (r.status === "due") counts.set(r.channelId, (counts.get(r.channelId) || 0) + 1);
        }
        document.querySelectorAll("a[href^='/channels/'], a[data-lr-due]").forEach(el => {
            const route = /^\/channels\/(?:@me|\d+)\/(\d+)\/?$/.exec(el.getAttribute("href") || "");
            const n = route ? counts.get(route[1]) : 0;
            if (n) { if (el.getAttribute("data-lr-due") !== String(n)) el.setAttribute("data-lr-due", String(n)); }
            else if (el.hasAttribute("data-lr-due")) el.removeAttribute("data-lr-due");
        });
    }
    element(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === "class") el.className = value;
            else if (key === "text") el.textContent = value;
            else if (["value", "checked", "disabled", "hidden"].includes(key)) el[key] = value;
            else el.setAttribute(key, String(value));
        }
        for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) el.append(typeof child === "string" ? document.createTextNode(child) : child);
        return el;
    }
    button(label, onClick, classes = "") { return this.element("button", {type: "button", class: `btn ${classes}`, text: label, onClick}); }
    mount() {
        this.host = this.element("div", {id: "remind-me-later-host"});
        this.shadow = this.host.attachShadow({mode: "open"});
        this.shadow.append(this.element("style", {text: STYLES}));
        this.dock = this.element("button", {type: "button", class: "dock", onClick: () => this.openManager(), title: "Private local reminders"});
        this.shadow.append(this.dock); document.body.append(this.host); this.refreshDock();
    }
    refreshDock() {
        if (!this.dock) return;
        this.dock.hidden = !this.running || !this.accountId || !this.state.settings.showButton;
        const due = this.state.reminders.filter(r => r.status === "due").length;
        this.dock.className = `dock${this.state.settings.dockLeft ? " left" : ""}`;
        this.dock.setAttribute("data-due", String(due > 0));
        this.dock.setAttribute("aria-label", this.loadError ? "Reminders: storage error" : `Reminders: ${due} due, ${this.state.reminders.length - due} upcoming`);
        this.dock.replaceChildren(this.element("span", {class: "clock", "aria-hidden": "true", text: this.loadError ? "!" : "R"}));
        if (due) this.dock.append(this.element("span", {class: "count", text: String(due)}));
    }
    openDialog(title) {
        this.closeDialog();
        const dialog = this.element("dialog", {"aria-label": title});
        const shell = this.element("div", {class: "shell"});
        const heading = this.element("h2", {text: title});
        const close = this.button("×", () => this.closeDialog(), "close"); close.setAttribute("aria-label", "Close");
        shell.append(this.element("div", {class: "header"}, heading, close)); dialog.append(shell);
        dialog.addEventListener("cancel", event => { event.preventDefault(); this.closeDialog(); });
        dialog.addEventListener("click", event => {
            if (event.target !== dialog) return;
            const r = dialog.getBoundingClientRect();
            if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.closeDialog();
        });
        this.shadow.append(dialog); this.dialog = dialog;
        dialog.showModal(); return shell;
    }
    closeDialog() {
        this.dialogCleanup?.(); this.dialogCleanup = null;
        if (this.dialog) { try { this.dialog.close(); } catch { /* Removed. */ } this.dialog.remove(); this.dialog = null; }
    }
    openManager(initialFilter = "all") {
        this.syncAccount();
        if (!this.running || !this.accountId) { this.toast("Sign in to Discord and enable Remind Me Later first.", "error"); return; }
        const owner = this.accountId;
        const root = this.openDialog("Your reminder inbox");
        if (this.loadError) { root.append(this.element("p", {class: "error", text: this.loadError}), this.element("p", {class: "muted", text: "Fix or back up the Remind Me Later.config.json file before reloading. The plugin will not replace unreadable data."})); return; }
        root.append(this.element("p", {class: "muted", text: "Nothing is sent to anyone. Due reminders stay here until you snooze or finish them."}));
        const summary = this.element("div", {class: "muted", role: "status", "aria-live": "polite"});
        root.append(summary, this.element("div", {class: "row"}, this.button("Add message link", () => this.openCustom()), this.button("Settings", () => this.openSettings())));
        let filter = initialFilter, query = "";
        const tabs = this.element("div", {class: "tabs", "aria-label": "Filter reminders"});
        const list = this.element("div", {class: "list"});
        const search = this.element("input", {type: "search", class: "search", placeholder: "Search notes or channel names…", "aria-label": "Search reminders", onInput: e => { query = e.target.value.toLowerCase(); render(); }});
        const render = () => {
            if (!this.active(owner)) return;
            const due = this.state.reminders.filter(r => r.status === "due").length;
            summary.textContent = `${due} due · ${this.state.reminders.length - due} upcoming`;
            for (const tab of tabs.children) tab.setAttribute("aria-pressed", String(tab.dataset.filter === filter));
            const reminders = this.state.reminders.filter(r => (filter === "all" || (filter === "due" ? r.status === "due" : r.status === "pending")) &&
                [r.note, r.preview, this.locationLabel(r)].some(v => v.toLowerCase().includes(query)))
                .sort((a, b) => Number(b.status === "due") - Number(a.status === "due") || a.dueAt - b.dueAt);
            list.replaceChildren();
            if (!reminders.length) list.append(this.element("div", {class: "empty", text: "Nothing here. Right-click a message → Remind me, or paste a message link."}));
            for (const r of reminders) list.append(this.reminderCard(r, owner));
        };
        for (const [id, label] of [["all", "All"], ["due", "Due"], ["upcoming", "Upcoming"]]) {
            const tab = this.button(label, () => { filter = id; render(); }, "tab"); tab.dataset.filter = id; tabs.append(tab);
        }
        root.append(tabs, search, list, this.element("p", {class: "muted", text: "Discord must be running to alert you. Missed reminders appear when you return. Opening a message does not mark its reminder done."}));
        this.listeners.add(render); this.dialogCleanup = () => this.listeners.delete(render); render();
    }
    reminderCard(r, owner) {
        const card = this.element("article", {class: `card ${r.status}`});
        card.append(this.element("h3", {text: this.locationLabel(r)}), this.element("div", {class: "muted", text: `${r.status === "due" ? "Due" : "Scheduled"} · ${new Date(r.dueAt).toLocaleString()}`}));
        if (r.note) card.append(this.element("div", {class: "note", text: r.note}));
        if (r.preview) card.append(this.element("div", {class: "preview", text: r.preview}));
        const snooze = this.element("select", {"aria-label": "Snooze or reschedule reminder", onChange: e => {
            const value = e.target.value; e.target.value = "";
            this.run(owner, () => { if (value === "custom") this.openCustom({...r, owner}); else if (value) this.snooze(r.id, Number(value), owner); });
        }}, this.element("option", {value: "", text: r.status === "due" ? "Snooze…" : "Reschedule…"}));
        for (const [label, delay] of PRESETS) snooze.append(this.element("option", {value: delay, text: label}));
        snooze.append(this.element("option", {value: "custom", text: "Custom…"}));
        card.append(this.element("div", {class: "actions"}, this.button("Open message", () => this.openMessage(r, owner), "primary"),
            snooze, this.button("Edit", () => this.run(owner, () => this.openCustom({...r, owner}))),
            this.button("Copy link", () => this.run(owner, () => this.copyLink(r, owner))),
            this.button(r.status === "due" ? "Done" : "Cancel", () => this.run(owner, () => this.remove(r.id, owner)))));
        return card;
    }
    openCustom(target = null) {
        this.syncAccount();
        const owner = target?.owner || this.accountId;
        if (!this.active(owner)) return;
        const root = this.openDialog(target ? "Remind me about this message" : "Add a message reminder");
        const form = this.element("form");
        const field = (label, input) => this.element("label", {class: "field"}, this.element("span", {text: label}), input);
        let link;
        if (!target) { link = this.element("input", {type: "url", required: "", placeholder: "https://discord.com/channels/…", "aria-label": "Discord message link"}); form.append(field("Message link", link)); }
        else form.append(this.element("p", {class: "muted", text: this.locationLabel(target)}));
        const mode = this.element("select", {"aria-label": "Reminder timing"}, this.element("option", {value: "duration", text: "In a duration"}), this.element("option", {value: "date", text: "At a date and time"}));
        const duration = this.element("input", {type: "text", value: "15m", maxlength: "120", placeholder: "2h 30m", "aria-label": "Duration"});
        const date = this.element("input", {type: "datetime-local", value: localInput(target?.dueAt > Date.now() + 1000 ? target.dueAt : Date.now() + 15 * MINUTE), "aria-label": "Local date and time"});
        const durationField = field("Duration · examples: 45m, 2h 30m, 1w 2d", duration);
        const dateField = field(`Local time · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, date); dateField.hidden = true;
        mode.addEventListener("change", () => { durationField.hidden = mode.value !== "duration"; dateField.hidden = mode.value !== "date"; });
        // Editing an existing reminder preserves its future time unless the user changes it.
        if (target?.dueAt > Date.now() + 1000) { mode.value = "date"; durationField.hidden = true; dateField.hidden = false; }
        const note = this.element("textarea", {value: target?.note || "", maxlength: "500", placeholder: "Optional private note", "aria-label": "Private note"});
        const error = this.element("div", {class: "error", role: "alert"});
        const submit = this.element("button", {class: "btn primary", type: "submit", text: "Set reminder"});
        form.append(field("When", mode), durationField, dateField, field("Private note (optional)", note),
            this.element("p", {class: "muted", text: "Stored only on this device. 1 day means 24 hours; 1 week means 168 hours. Date/time uses your computer's timezone."}),
            error, this.element("div", {class: "actions"}, submit, this.button("Cancel", () => this.closeDialog())));
        form.addEventListener("submit", event => {
            event.preventDefault();
            try {
                if (!this.active(owner)) throw new Error("The Discord account changed. Open the reminder again.");
                const selected = target || {...parseMessageLink(link.value), owner};
                const now = Date.now();
                // datetime-local shows minutes. Preserve the original seconds when editing only a note.
                const unchangedTime = target?.dueAt && date.value === localInput(target.dueAt);
                const dueAt = mode.value === "date" ? (unchangedTime ? target.dueAt : parseLocalTime(date.value, now)) : now + parseDuration(duration.value);
                this.schedule(selected, dueAt, note.value); this.closeDialog();
            } catch (e) { error.textContent = e.message; }
        });
        root.append(form); (link || (mode.value === "date" ? date : duration)).focus();
    }
    openSettings() {
        if (!this.active()) return;
        const root = this.openDialog("Reminder settings");
        this.renderSettings(root, this.accountId);
    }
    getSettingsPanel() {
        const host = this.element("div"); const shadow = host.attachShadow({mode: "open"});
        shadow.append(this.element("style", {text: STYLES}));
        const content = this.element("div", {class: "settings-panel"}); shadow.append(content);
        const refresh = () => {
            content.replaceChildren();
            if (!this.running || !this.accountId || this.currentAccount() !== this.accountId || this.loadError) {
                content.append(this.element("p", {text: this.loadError || "Enable Remind Me Later and sign in to Discord to edit settings."})); return;
            }
            this.renderSettings(content, this.accountId);
        };
        refresh();
        // Settings are also refreshed on account switch. Release detached panels on the next state change.
        let mounted = false;
        const watch = () => { if (host.isConnected) mounted = true; else if (mounted) { this.listeners.delete(watch); return; } refresh(); };
        this.listeners.add(watch); return host;
    }
    renderSettings(root, owner) {
        root.append(this.element("p", {class: "muted", text: "Settings and reminders are separate for each Discord account. No bot, no telemetry, no cloud sync."}));
        const settings = [
            ["sound", "Local chime", "Play a short generated sound when reminders become due."],
            ["desktop", "Desktop notifications", "Optional OS notifications. Discord must be running; system Focus / Do Not Disturb may hide them."],
            ["desktopPreview", "Show details in desktop notifications", "May expose your note and saved preview on the lock screen. Off by default."],
            ["savePreview", "Save message previews", "Opt in to store up to 280 characters from messages you explicitly select. Turning this off erases existing previews."],
            ["highlight", "Highlight chats with due reminders", "An amber stripe on visible channel links; never changes Discord's real unread or mention state."],
            ["showButton", "Show reminder button", "Keep the small R button visible over Discord. The inbox remains available from message menus and this settings panel."],
            ["dockLeft", "Place the reminder button on the left", "Moves the private reminder button away from the bottom-right corner."]
        ];
        for (const [key, label, help] of settings) {
            const checkbox = this.element("input", {type: "checkbox", checked: this.state.settings[key]});
            checkbox.addEventListener("change", async () => {
                const requested = checkbox.checked;
                try {
                    if (!this.active(owner)) return;
                    if (key === "desktop" && requested) {
                        if (typeof Notification === "undefined") throw new Error("Desktop notifications are not available in this Discord installation.");
                        let permission = Notification.permission;
                        if (permission === "default") permission = await Notification.requestPermission();
                        if (!this.active(owner)) return;
                        if (permission !== "granted") throw new Error("Desktop notifications are blocked. Allow them in system settings; in-app reminders still work.");
                    }
                    let reminders = this.state.reminders;
                    if (key === "savePreview" && !requested) reminders = reminders.map(r => ({...r, preview: ""}));
                    this.commit({...this.state, settings: {...this.state.settings, [key]: requested}, reminders}, owner);
                    if (key === "savePreview" && !requested) this.clearAlerts();
                    if ((key === "desktop" || key === "desktopPreview") && !requested) {
                        for (const n of this.nativeNotifications) { n.onclick = null; n.close(); } this.nativeNotifications.clear();
                    }
                } catch (error) { checkbox.checked = this.state.settings[key]; this.report(error); }
            });
            root.append(this.element("label", {class: "setting"}, checkbox, this.element("div", {}, this.element("span", {text: label}), this.element("span", {class: "muted", text: help}))));
        }
        root.append(this.element("div", {class: "actions"}, this.button("Open reminder inbox", () => this.run(owner, () => this.openManager())),
            this.button("Test alert", () => this.run(owner, () => {
                this.showInApp("test", "Remind Me Later test", "This is private. No message was sent and no reminder was saved.", [{label: "Open reminders", onClick: () => this.run(owner, () => this.openManager())}]);
                this.showDesktop("Remind Me Later test", "Your private desktop notification is working.", () => this.run(owner, () => this.openManager()));
                if (this.state.settings.sound) this.chime();
            })), this.button("Delete all reminders…", () => this.run(owner, () => this.confirmDelete(owner)), "danger")));
        root.append(this.element("p", {class: "muted", text: "Local storage is plain JSON in BetterDiscord's plugin data, not encrypted. Anyone with access to this computer or other plugins may be able to read it. Reminders do not sync to mobile or other devices."}));
    }
    confirmDelete(owner) {
        const root = this.openDialog("Delete all reminders?");
        root.append(this.element("p", {text: "This deletes reminders, notes, and saved previews for the current Discord account on this device. It cannot be undone. Other accounts are not affected."}),
            this.element("div", {class: "actions"}, this.button("Delete reminders", () => this.run(owner, () => {
                this.commit({...this.state, reminders: []}, owner); this.clearAlerts(); this.closeDialog(); this.tick();
            }), "danger"), this.button("Keep reminders", () => this.closeDialog())));
    }
};
// Pure helpers exposed for dependency-free automated tests; unused by BetterDiscord.
module.exports.testing = Object.freeze({parseDuration, parseLocalTime, localInput, parseMessageLink, messagePath, validTarget, validateState, freshState, advance, upsert, PRESETS, MAX_DELAY, MAX_REMINDERS});
