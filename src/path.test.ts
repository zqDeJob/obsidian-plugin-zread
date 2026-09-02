import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, vaultPath, type Book } from "./model.ts";

const book: Book = {
	id: "wr-1",
	source: "weread",
	title: "置身事内",
	author: "兰小欢",
	progress: 0,
	lastRead: "",
	chapters: [],
	text: "",
	highlights: [],
	notes: [],
};

describe("vaultPath", () => {
	it("writes under notes folder with title", () => {
		assert.equal(vaultPath(book, DEFAULT_SETTINGS), "Z-Read/笔记/置身事内.md");
	});

	it("nests by source", () => {
		const path = vaultPath(book, { ...DEFAULT_SETTINGS, subfolder: "source" });
		assert.equal(path, "Z-Read/笔记/微信读书/置身事内.md");
	});

	it("expands filename tokens", () => {
		const path = vaultPath(book, { ...DEFAULT_SETTINGS, fileName: "{{author}}-{{title}}" });
		assert.equal(path, "Z-Read/笔记/兰小欢-置身事内.md");
	});
});
