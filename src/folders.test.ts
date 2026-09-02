import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Book } from "./model.ts";
import {
	addBookToFolder,
	canAddBookToFolder,
	createFolder,
	deleteFolder,
	dissolveFolders,
	foldersOfBook,
	nextFolderName,
	placeBookInFolder,
	pruneFolders,
	removeBookFromFolder,
	renameFolder,
	seedFoldersFromBooks,
	sharedSource,
	syncFoldersAfterMerge,
	ungroupBooks,
	ungroupedBooks,
	filterByGrouped,
	sortBooks,
	sortFolders,
	wallFolders,
	childFolders,
	canNestUnder,
	folderPath,
	folderSelectTree,
	folderBookIdsInclusive,
	normalizeFolders,
	exclusiveArchivedFolders,
	isArchiveFolder,
	isArchivedBook,
} from "./folders.ts";

function book(id: string, group?: string): Book {
	return {
		id,
		source: "fanqie",
		title: id,
		author: "a",
		progress: 0,
		lastRead: "",
		chapters: ["全文"],
		text: "",
		highlights: [],
		notes: [],
		...(group ? { group } : {}),
	};
}

describe("shelf folders", () => {
	it("creates an empty folder so books can be dropped in later", () => {
		const { folder, folders } = createFolder([], "想读", [], () => "f1");
		assert.equal(folder.name, "想读");
		assert.deepEqual(folder.bookIds, []);
		assert.equal(folders.length, 1);
	});

	it("names the next group 分组 N skipping used numbers", () => {
		assert.equal(nextFolderName([]), "分组 1");
		assert.equal(nextFolderName([{ id: "f1", name: "分组 1", bookIds: [] }]), "分组 2");
		assert.equal(nextFolderName([
			{ id: "f1", name: "分组 1", bookIds: [] },
			{ id: "f2", name: "分组 3", bookIds: [] },
		]), "分组 2");
	});

	it("seeds folders from group_name, skipping books without a group", () => {
		let n = 0;
		const folders = seedFoldersFromBooks(
			[book("a", "在读"), book("b", "在读"), book("c", "想读"), book("d")],
			() => `fld-${++n}`,
		);
		assert.equal(folders.length, 2);
		assert.deepEqual(folders.find((f) => f.name === "在读")?.bookIds, ["a", "b"]);
		assert.deepEqual(folders.find((f) => f.name === "想读")?.bookIds, ["c"]);
	});

	it("lets one book sit in two folders", () => {
		const created = createFolder([], "A", ["x", "y"], () => "f1");
		const added = addBookToFolder(created.folders, "f1", "z");
		const two = createFolder(added, "B", ["x", "z"], () => "f2").folders;
		assert.deepEqual(foldersOfBook(two, "x").map((f) => f.name).sort(), ["A", "B"]);
		assert.deepEqual(ungroupedBooks([book("x"), book("y"), book("z"), book("w")], two).map((b) => b.id), ["w"]);
	});

	it("remove from a folder does not delete the book or other memberships", () => {
		let folders = createFolder([], "A", ["x", "y"], () => "f1").folders;
		folders = createFolder(folders, "B", ["x"], () => "f2").folders;
		folders = removeBookFromFolder(folders, "f1", "x");
		assert.deepEqual(foldersOfBook(folders, "x").map((f) => f.id), ["f2"]);
		assert.deepEqual(folders.find((f) => f.id === "f1")?.bookIds, ["y"]);
	});

	it("rename, delete folder, and prune missing books keep the rest", () => {
		let folders = createFolder([], "旧名", ["gone", "stay"], () => "f1").folders;
		folders = renameFolder(folders, "f1", "新名");
		assert.equal(folders[0]?.name, "新名");
		folders = pruneFolders(folders, new Set(["stay"]));
		assert.deepEqual(folders[0]?.bookIds, ["stay"]);
		folders = deleteFolder(folders, "f1");
		assert.equal(folders.length, 0);
	});

	it("seeds on first sync then never rewrites memberships", () => {
		let n = 0;
		const id = () => `fld-${++n}`;
		const first = syncFoldersAfterMerge({
			folders: [],
			folderSeeded: false,
			books: [book("a", "在读"), book("b", "在读")],
			newId: id,
		});
		assert.equal(first.folderSeeded, true);
		assert.deepEqual(first.folders[0]?.bookIds, ["a", "b"]);
		const afterLeave = removeBookFromFolder(first.folders, first.folders[0]!.id, "a");
		const second = syncFoldersAfterMerge({
			folders: afterLeave,
			folderSeeded: true,
			books: [book("a", "在读"), book("b", "在读"), book("c", "想读")],
			newId: id,
		});
		assert.deepEqual(second.folders[0]?.bookIds, ["b"]);
		assert.equal(second.folders.some((f) => f.name === "想读"), false);
	});

	it("dissolves selected folders and can ungroup books without deleting them", () => {
		let folders = createFolder([], "A", ["a", "b"], () => "f1").folders;
		folders = createFolder(folders, "B", ["b", "c"], () => "f2").folders;
		folders = dissolveFolders(folders, ["f1"]);
		assert.deepEqual(folders.map((f) => f.id), ["f2"]);
		folders = ungroupBooks(folders, ["b"]);
		assert.deepEqual(folders[0]?.bookIds, ["c"]);
	});
});

