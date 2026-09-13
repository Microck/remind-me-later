#!/usr/bin/env node
"use strict";
/**
 * Explicit, user-run publishing helper. NOT loaded by the Discord plugin.
 * Requires Git, Node.js 22+, and GitHub CLI (gh) already installed.
 * Creates or updates the PUBLIC source repository.
 * No tokens are read or printed by this script; authentication is handled by gh.
 */
const {spawnSync} = require("node:child_process");
const {existsSync, realpathSync} = require("node:fs");
const path = require("node:path");
const root = realpathSync(path.join(__dirname, ".."));
const name = "remind-me-later";
const expectedOwner = "Microck";
const files = ["RemindMeLater.plugin.js", "README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "TESTING.md", "PUBLISHING.md",
    "package.json", ".gitignore", "scripts/publish.cjs", "test/core.test.cjs", "test/mock-discord.html", "test/ui_smoke.py", ".github/workflows/test.yml"];

function run(command, args, capture = false, optional = false) {
    const r = spawnSync(command, args, {cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: false});
    if (r.error || r.status !== 0) {
        if (optional) return null;
        if (r.error?.code === "ENOENT") throw new Error(`${command} is not installed or is not on PATH.`);
        throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed. ${capture ? (r.stderr || "").trim() : "See output above."}`);
    }
    return capture ? r.stdout.trim() : "";
}
function main() {
    console.log(`Publishing a PUBLIC repository: ${expectedOwner}/${name}`);
    console.log("Only the explicit source-file allowlist is committed. Reminder data and local config files are excluded.");
    for (const f of files) if (!existsSync(path.join(root, f))) throw new Error(`Missing project file: ${f}`);
    run("git", ["--version"]); run("gh", ["--version"]);
    run("gh", ["auth", "status"]);
    const owner = run("gh", ["api", "user", "--jq", ".login"], true);
    if (owner.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error(`gh is signed in as ${owner}, not ${expectedOwner}. Switch accounts with gh auth switch.`);
    run(process.execPath, ["--check", "RemindMeLater.plugin.js"]);
    run(process.execPath, ["--test", "test/core.test.cjs"]);
    const repository = `${owner}/${name}`;
    const top = run("git", ["rev-parse", "--show-toplevel"], true, true);
    if (top && realpathSync(top) !== root) throw new Error("This folder is inside a different Git repository. Extract it outside that repository before publishing.");
    if (!top) run("git", ["init", "-b", "main"]);
    const gitEmail = run("git", ["config", "user.email"], true, true);
    const gitName = run("git", ["config", "user.name"], true, true);
    if (!gitEmail || !gitName) throw new Error("Set your local Git commit identity: git config user.name <name> and git config user.email <email-or-GitHub-noreply-address>.");
    const existing = run("gh", ["repo", "view", repository, "--json", "nameWithOwner,isPrivate", "--jq", ".isPrivate"], true, true);
    if (existing === "true") throw new Error("A PRIVATE repository already exists with that name. Its visibility will not be changed.");
    const origin = run("git", ["remote", "get-url", "origin"], true, true);
    const allowedOrigins = [`https://github.com/${repository}.git`, `https://github.com/${repository}`, `git@github.com:${repository}.git`];
    if (origin && !allowedOrigins.some(x => x.toLowerCase() === origin.toLowerCase())) throw new Error("The existing origin remote is not the intended repository. No remote was changed.");
    const staged = run("git", ["diff", "--cached", "--name-only"], true);
    if (staged) throw new Error("There are already staged files. Commit or unstage them before running this script.");
    // Refuse to publish arbitrary existing local history. Only our allowlisted files are permitted.
    const hasHead = run("git", ["rev-parse", "--verify", "HEAD"], true, true);
    if (hasHead) {
        const historyFiles = run("git", ["log", "--all", "--format=", "--name-only"], true).split(/\r?\n/).filter(Boolean);
        const unknown = [...new Set(historyFiles)].filter(f => !files.includes(f));
        if (unknown.length) throw new Error(`Existing history contains files outside the publishing allowlist: ${unknown.join(", ")}. Use a clean extracted project.`);
    }
    if (existing !== null && !origin) throw new Error("A repository already exists with that name. This script will not attach an unrelated local project to it. Use a clean clone or choose a new name in the script.");
    run("git", ["add", "--", ...files]);
    const changed = run("git", ["diff", "--cached", "--name-only"], true);
    if (changed) run("git", ["commit", "-m", "publish remind me later"]);
    const branch = run("git", ["branch", "--show-current"], true);
    if (!branch) throw new Error("Detached HEAD is not supported. Check out a branch before publishing.");
    if (existing === null) {
        run("gh", ["repo", "create", repository, "--public", "--source", root, "--remote", "origin", "--push", "--description", "private, local message reminders for BetterDiscord. no bot, no cloud, no real pings."]);
    } else run("git", ["push", "-u", "origin", branch]);
    console.log("\nVerified public repository:");
    console.log(run("gh", ["repo", "view", repository, "--json", "url,isPrivate", "--jq", "{url, isPrivate}"], true));
}
if (require.main === module) { try { main(); } catch (e) { console.error(`\nPublishing stopped: ${e.message}`); process.exitCode = 1; } }
