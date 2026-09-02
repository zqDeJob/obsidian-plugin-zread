import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shelfProgressLabel } from "./model.ts";

describe("shelfProgressLabel", () => {
	it("prefers chapter counts when total is known", () => {
		assert.equal(shelfProgressLabel({ progress: 10, chapterAt: 120, chapterTotal: 1200 }), "120 / 1200 章");
		assert.equal(shelfProgressLabel({ progress: 0, chapterAt: 0, chapterTotal: 900 }), "0 / 900 章");
	});

	it("falls back to percent when chapter total is missing", () => {
		assert.equal(shelfProgressLabel({ progress: 65 }), "65%");
		assert.equal(shelfProgressLabel({ progress: 100 }), "已读完");
		assert.equal(shelfProgressLabel({ progress: 0 }), "未读");
	});
});
