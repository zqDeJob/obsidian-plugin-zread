import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guestViewportPx, keepInGuestScript, wereadHeightCss, wereadHeightScript } from "./webview-guest.ts";

describe("guestViewportPx", () => {
	it("skips host height that is still 0 or collapsed", () => {
		assert.equal(guestViewportPx(0), 0);
		assert.equal(guestViewportPx(79), 0);
	});

	it("uses the measured host height once layout has settled", () => {
		assert.equal(guestViewportPx(80), 80);
		assert.equal(guestViewportPx(700.9), 700);
	});
});

describe("wereadHeightCss", () => {
	it("locks WeRead reader shells to the webview viewport", () => {
		const css = wereadHeightCss();
		assert.match(css, /html,\s*body/);
		assert.match(css, /\.app_content/);
		assert.match(css, /\.readerChapterContent/);
		assert.match(css, /height:\s*100%\s*!important/);
		assert.match(css, /calc\(100% - 64px\)/);
	});
});

describe("wereadHeightScript", () => {
	it("is empty until the host has a real height", () => {
		assert.equal(wereadHeightScript(0), "");
		assert.equal(wereadHeightScript(40), "");
	});

	it("overrides innerHeight and asks WeRead to relayout", () => {
		const code = wereadHeightScript(640);
		assert.match(code, /\b640\b/);
		assert.match(code, /innerHeight/);
		assert.match(code, /app_content/);
		assert.match(code, /dispatchEvent\(new Event\('resize'\)\)/);
	});
});

describe("keepInGuestScript", () => {
	it("keeps window.open and 阅读 links inside the webview", () => {
		const code = keepInGuestScript();
		assert.match(code, /window\.open/);
		assert.match(code, /\/reader\//);
		assert.match(code, /target/);
	});
});