describe("folder wall visibility", () => {
	it("keeps empty folders when filtering by source (no search)", () => {
		const empty = { id: "e", name: "想读", bookIds: [] as string[] };
		const weread = { id: "w", name: "微信", bookIds: ["wx"] };
		const fanqie = { id: "f", name: "番茄", bookIds: ["fq"] };
		const visible = new Set(["wx"]);
		assert.deepEqual(
			wallFolders([empty, weread, fanqie], visible, "").map((f) => f.id),
			["e", "w"],
		);
	});

	it("shows a folder when its name matches search even if no book matches", () => {
		const named = { id: "n", name: "三体专题", bookIds: ["other"] };
		const emptyHit = { id: "e", name: "三体想读", bookIds: [] as string[] };
		const miss = { id: "m", name: "想读", bookIds: [] as string[] };
		assert.deepEqual(
			wallFolders([named, emptyHit, miss], new Set(), "三体").map((f) => f.id),
			["n", "e"],
		);
	});

	it("shows a folder when a member book is in the search hits", () => {
		const hit = { id: "h", name: "在读", bookIds: ["santi"] };
		const miss = { id: "m", name: "想读", bookIds: ["other"] };
		assert.deepEqual(
			wallFolders([hit, miss], new Set(["santi"]), "三体").map((f) => f.id),
			["h"],
		);
	});
});

describe("folder and book sort", () => {
	it("sorts folders by name and books by title", () => {
		const folders = [
			{ id: "b", name: "组B", bookIds: [] as string[] },
			{ id: "a", name: "组A", bookIds: [] as string[] },
		];
		assert.deepEqual(sortFolders(folders).map((f) => f.name), ["组A", "组B"]);
		const books = [book("zeta"), book("alpha")];
		books[0]!.title = "Zeta";
		books[1]!.title = "Alpha";
		assert.deepEqual(sortBooks(books, "title").map((b) => b.title), ["Alpha", "Zeta"]);
	});

	it("sorts numbered folder names as 01 02 10, not by lastRead", () => {
		const books = new Map<string, Book>([
			["old", { ...book("old"), lastRead: "2020-01-01" }],
			["new", { ...book("new"), lastRead: "2024-06-01" }],
		]);
		const folders = [
			{ id: "c", name: "03-四合院", bookIds: [] as string[] },
			{ id: "b", name: "02-海贼王", bookIds: ["new"] },
			{ id: "a", name: "01-女频完本", bookIds: ["old"] },
			{ id: "t", name: "10-专题", bookIds: ["new"] },
		];
		assert.deepEqual(sortFolders(folders).map((f) => f.id), ["a", "b", "c", "t"]);
		assert.deepEqual(sortBooks([...books.values()], "recent").map((b) => b.id), ["new", "old"]);
	});
});

