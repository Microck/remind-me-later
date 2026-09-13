"""UI smoke tests in Chromium with mocked Discord/BetterDiscord APIs.

Run: python -m pip install playwright && python -m playwright install chromium
     python test/ui_smoke.py
Not a substitute for testing against the real Discord desktop client.
"""
from pathlib import Path
import json
import os
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
results = []

def passed(name):
    results.append(name)
    print(f"PASS {name}")

with sync_playwright() as pw:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = pw.chromium.launch(headless=True, executable_path=executable, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1280, "height": 900}, timezone_id="Europe/Madrid")
    page = context.new_page()
    page.set_default_timeout(6000)
    requests = []
    page.on("request", lambda request: requests.append(request.url))
    page.set_content((ROOT / "test/mock-discord.html").read_text())
    page.add_script_tag(content=(ROOT / "RemindMeLater.plugin.js").read_text())
    page.evaluate("window.plugin = new module.exports(); plugin.start(); plugin.state.settings.sound = false")
    assert page.evaluate("typeof BdApi.React") == "undefined"
    expect(page.get_by_role("button", name="Reminders: 0 due, 0 upcoming")).to_be_visible()
    assert page.evaluate("fixture.patches.size") == 1
    assert page.evaluate("[...fixture.patches.keys()][0]") == "message"
    passed("start installs context-menu hook and private dock")

    # BetterDiscord now passes menu-render props. Recover the message from props.target and MessageStore.
    page.evaluate("""() => {
      const messageElement = document.createElement('div');
      messageElement.id = 'chat-messages-333333333333333333-444444444444444444';
      const messageTarget = document.createElement('span');
      messageElement.append(messageTarget);
      document.body.append(messageElement);
      fixture.tree = {props:{children:[]}};
      fixture.messageMenuPatch = [...fixture.patches.values()][0];
      fixture.otherTree = {props:{children:[]}};
      fixture.messageMenuPatch(fixture.otherTree, {target:document.body});
      fixture.messageMenuPatch(fixture.tree, {target:messageTarget});
      fixture.menu = fixture.tree.props.children[0].props;
      fixture.menu.items[0].action();
    }""")
    assert page.evaluate("fixture.otherTree.props.children.length") == 0
    assert page.evaluate("fixture.menu.id") == "lr-remind"
    assert page.evaluate("fixture.menu.items.slice(0,5).map(i=>i.label)") == ["In 15 minutes", "In 30 minutes", "In 1 hour", "In 1 day", "In 1 week"]
    assert page.evaluate("plugin.state.reminders[0].preview") == ""
    assert page.evaluate("plugin.state.reminders.length") == 1
    page.evaluate("""() => {
      plugin.state.settings.savePreview = true;
      fixture.previewTree = {props:{children:[]}};
      const target = document.querySelector('#chat-messages-333333333333333333-444444444444444444 span');
      fixture.messageMenuPatch(fixture.previewTree, {target});
      fixture.messageMenuPatch(fixture.previewTree, {target});
      fixture.previewTree.props.children[0].props.items[0].action();
      plugin.state.settings.savePreview = false;
    }""")
    assert page.evaluate("fixture.previewTree.props.children.length") == 1
    assert page.evaluate("plugin.state.reminders[0].preview") == "not stored without opt-in"
    assert page.evaluate("plugin.state.reminders.length") == 1
    passed("message menu: presets, scheduling, duplicate-patch protection, preview privacy")

    page.get_by_role("button", name="Reminders: 0 due, 1 upcoming").click()
    expect(page.get_by_role("dialog", name="Your reminder inbox")).to_be_visible()
    expect(page.get_by_role("article")).to_have_count(1)
    page.get_by_role("button", name="Add message link", exact=True).click()
    page.get_by_role("textbox", name="Discord message link").fill("https://discord.com/channels/555555555555555555/666666666666666666/777777777777777777")
    page.get_by_role("textbox", name="Duration", exact=True).fill("bad duration")
    page.get_by_role("button", name="Set reminder", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("Use units")
    page.get_by_role("textbox", name="Duration", exact=True).fill("2h 30m")
    payload = '<img src=x onerror="window.XSS=true"> <script>alert(1)</script>'
    page.get_by_role("textbox", name="Private note", exact=True).fill(payload)
    page.get_by_role("button", name="Set reminder", exact=True).click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    assert page.evaluate("plugin.state.reminders.length") == 2
    passed("custom form validates bad input and schedules a pasted message link")

    page.get_by_role("button", name="Reminders: 0 due, 2 upcoming").click()
    expect(page.get_by_role("article")).to_have_count(2)
    page.get_by_role("searchbox").fill("onerror")
    expect(page.get_by_role("article")).to_have_count(1)
    expect(page.get_by_role("article")).to_contain_text(payload)
    assert not page.evaluate("Boolean(window.XSS)")
    assert page.locator("#remind-me-later-host img").count() == 0
    page.get_by_role("button", name="Due", exact=True).click()
    expect(page.get_by_role("article")).to_have_count(0)
    page.get_by_role("button", name="Close", exact=True).click()
    passed("manager search/filter works and untrusted note text is not HTML")

    page.evaluate("plugin.state.reminders.forEach(r=>r.dueAt=Date.now()-1000); plugin.tick()")
    expect(page.get_by_role("button", name="Reminders: 2 due, 0 upcoming")).to_be_visible()
    expect(page.locator("#dm")).to_have_attribute("data-lr-due", "1")
    expect(page.locator("#server")).to_have_attribute("data-lr-due", "1")
    assert page.evaluate("fixture.alerts.length") == 2
    page.evaluate("plugin.tick()")
    assert page.evaluate("fixture.alerts.length") == 2
    passed("due reminders create local alerts and chat stripes without repeated notifications")

    page.evaluate("fixture.alerts[0].options.actions[1].onClick()")
    expect(page.get_by_role("button", name="Reminders: 1 due, 1 upcoming")).to_be_visible()
    expect(page.locator("#dm")).not_to_have_attribute("data-lr-due", "1")
    assert page.evaluate("fixture.alerts[0].closed")
    page.evaluate("fixture.alerts[1].options.actions[0].onClick()")
    assert page.evaluate("fixture.routes[0]") == "/channels/555555555555555555/666666666666666666/777777777777777777"
    assert page.evaluate("plugin.state.reminders.filter(r=>r.status==='due').length") == 1
    passed("notification snooze and message navigation work; opening does not dismiss")

    page.get_by_role("button", name="Reminders: 1 due, 1 upcoming").click()
    page.get_by_role("button", name="Done", exact=True).click()
    expect(page.get_by_role("article")).to_have_count(1)
    page.get_by_role("button", name="Settings", exact=True).click()
    page.get_by_role("checkbox", name="Desktop notifications", exact=False).first.check()
    assert page.evaluate("plugin.state.settings.desktop")
    page.get_by_role("button", name="Test alert", exact=True).click()
    assert page.evaluate("fixture.native.length") == 1
    assert page.evaluate("fixture.native[0].options.body") == "Your private desktop notification is working."
    page.get_by_role("checkbox", name="Save message previews", exact=False).check()
    page.evaluate("plugin.schedule({...plugin.capture({id:'888888888888888888',channel_id:'333333333333333333',content:'optional preview'})},Date.now()+60000,'private note')")
    assert page.evaluate("plugin.state.reminders.some(r=>r.preview==='optional preview')")
    page.get_by_role("checkbox", name="Save message previews", exact=False).uncheck()
    assert page.evaluate("plugin.state.reminders.every(r=>r.preview==='')")
    page.get_by_role("checkbox", name="Show reminder button", exact=False).uncheck()
    expect(page.get_by_role("button", name="Reminders:", exact=False)).to_be_hidden()
    page.get_by_role("checkbox", name="Show reminder button", exact=False).check()
    expect(page.get_by_role("button", name="Reminders:", exact=False)).to_be_visible()
    passed("settings: native alert opt-in, preview erasure, and button visibility")

    page.get_by_role("checkbox", name="Place the reminder button on the left", exact=False).check()
    assert page.locator(".dock.left").count() == 1
    page.get_by_role("button", name="Open reminder inbox", exact=True).click()
    original_due = page.evaluate("plugin.state.reminders.slice().sort((a,b)=>a.dueAt-b.dueAt)[0].dueAt")
    page.get_by_role("article").first.get_by_role("button", name="Edit", exact=True).click()
    expect(page.get_by_role("combobox", name="Reminder timing")).to_have_value("date")
    expect(page.get_by_role("textbox", name="Local date and time")).to_be_visible()
    page.get_by_role("textbox", name="Private note", exact=True).fill("Edited note, same deadline")
    page.get_by_role("button", name="Set reminder", exact=True).click()
    assert page.evaluate("plugin.state.reminders.find(r=>r.note==='Edited note, same deadline').dueAt") == original_due
    page.evaluate("plugin.openCustom()")
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_have_count(0)
    passed("dock placement, date/time editor and Escape dialog dismissal")

    page.evaluate("plugin.state.reminders.forEach(r=>r.dueAt=Date.now()-1000); plugin.tick(); plugin.openManager()")
    old_count = page.evaluate("plugin.state.reminders.length")
    page.evaluate("fixture.staleAction=fixture.alerts.at(-1).options.actions[2].onClick; fixture.switchAccount('222222222222222222')")
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.get_by_role("button", name="Reminders: 0 due, 0 upcoming")).to_be_visible()
    assert page.locator("[data-lr-due]").count() == 0
    assert page.evaluate("fixture.native.every(n=>n.closed)")
    page.evaluate("fixture.staleAction()")
    assert page.evaluate("plugin.state.reminders.length") == 0
    page.evaluate("fixture.switchAccount('111111111111111111')")
    assert page.evaluate("plugin.state.reminders.length") == old_count
    passed("account switch clears UI/native alerts and stale actions cannot affect another account")

    before = page.evaluate("fixture.alerts.length")
    page.evaluate("plugin.stop(); plugin.start()")
    assert page.evaluate("fixture.alerts.length") == before
    assert page.evaluate("plugin.state.reminders.length") == old_count
    passed("plugin reload restores due inbox without duplicate notifications")

    # Inject a BetterDiscord settings panel and ensure it updates safely on account changes.
    page.evaluate("fixture.panel=plugin.getSettingsPanel(); document.body.append(fixture.panel)")
    assert page.evaluate("fixture.panel.shadowRoot.textContent.includes('Delete all reminders')")
    page.evaluate("fixture.switchAccount(null)")
    assert page.evaluate("fixture.panel.shadowRoot.textContent.includes('sign in')")
    expect(page.locator(".dock")).to_be_hidden()
    page.evaluate("fixture.panel.remove(); fixture.switchAccount('111111111111111111')")
    passed("embedded settings panel respects login state; logged-out dock is hidden")

    page.evaluate("plugin.openManager()")
    page.get_by_role("button", name="Settings", exact=True).click()
    page.get_by_role("button", name="Delete all reminders…", exact=True).click()
    page.get_by_role("button", name="Keep reminders", exact=True).click()
    assert page.evaluate("plugin.state.reminders.length") == old_count
    page.evaluate("plugin.openSettings()")
    page.get_by_role("button", name="Delete all reminders…", exact=True).click()
    page.get_by_role("button", name="Delete reminders", exact=True).click()
    assert page.evaluate("plugin.state.reminders.length") == 0
    passed("delete-all requires confirmation and affects only the current account")

    # Render a populated manager for visual inspection. All content below is synthetic.
    page.evaluate("""() => {
      plugin.state.settings.sound=false;
      plugin.schedule({owner:fixture.account,guildId:'555555555555555555',channelId:'666666666666666666',messageId:'999999999999999991'},Date.now()+3600000,'Follow up on the design review');
      plugin.schedule({owner:fixture.account,guildId:'@me',channelId:'333333333333333333',messageId:'999999999999999992'},Date.now()+86400000,'Reply when I have the final details');
      plugin.state.reminders[0].dueAt=Date.now()-60000; plugin.tick(); plugin.openManager();
    }""")
    screenshot = ROOT / "test" / "ui-preview.png"
    page.screenshot(path=str(screenshot), full_page=True)
    page.evaluate("plugin.stop()")
    assert page.locator("#remind-me-later-host").count() == 0
    assert page.locator("[data-lr-due]").count() == 0
    assert page.evaluate("fixture.patches.size") == 0
    assert page.evaluate("fixture.accountListeners.size") == 0
    assert page.evaluate("plugin.timer===null && plugin.observerTimer===null")
    assert page.evaluate("fixture.errors") == []
    assert requests == [], requests
    passed("stop removes hooks/UI/timers; the whole smoke run made zero network requests")
    browser.close()

report = {"passed":len(results),"checks":results,"environment":"Chromium; mocked Discord/BetterDiscord APIs; Europe/Madrid timezone", "realDiscordTested":False}
(ROOT / "test" / "ui-results.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"\n{len(results)} UI smoke checks passed.")
