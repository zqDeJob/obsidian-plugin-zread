import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dropSeedBooks, type Book } from "./model.ts";

function book(id: string, title: string): Book {
	return {
		id, source: "local", title, author: "本地",
		progress: 0, lastRead: "", chapters: ["全文"], text: "", highlights: [], notes: [],
	};
}

describe("dropSeedBooks", () => {
	it("keeps an empty shelf empty", () => {
		assert.deepEqual(dropSeedBooks([]), []);
	});

	it("drops prototype seed ids and keeps real books", () => {
		const kept = dropSeedBooks([
			book("wr-1", "置身事内"),
			book("loc-real", "我的笔记"),
			book("fq-1", "大奉打更人"),
		]);
		assert.equal(kept.length, 1);
		assert.equal(kept[0]?.id, "loc-real");
	});
});