describe("nested folders two levels", () => {
	it("nests a child under a top-level folder", () => {
		const parent = createFolder([], "已完结", [], () => "p").folders;
		const { folder, folders } = createFolder(parent, "已完结玄幻", ["a"], () => "c", "p");
		assert.equal(folder.parentId, "p");
		assert.deepEqual(childFolders(folders, "p").map((f) => f.id), ["c"]);
		assert.equal(folderPath(folders, folder), "已完结 / 已完结玄幻");
		assert.deepEqual(folderBookIdsInclusive(folders, parent[0]!).sort(), ["a"]);
	});

	it("rejects a third level and a missing parent", () => {
		let folders = createFolder([], "已完结", [], () => "p").folders;
		folders = createFolder(folders, "已完结玄幻", [], () => "c", "p").folders;
		const third = createFolder(folders, "再下一层", [], () => "g", "c").folder;
		assert.equal(third.parentId, undefined);
		assert.equal(canNestUnder(folders, "c"), false);
		assert.equal(canNestUnder(folders, "p"), true);
		const orphan = createFolder(folders, "无父", [], () => "x", "missing").folder;
		assert.equal(orphan.parentId, undefined);
	});

	it("hides children on the wall and still shows the parent when a child name matches", () => {
		let folders = createFolder([], "已完结", [], () => "p").folders;
		folders = createFolder(folders, "已完结玄幻", ["x"], () => "c", "p").folders;
		folders = createFolder(folders, "想读", [], () => "t").folders;
		assert.deepEqual(wallFolders(folders, new Set(["x"]), "").map((f) => f.id), ["p", "t"]);
		assert.deepEqual(wallFolders(folders, new Set(["x"]), "玄幻").map((f) => f.id), ["p"]);
		assert.deepEqual(ungroupedBooks([book("x"), book("y")], folders).map((b) => b.id), ["y"]);
	});

	it("dissolves a parent together with its children, and normalizes illegal parents", () => {
		let folders = createFolder([], "已完结", ["a"], () => "p").folders;
		folders = createFolder(folders, "已完结玄幻", ["b"], () => "c", "p").folders;
		folders = createFolder(folders, "想读", ["d"], () => "t").folders;
		folders = dissolveFolders(folders, ["p"]);
		assert.deepEqual(folders.map((f) => f.id), ["t"]);
		const broken = normalizeFolders([
			{ id: "c", name: "子", bookIds: [], parentId: "gone" },
			{ id: "p", name: "父", bookIds: [], parentId: "c" },
		]);
		assert.equal(broken.find((f) => f.id === "c")?.parentId, undefined);
		assert.equal(broken.find((f) => f.id === "p")?.parentId, undefined);
	});
});

