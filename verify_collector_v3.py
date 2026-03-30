from playwright.sync_api import sync_playwright
import os

def run_cuj(page):
    # Since we can't easily hit Deriv WS in a sandbox, we'll verify the overlay injection
    # by loading a local page with the content.js and styles.css mocked.
    # But for a real chrome extension, we verify the UI and connectivity features.

    # Let's create a mock HTML page to test the overlay and script initialization
    with open("mock_deriv.html", "w") as f:
        f.write('<html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Deriv Mock</h1><script src="content.js"></script></body></html>')

    abs_path = "file://" + os.path.abspath("mock_deriv.html")
    page.goto(abs_path)
    page.wait_for_timeout(2000)

    # Check if overlay is present
    overlay = page.locator("#tt-overlay")
    if overlay.is_visible():
        print("Overlay injected successfully.")
    else:
        print("Overlay injection FAILED.")

    # Check title
    title = page.locator(".tt-title").inner_text()
    print(f"Overlay Title: {title}")

    # Capture UI state
    page.screenshot(path="/home/jules/verification/screenshots/v3_collector_ui.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    os.makedirs("/home/jules/verification/videos", exist_ok=True)
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
