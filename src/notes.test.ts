import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookHeader, noteBlock, parseNotes } from "./notes-md.ts";
import type { Book, Note } from "./model.ts";

const note: Note = {
	id: "n1",
	text: "事权下沉。",
	chapter: "引言",
	at: "2026-08-31 15:04",
	from: "手写",
};

describe("notes markdown", () => {
	it("round-trips a note block", () => {
		const book: Book = {
			id: "wr-1", source: "weread", title: "置身事内", author: "兰小欢",
			progress: 0, lastRead: "", chapters: [], text: "", highlights: [], notes: [],
		};
		const md = bookHeader(book) + noteBlock(note);
		const parsed = parseNotes(md);
		assert.equal(parsed.length, 1);
		assert.equal(parsed[0]?.text, "事权下沉。");
		assert.equal(parsed[0]?.chapter, "引言");
		assert.equal(parsed[0]?.from, "手写");
	});
});