describe("source-scoped folders", () => {
	it("seeds the same group name as two folders when sources differ", () => {
		let n = 0;
		const folders = seedFoldersFromBooks(
			[
				{ ...book("a", "已完结"), source: "weread" },
				{ ...book("b", "已完结"), source: "fanqie" },
			],
			() => `fld-${++n}`,
		);
		assert.equal(folders.length, 2);
		assert.equal(folders.find((f) => f.source === "weread")?.bookIds[0], "a");
		assert.equal(folders.find((f) => f.source === "fanqie")?.bookIds[0], "b");
	});

	it("rejects a weread book in a fanqie folder and stamps source on first drop", () => {
		const fanqie = { id: "f", name: "已完结", bookIds: ["a"], source: "fanqie" };
		assert.equal(canAddBookToFolder(fanqie, { source: "weread" }), false);
		assert.deepEqual(addBookToFolder([fanqie], "f", "b", "weread")[0]?.bookIds, ["a"]);
		const empty = { id: "e", name: "想读", bookIds: [] as string[] };
		const stamped = addBookToFolder([empty], "e", "a", "fanqie")[0];
		assert.equal(stamped?.source, "fanqie");
		assert.deepEqual(stamped?.bookIds, ["a"]);
	});

	it("hides other-source folders when the wall is filtered to one source", () => {
		const folders = [
			{ id: "e", name: "想读", bookIds: [] as string[], source: "weread" },
			{ id: "ef", name: "想读", bookIds: [] as string[], source: "fanqie" },
			{ id: "w", name: "已完结", bookIds: ["wx"], source: "weread" },
			{ id: "f", name: "已完结", bookIds: ["fq"], source: "fanqie" },
		];
		assert.deepEqual(
			wallFolders(folders, new Set(["wx"]), "", "weread").map((x) => x.id),
			["e", "w"],
		);
	});

	it("names 分组 N per source so weread and fanqie can both have 分组 1", () => {
		const existing = [{ id: "f1", name: "分组 1", bookIds: [] as string[], source: "weread" }];
		assert.equal(nextFolderName(existing, undefined, "fanqie"), "分组 1");
		assert.equal(nextFolderName(existing, undefined, "weread"), "分组 2");
	});

	it("inherits source from the parent folder, not the caller", () => {
		const parent = createFolder([], "已完结", [], () => "p", undefined, "fanqie").folders;
		const child = createFolder(parent, "已完结玄幻", [], () => "c", "p", "weread").folder;
		assert.equal(child.source, "fanqie");
		assert.equal(child.parentId, "p");
	});

	it("splits a mixed folder and strips books that do not match a declared source", () => {
		let n = 0;
		const books = [
			{ ...book("a"), source: "weread" },
			{ ...book("b"), source: "fanqie" },
		];
		const split = normalizeFolders(
			[{ id: "mix", name: "已完结", bookIds: ["a", "b"] }],
			books,
			() => `n${++n}`,
		);
		assert.equal(split.length, 2);
		assert.deepEqual(split.find((f) => f.source === "weread")?.bookIds, ["a"]);
		assert.deepEqual(split.find((f) => f.source === "fanqie")?.bookIds, ["b"]);
		const stripped = normalizeFolders(
			[{ id: "f", name: "已完结", bookIds: ["a", "b"], source: "fanqie" }],
			books,
		);
		assert.deepEqual(stripped[0]?.bookIds, ["b"]);
		assert.equal(stripped.length, 1);
	});
});

describe("place book in folder", () => {
	it("keep adds the book and leaves original folders unchanged", () => {
		let folders = createFolder([], "A", ["x"], () => "a").folders;
		folders = createFolder(folders, "B", [], () => "b").folders;
		const next = placeBookInFolder(folders, "b", "x", "keep");
		assert.deepEqual(foldersOfBook(next, "x").map((f) => f.id).sort(), ["a", "b"]);
	});

	it("move adds the book and removes it from other folders", () => {
		let folders = createFolder([], "A", ["x"], () => "a").folders;
		folders = createFolder(folders, "B", [], () => "b").folders;
		folders = createFolder(folders, "C", ["x"], () => "c").folders;
		const next = placeBookInFolder(folders, "b", "x", "move");
		assert.deepEqual(foldersOfBook(next, "x").map((f) => f.id), ["b"]);
	});

	it("move can leave only the specified original folder", () => {
		let folders = createFolder([], "A", ["x"], () => "a").folders;
		folders = createFolder(folders, "B", [], () => "b").folders;
		folders = createFolder(folders, "C", ["x"], () => "c").folders;
		const next = placeBookInFolder(folders, "b", "x", "move", undefined, ["a"]);
		assert.deepEqual(foldersOfBook(next, "x").map((f) => f.id).sort(), ["b", "c"]);
	});
});

describe("shared source", () => {
	it("returns the source only when every item matches", () => {
		assert.equal(sharedSource([{ source: "fanqie" }, { source: "fanqie" }]), "fanqie");
		assert.equal(sharedSource([{ source: "fanqie" }, { source: "weread" }]), undefined);
		assert.equal(sharedSource([]), undefined);
	});
});

describe("filter by grouped", () => {
	it("splits books into ungrouped and grouped", () => {
		const folders = [{ id: "a", name: "在读", bookIds: ["x"] }];
		const books = [book("x"), book("y"), book("z")];
		assert.deepEqual(filterByGrouped(books, folders, "all").map((b) => b.id), ["x", "y", "z"]);
		assert.deepEqual(filterByGrouped(books, folders, "none").map((b) => b.id), ["y", "z"]);
		assert.deepEqual(filterByGrouped(books, folders, "in").map((b) => b.id), ["x"]);
	});
});

