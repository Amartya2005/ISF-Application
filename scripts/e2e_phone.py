"""Browser test: sign in to the website with a mobile number (phone OTP; dev mode issues the code-free token),
register a startup, see per-year status, and confirm the account stores the verified mobile, not an email.

Usage: python3 scripts/e2e_phone.py [screenshot_dir]   (API on :4000, web on :3000)
"""
import re
import sys
import time
from playwright.sync_api import expect, sync_playwright

WEB = "http://localhost:3000"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
stamp = str(int(time.time()))
mobile = f"9{stamp[-9:]}"
startup = f"Sabai Grass Crafts {stamp[-5:]}"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    page.goto(f"{WEB}/signin?next=/register")
    page.get_by_role("radio", name="Sign in with mobile number").check()
    page.get_by_label(re.compile("^Mobile number")).fill("12345")
    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_text("Enter a valid mobile number")).to_be_visible()
    page.get_by_label(re.compile("^Mobile number")).fill(f"{mobile[:5]} {mobile[5:]}")
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(f"{WEB}/register")
    expect(page.get_by_text(f"Signed in as +91{mobile}")).to_be_visible()               # header shows the signed-in number
    page.screenshot(path=f"{OUT}/ph-1-register-signed-in-by-phone.png", full_page=True)
    page.get_by_label("2027 only").check()
    page.get_by_label("Startup name *").fill(startup)
    page.get_by_label(re.compile("What does your startup do")).fill("Handwoven sabai grass products from Mayurbhanj artisan groups.")
    page.get_by_label("Full name *").fill("Champa Murmu")
    page.get_by_label(re.compile("Mobile number")).fill(mobile)
    page.get_by_label(re.compile("I have read the")).check()
    page.get_by_role("button", name="Submit application").click()
    expect(page.get_by_text(f"Application submitted for {startup}.")).to_be_visible()
    page.get_by_role("link", name="View application status").click()
    expect(page.get_by_text("Startup Jathara 2027")).to_be_visible()
    expect(page.get_by_text("Under review")).to_have_count(1)
    page.screenshot(path=f"{OUT}/ph-2-status.png", full_page=True)
    browser.close()
print("E2E phone sign-in passed for", startup, f"+91{mobile}")
