import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { qrSvg } from "./qr.ts";

describe("qrSvg", () => {
	it("renders an SVG QR for a URL", () => {
		const svg = qrSvg("https://www.qidian.com");
		assert.match(svg, /^<svg\b/i);
		assert.match(svg, /viewBox=/i);
		assert.ok(svg.length > 200);
	});
});