describe("archived books stay in 完本留存", () => {
	it("locks a book once it sits under 完本留存, including numbered names and children", () => {
		const folders = [
			{ id: "a", name: "01-完本留存", bookIds: ["x"] },
			{ id: "b", name: "在读", bookIds: ["y"] },
			{ id: "c", name: "女频", bookIds: ["z"], parentId: "a" },
		];
		assert.equal(isArchiveFolder(folders, folders[0]!), true);
		assert.equal(isArchiveFolder(folders, folders[1]!), false);
		assert.equal(isArchiveFolder(folders, folders[2]!), true);
		assert.equal(isArchivedBook("x", folders), true);
		assert.equal(isArchivedBook("y", folders), false);
		assert.equal(isArchivedBook("z", folders), true);
		assert.equal(isArchivedBook("missing", folders), false);
	});

	it("strips archived books from other folders and keeps them in 完本留存", () => {
		const folders = exclusiveArchivedFolders([
			{ id: "a", name: "在读", bookIds: ["x", "y"] },
			{ id: "b", name: "01-完本留存", bookIds: ["x"] },
		]);
		assert.deepEqual(folders[0]?.bookIds, ["y"]);
		assert.deepEqual(folders[1]?.bookIds, ["x"]);
	});

	it("does not treat progress 100 as archived", () => {
		const folders = exclusiveArchivedFolders([
			{ id: "a", name: "在读", bookIds: ["x"] },
			{ id: "b", name: "专题", bookIds: ["x"] },
		]);
		assert.deepEqual(folders[0]?.bookIds, ["x"]);
		assert.deepEqual(folders[1]?.bookIds, ["x"]);
	});
});

describe("folder select tree", () => {
	const folders = [
		{ id: "keep", name: "01-完本留存", bookIds: ["a"] },
		{ id: "girl", name: "01-女频完本", bookIds: ["b"], parentId: "keep" },
		{ id: "hist", name: "04-历史同人", bookIds: [] as string[] },
		{ id: "ming", name: "01-大明", bookIds: ["c"], parentId: "hist" },
		{ id: "tang", name: "02-大唐", bookIds: ["d"], parentId: "hist" },
		{ id: "yard", name: "03-四合院天下", bookIds: ["e"] },
	];

	it("nests children under parents instead of flattening paths", () => {
		const tree = folderSelectTree(folders);
		assert.deepEqual(tree.map((b) => [b.parent.id, b.parentSelectable, b.children.map((c) => c.id)]), [
			["keep", true, ["girl"]],
			["yard", true, []],
			["hist", true, ["ming", "tang"]],
		]);
	});

	it("keeps a parent visible when only a child matches search", () => {
		const tree = folderSelectTree(folders, { query: "大明" });
		assert.equal(tree.length, 1);
		assert.equal(tree[0]?.parent.id, "hist");
		assert.deepEqual(tree[0]?.children.map((c) => c.id), ["ming"]);
	});

	it("shows all children when the parent name matches", () => {
		const tree = folderSelectTree(folders, { query: "历史" });
		assert.equal(tree[0]?.parent.id, "hist");
		assert.deepEqual(tree[0]?.children.map((c) => c.id), ["ming", "tang"]);
	});

	it("marks an excluded parent as a header but still lists its children", () => {
		const tree = folderSelectTree(folders, { excludeIds: ["keep"] });
		const keep = tree.find((b) => b.parent.id === "keep");
		assert.equal(keep?.parentSelectable, false);
		assert.deepEqual(keep?.children.map((c) => c.id), ["girl"]);
		assert.equal(tree.find((b) => b.parent.id === "yard")?.parentSelectable, true);
	});

	it("lists only children when picking subfolders", () => {
		const tree = folderSelectTree(folders, { onlyChildrenOf: "hist" });
		assert.equal(tree.length, 1);
		assert.equal(tree[0]?.parentSelectable, false);
		assert.deepEqual(tree[0]?.children.map((c) => c.id), ["ming", "tang"]);
	});
});
