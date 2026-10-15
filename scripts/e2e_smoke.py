"""Browser smoke test of the M1 vertical slice through the real screens.

website: sign in -> register for both years -> status
console: management sign-in -> draft "select" for 2026 -> release
website: 2026 Selected, 2027 still under review, congratulation message
console: Admin without a management grant is refused

Usage: python3 scripts/e2e_smoke.py [screenshot_dir]   (API on :4000, web on :3000, console on :3001)
"""
import re
import sys
import time
from playwright.sync_api import expect, sync_playwright

WEB, CONSOLE = "http://localhost:3000", "http://localhost:3001"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
stamp = str(int(time.time()))
email = f"leader{stamp}@demo.in"
startup = f"Sal Leaf Studio {stamp[-5:]}"


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- applicant registers for both years
    web = browser.new_page(viewport={"width": 1200, "height": 900})
    web.goto(f"{WEB}/")
    expect(web.get_by_role("heading", name="Startup Jathara @ Dandakaranya")).to_be_visible()
    expect(web.get_by_text("18–20 December 2026")).to_be_visible()
    shot(web, "1-home")
    web.get_by_role("link", name="Register your startup").first.click()
    web.get_by_role("link", name="Sign in to continue").click()
    web.get_by_label("Email").fill(email)
    web.get_by_role("button", name="Continue").click()
    web.wait_for_url(f"{WEB}/register")

    web.get_by_role("button", name="Submit application").click()            # empty submit shows a field error
    expect(web.get_by_text("Choose which year(s) to apply for")).to_be_visible()
    web.get_by_label("Both 2026 and 2027 (two separate applications)").check()
    web.get_by_label("Startup name *").fill(startup)
    web.get_by_label(re.compile("What does your startup do")).fill("Sal-leaf plates and packaging made with forest-dwelling women's collectives.")
    web.get_by_label("City").fill("Gunupur")
    web.get_by_label("State").fill("Odisha")
    web.get_by_label("Full name *").fill("Mitali Sabar")
    web.get_by_label(re.compile("Mobile number")).fill("98765 01234")
    web.get_by_label(re.compile("I have read the")).check()
    shot(web, "2-register-form")
    web.get_by_role("button", name="Submit application").click()
    expect(web.get_by_text(f"Application submitted for {startup}.")).to_be_visible()
    shot(web, "3-register-done")
    web.get_by_role("link", name="View application status").click()
    expect(web.get_by_text("Under review")).to_have_count(2)

    # ---- management drafts and releases a decision
    con = browser.new_page(viewport={"width": 1300, "height": 900})
    con.goto(f"{CONSOLE}/signin")
    con.get_by_label("Work email").fill("manager@dev.local")
    con.get_by_role("button", name="Continue").click()
    con.wait_for_url(re.compile(r"/applications"))
    row = con.locator("tr", has_text=startup)
    expect(row).to_be_visible()
    row.get_by_role("button", name="Select", exact=True).click()
    expect(row.get_by_text("decision_drafted")).to_be_visible()
    web.reload()
    expect(web.get_by_text("Under review")).to_have_count(2)                 # drafts stay invisible to applicants
    shot(con, "4-console-draft")
    con.once("dialog", lambda d: d.accept())
    con.get_by_role("button", name="Release decisions").click()
    expect(con.locator(".notice-ok")).to_contain_text(re.compile(r"Released \d+ \(\d+ selected"))
    expect(row.get_by_text("selected", exact=True)).to_be_visible()
    shot(con, "5-console-released")

    # ---- applicant sees independent results
    web.reload()
    expect(web.get_by_text("Selected", exact=True)).to_be_visible()
    expect(web.get_by_text("Under review")).to_have_count(1)
    expect(web.get_by_text(re.compile(f"Congratulations — {startup}"))).to_be_visible()
    shot(web, "6-status-selected")

    # ---- admin without a management grant is refused
    adm = browser.new_page()
    adm.goto(f"{CONSOLE}/signin")
    adm.get_by_label("Work email").fill("admin@dev.local")
    adm.get_by_role("button", name="Continue").click()
    expect(adm.get_by_text("Your account does not have Management permissions.")).to_be_visible()

    browser.close()
print("E2E smoke passed for", startup)
