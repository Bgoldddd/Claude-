"""Two real browser windows join the same private court through the UI and play.
Run: python3 tests/browser_mp.py   (needs `npm run dev` running)"""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
errs = []

def make(b, name, arch):
    ctx = b.new_context(viewport={"width": 1100, "height": 640})
    ctx.add_init_script("localStorage.setItem('courtside.settings', JSON.stringify({quality:'low'}))")
    pg = ctx.new_page()
    pg.set_default_timeout(60000)
    pg.on("pageerror", lambda e: errs.append(f"{name}: {e}"))
    pg.goto(URL)
    pg.wait_for_selector("text=CREATE YOUR PLAYER", timeout=120000)
    pg.fill("input", name); pg.click(f"text={arch}", force=True); pg.click("text=CREATE PLAYER", force=True)
    pg.wait_for_selector("text=SAVE LOOK", timeout=30000)
    pg.click("text=‹ BACK", force=True); pg.wait_for_selector("text=LEADERBOARDS", timeout=20000)
    return pg

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=ARGS)
    a = make(b, "HostBen", "Playmaker")
    c = make(b, "GuestKid", "Slasher")
    a.click(".menu-item >> text=PLAY", force=True); a.wait_for_selector("text=OPEN PRIVATE COURT")
    a.click("text=OPEN PRIVATE COURT", force=True)
    a.wait_for_selector(".room-code b", timeout=30000)
    code = a.inner_text(".room-code b").strip()
    print("court code:", code)
    c.click(".menu-item >> text=PLAY", force=True); c.wait_for_selector("text=JOIN COURT")
    c.fill(".code-input", code); c.click("text=JOIN COURT", force=True)
    c.wait_for_selector(".lobby-panel", timeout=30000)
    time.sleep(3)
    seats_a = a.locator(".lt-seat:not(.empty)").count(); seats_c = c.locator(".lt-seat:not(.empty)").count()
    print("seats seen by host / guest:", seats_a, seats_c)
    a.screenshot(path="/tmp/shots/mp_lobby_host.png")
    # quick message from the guest
    c.mouse.click(900, 400); c.keyboard.press("Digit1"); time.sleep(1.5)
    a.screenshot(path="/tmp/shots/mp_lobby_qm.png")
    a.click("text=READY UP", force=True); c.click("text=READY UP", force=True)
    a.wait_for_selector(".scorebug", timeout=30000); c.wait_for_selector(".scorebug", timeout=30000)
    time.sleep(5)
    a.screenshot(path="/tmp/shots/mp_match_host.png"); c.screenshot(path="/tmp/shots/mp_match_guest.png")
    names_a = a.inner_text(".scorebug"); names_c = c.inner_text(".scorebug")
    print("host scorebug:", names_a.replace("\n", " | ")); print("guest scorebug:", names_c.replace("\n", " | "))
    b.close()
print("page errors:", errs)
