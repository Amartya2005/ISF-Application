"""Browser end-to-end test of Phase 9's console additions: Reports and the admin Audit view (FR-RPT-*, FR-AUD-*; TBD-31, TBD-59).

admin (console): Reports shows only Admin's reports (accounts, imports, volunteers) -> downloads the accounts CSV
                 -> Audit shows the export just made, filterable by action -> the retention sweep panel is visible
management (console): Reports shows only Management's reports (applications, selection, jury), never Admin's
                 -> downloads the jury CSV -> Audit is refused (Admin-only)
support (console): Reports is refused (no export permission) -> Audit is refused

Usage: python3 scripts/e2e_reports_audit.py   (API :4000, console :3001, seeded with `pnpm db:seed`)
"""
import sys
import time
import urllib.request
import json
from playwright.sync_api import expect, sync_playwright

API, CONSOLE = "http://localhost:4000", "http://localhost:3001"


def api(method, path, token=None, body=None):
    req = urllib.request.Request(f"{API}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={**({"content-type": "application/json"} if body is not None else {}),
                                          **({"authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


def console_sign_in(page, email):
    page.goto(f"{CONSOLE}/signin")
    page.get_by_label("Work email").fill(email)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url(f"{CONSOLE}/")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Admin: Reports shows only Admin's reports; downloads one; the export shows up in Audit
    admin = browser.new_page()
    console_sign_in(admin, "admin@dev.local")
    admin.goto(f"{CONSOLE}/reports")
    expect(admin.get_by_role("row", name="Accounts and roles")).to_be_visible()
    expect(admin.get_by_role("row", name="Import batches")).to_be_visible()
    expect(admin.get_by_role("row", name="Volunteer assignments")).to_be_visible()
    expect(admin.get_by_role("row", name="Applications")).to_have_count(0)      # Management's reports, never Admin's
    expect(admin.get_by_role("row", name="Jury evaluations")).to_have_count(0)
    with admin.expect_download() as dl_info:
        admin.get_by_role("row", name="Accounts and roles").get_by_role("button", name="Download CSV").click()
    download = dl_info.value
    assert download.suggested_filename == "sj-accounts.csv"
    print(f"admin accounts export downloaded: {download.suggested_filename}")

    admin.goto(f"{CONSOLE}/audit")
    admin.get_by_label("Action").fill("report.exported")
    admin.get_by_label("Action").press("Tab")
    expect(admin.get_by_role("cell", name="report · accounts", exact=True).first).to_be_visible(timeout=10_000)
    expect(admin.get_by_text("Data-retention sweep (TBD-32)")).to_be_visible()
    print("admin sees the export in the audit log, and the retention-sweep panel")

    # ---- Management: the opposite set of reports; Audit is Admin-only
    manager = browser.new_page()
    console_sign_in(manager, "manager@dev.local")
    manager.goto(f"{CONSOLE}/reports")
    expect(manager.get_by_role("row", name="Applications")).to_be_visible()
    expect(manager.get_by_role("row", name="Selection decisions")).to_be_visible()
    expect(manager.get_by_role("row", name="Jury evaluations")).to_be_visible()
    expect(manager.get_by_role("row", name="Accounts and roles")).to_have_count(0)      # Admin's reports, never Management's
    with manager.expect_download() as dl_info2:
        manager.get_by_role("row", name="Jury evaluations").get_by_role("button", name="Download CSV").click()
    assert dl_info2.value.suggested_filename == "sj-jury-2026.csv"
    print("management jury export downloaded")

    manager.goto(f"{CONSOLE}/audit")
    expect(manager.get_by_text("The audit view is Admin-only.")).to_be_visible()
    print("management is refused the audit view")

    # ---- Customer Support: neither screen
    support = browser.new_page()
    console_sign_in(support, "support@dev.local")
    support.goto(f"{CONSOLE}/reports")
    expect(support.get_by_text("Your account does not have export permission.")).to_be_visible()
    support.goto(f"{CONSOLE}/audit")
    expect(support.get_by_text("The audit view is Admin-only.")).to_be_visible()
    print("customer support is refused both screens")

    browser.close()
    print("OK: Phase 9 reports and audit console flow")
