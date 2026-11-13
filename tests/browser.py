"""Headless browser smoke test: boots the real client, creates a player, plays a CPU match.
Run: python3 tests/browser.py [url]   (needs the dev server running)"""
import sys, time, json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/"
OUT = "/tmp/shots"
import os; os.makedirs(OUT, exist_ok=True)
errors = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error",) else None)
    pg.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    pg.goto(URL)
    pg.wait_for_selector("text=CREATE YOUR PLAYER", timeout=120000)
    pg.screenshot(path=f"{OUT}/01_create.png")
    pg.fill("input", "TestBen")
    pg.click("text=Sharpshooter")
    pg.click("text=CREATE PLAYER")
    pg.wait_for_selector("text=MY PLAYER", timeout=30000)
    time.sleep(2)
    pg.screenshot(path=f"{OUT}/02_myplayer.png")
    pg.click("text=‹ BACK")
    pg.wait_for_selector("text=LEADERBOARDS", timeout=10000)
    time.sleep(3)
    pg.screenshot(path=f"{OUT}/03_menu.png")
    pg.click(".menu-item >> text=PLAY")
    pg.wait_for_selector("text=VS CPU", timeout=10000)
    pg.screenshot(path=f"{OUT}/04_play.png")
    pg.click("text=PLAY VS CPU")
    pg.wait_for_selector(".scorebug", timeout=30000)
    time.sleep(4)
    pg.screenshot(path=f"{OUT}/05_game.png")
    # play: click to lock, hold W toward the hoop, shoot
    pg.mouse.click(640, 400)
    time.sleep(1)
    pg.keyboard.down("KeyW"); time.sleep(1.2); pg.keyboard.up("KeyW")
    pg.screenshot(path=f"{OUT}/06_move.png")
    pg.mouse.down(); time.sleep(0.45)
    pg.screenshot(path=f"{OUT}/07_meter.png")
    time.sleep(0.3); pg.mouse.up()
    time.sleep(1.5)
    pg.screenshot(path=f"{OUT}/08_after_shot.png")
    pg.keyboard.down("Tab"); time.sleep(0.4); pg.screenshot(path=f"{OUT}/09_box.png"); pg.keyboard.up("Tab")
    time.sleep(6)
    pg.screenshot(path=f"{OUT}/10_later.png")
    fps = pg.evaluate("document.querySelector('.fps') ? document.querySelector('.fps').textContent : 'n/a'")
    print("fps", fps)
    b.close()

print("errors:", len(errors))
for e in errors[:20]: print(e)
