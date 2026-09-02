import type { Book, ShelfFolder, SortKey } from "./model";

export type { ShelfFolder };

export function nextFolderName(existing: ShelfFolder[], parentId?: string, source?: string): string {
	const siblings = existing.filter((f) => (
		(f.parentId ?? "") === (parentId ?? "")
		&& (!source || !f.source || f.source === source)
	));
	const used = new Set(siblings.map((f) => f.name));
	let n = 1;
	while (used.has(`分组 ${n}`)) n++;
	return `分组 ${n}`;
}

export function childFolders(folders: ShelfFolder[], parentId: string): ShelfFolder[] {
	return folders.filter((f) => f.parentId === parentId);
}

export function canNestUnder(folders: ShelfFolder[], parentId: string): boolean {
	const parent = folders.find((f) => f.id === parentId);
	return Boolean(parent && !parent.parentId);
}

export function folderPath(folders: ShelfFolder[], folder: ShelfFolder): string {
	if (!folder.parentId) return folder.name;
	const parent = folders.find((f) => f.id === folder.parentId);
	return parent ? `${parent.name} / ${folder.name}` : folder.name;
}

export type FolderTreeBranch = {
	parent: ShelfFolder;
	parentSelectable: boolean;
	children: ShelfFolder[];
};

export function folderSelectTree(
	folders: ShelfFolder[],
	opts: {
		query?: string;
		excludeIds?: Iterable<string>;
		source?: string;
		onlyChildrenOf?: string;
		include?: (folder: ShelfFolder) => boolean;
	} = {},
): FolderTreeBranch[] {
	const q = (opts.query ?? "").trim().toLowerCase();
	const exclude = new Set(opts.excludeIds ?? []);
	const source = opts.source ?? "";
	const include = opts.include ?? (() => true);
	const allowed = (folder: ShelfFolder) => {
		if (!include(folder)) return false;
		if (source && folder.source && folder.source !== source) return false;
		return true;
	};
	const hit = (folder: ShelfFolder) => !q || folderPath(folders, folder).toLowerCase().includes(q);

	if (opts.onlyChildrenOf) {
		const parent = folders.find((f) => f.id === opts.onlyChildrenOf);
		if (!parent) return [];
		const children = sortFolders(
			childFolders(folders, parent.id).filter((f) => allowed(f) && !exclude.has(f.id) && hit(f)),
		);
		return children.length ? [{ parent, parentSelectable: false, children }] : [];
	}

	const branches: FolderTreeBranch[] = [];
	for (const parent of sortFolders(folders.filter((f) => !f.parentId && allowed(f)))) {
		const kidsAll = sortFolders(
			childFolders(folders, parent.id).filter((f) => allowed(f) && !exclude.has(f.id)),
		);
		const parentHit = hit(parent);
		const children = parentHit ? kidsAll : kidsAll.filter(hit);
		const parentSelectable = !exclude.has(parent.id);
		if (!children.length && (!parentSelectable || !parentHit)) continue;
		branches.push({ parent, parentSelectable, children });
	}
	return branches;
}

export function folderBookIdsInclusive(folders: ShelfFolder[], folder: ShelfFolder): string[] {
	const ids = new Set(folder.bookIds);
	for (const child of childFolders(folders, folder.id)) {
		for (const id of child.bookIds) ids.add(id);
	}
	return [...ids];
}

function cleanFolder(folder: ShelfFolder): ShelfFolder {
	return {
		id: folder.id,
		name: folder.name,
		bookIds: folder.bookIds,
		...(folder.parentId ? { parentId: folder.parentId } : {}),
		...(folder.source ? { source: folder.source } : {}),
	};
}

function sourcesOfBooks(bookIds: string[], books: Map<string, Book>): string[] {
	const found = new Set<string>();
	for (const id of bookIds) {
		const source = books.get(id)?.source;
		if (source) found.add(source);
	}
	return [...found];
}

export function normalizeFolders(
	folders: ShelfFolder[],
	books: Book[] = [],
	newId?: () => string,
): ShelfFolder[] {
	const bookById = new Map(books.map((b) => [b.id, b]));
	const byId = new Map(folders.map((f) => [f.id, f]));
	const fixed = folders.map((f) => {
		if (!f.parentId) return cleanFolder({ ...f, parentId: undefined });
		const parent = byId.get(f.parentId);
		if (!parent || parent.parentId || parent.id === f.id) {
			return cleanFolder({ ...f, parentId: undefined });
		}
		return cleanFolder(f);
	});
	const inferred = fixed.map((f) => {
		if (f.source) return f;
		const parent = f.parentId ? fixed.find((p) => p.id === f.parentId) : undefined;
		if (parent?.source) return cleanFolder({ ...f, source: parent.source });
		const only = sourcesOfBooks(f.bookIds, bookById);
		if (only.length === 1) return cleanFolder({ ...f, source: only[0] });
		return f;
	});
	const aligned = inferred.map((f) => {
		const parent = f.parentId ? inferred.find((p) => p.id === f.parentId) : undefined;
		if (!f.parentId) return f;
		if (parent?.source && f.source && parent.source !== f.source) {
			return cleanFolder({ ...f, parentId: undefined });
		}
		if (parent?.source && !f.source) return cleanFolder({ ...f, source: parent.source });
		return f;
	});
	const stripped = aligned.map((f) => {
		if (!f.source) return f;
		return cleanFolder({
			...f,
			bookIds: f.bookIds.filter((id) => {
				const book = bookById.get(id);
				return !book || book.source === f.source;
			}),
		});
	});
	const split = !newId ? stripped : stripped.flatMap((f) => {
		if (f.source) return [f];
		const groups = new Map<string, string[]>();
		for (const id of f.bookIds) {
			const source = bookById.get(id)?.source;
			if (!source) continue;
			const ids = groups.get(source) ?? [];
			ids.push(id);
			groups.set(source, ids);
		}
		if (groups.size <= 1) {
			const only = [...groups.keys()][0];
			return [cleanFolder({ ...f, ...(only ? { source: only } : {}), bookIds: only ? groups.get(only) ?? [] : f.bookIds })];
		}
		const parent = f.parentId ? stripped.find((p) => p.id === f.parentId) : undefined;
		return [...groups.entries()].map(([source, bookIds], i) => cleanFolder({
			id: i === 0 ? f.id : newId(),
			name: f.name,
			bookIds,
			source,
			...(parent?.source === source ? { parentId: f.parentId } : {}),
		}));
	});
	return exclusiveArchivedFolders(split);
}

export const ARCHIVE_FOLDER_MARK = "完本留存";

export function isArchiveFolder(folders: ShelfFolder[], folder: ShelfFolder): boolean {
	let current: ShelfFolder | undefined = folder;
	const seen = new Set<string>();
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		if (current.name.includes(ARCHIVE_FOLDER_MARK)) return true;
		current = current.parentId ? folders.find((f) => f.id === current?.parentId) : undefined;
	}
	return false;
}

export function isArchivedBook(bookId: string, folders: ShelfFolder[]): boolean {
	return folders.some((f) => f.bookIds.includes(bookId) && isArchiveFolder(folders, f));
}

export function exclusiveArchivedFolders(folders: ShelfFolder[]): ShelfFolder[] {
	const archived = new Set<string>();
	for (const folder of folders) {
		if (!isArchiveFolder(folders, folder)) continue;
		for (const id of folder.bookIds) archived.add(id);
	}
	if (!archived.size) return folders;
	return folders.map((f) => (
		isArchiveFolder(folders, f) ? f : { ...f, bookIds: f.bookIds.filter((id) => !archived.has(id)) }
	));
}

export function seedFoldersFromBooks(books: Book[], newId: () => string): ShelfFolder[] {
	const map = new Map<string, { name: string; source: string; bookIds: string[] }>();
	for (const book of books) {
		const name = book.group?.trim();
		if (!name) continue;
		const key = `${book.source}\0${name}`;
		const row = map.get(key) ?? { name, source: book.source, bookIds: [] };
		row.bookIds.push(book.id);
		map.set(key, row);
	}
	return Array.from(map.values()).map((row) => ({
		id: newId(),
		name: row.name,
		bookIds: row.bookIds,
		source: row.source,
	}));
}

export function foldersOfBook(folders: ShelfFolder[], bookId: string): ShelfFolder[] {
	return folders.filter((f) => f.bookIds.includes(bookId));
}

export function ungroupedBooks(books: Book[], folders: ShelfFolder[]): Book[] {
	const inAny = new Set(folders.flatMap((f) => f.bookIds));
	return books.filter((b) => !inAny.has(b.id));
}

export type GroupFilter = "all" | "none" | "in";

export function filterByGrouped(books: Book[], folders: ShelfFolder[], filter: GroupFilter): Book[] {
	if (filter === "all") return books;
	const inAny = new Set(folders.flatMap((f) => f.bookIds));
	return books.filter((b) => (filter === "none" ? !inAny.has(b.id) : inAny.has(b.id)));
}

export function createFolder(
	folders: ShelfFolder[],
	name: string,
	bookIds: string[],
	newId: () => string,
	parentId?: string,
	source?: string,
): { folders: ShelfFolder[]; folder: ShelfFolder } {
	const nestId = parentId && canNestUnder(folders, parentId) ? parentId : undefined;
	const parent = nestId ? folders.find((f) => f.id === nestId) : undefined;
	const src = parent?.source || source;
	const unique = [...new Set(bookIds.filter(Boolean))];
	const folder: ShelfFolder = {
		id: newId(),
		name: name.trim() || nextFolderName(folders, nestId, src),
		bookIds: unique,
		...(nestId ? { parentId: nestId } : {}),
		...(src ? { source: src } : {}),
	};
	return { folders: [...folders, folder], folder };
}

export function canAddBookToFolder(folder: Pick<ShelfFolder, "source">, book: Pick<Book, "source">): boolean {
	return !folder.source || folder.source === book.source;
}

export function sharedSource(items: { source?: string }[]): string | undefined {
	const first = items[0]?.source;
	if (!first || items.some((item) => item.source !== first)) return undefined;
	return first;
}

export function addBookToFolder(folders: ShelfFolder[], folderId: string, bookId: string, bookSource?: string): ShelfFolder[] {
	return folders.map((f) => {
		if (f.id !== folderId || f.bookIds.includes(bookId)) return f;
		if (bookSource && f.source && f.source !== bookSource) return f;
		return {
			...f,
			bookIds: [...f.bookIds, bookId],
			...(!f.source && bookSource ? { source: bookSource } : {}),
		};
	});
}

export function placeBookInFolder(
	folders: ShelfFolder[],
	targetId: string,
	bookId: string,
	mode: "move" | "keep",
	bookSource?: string,
	leaveFolderIds?: string[],
	exclusive?: boolean,
): ShelfFolder[] {
	const added = addBookToFolder(folders, targetId, bookId, bookSource);
	if (!added.find((f) => f.id === targetId)?.bookIds.includes(bookId)) return folders;
	if (mode !== "move" && !exclusive) return added;
	const leave = new Set(
		(exclusive ? added.filter((f) => f.bookIds.includes(bookId)).map((f) => f.id) : (leaveFolderIds ?? added.filter((f) => f.bookIds.includes(bookId)).map((f) => f.id)))
			.filter((id) => id !== targetId),
	);
	return added.map((f) => (
		leave.has(f.id) ? { ...f, bookIds: f.bookIds.filter((id) => id !== bookId) } : f
	));
}

export function removeBookFromFolder(folders: ShelfFolder[], folderId: string, bookId: string): ShelfFolder[] {
	return folders.map((f) => (
		f.id === folderId ? { ...f, bookIds: f.bookIds.filter((id) => id !== bookId) } : f
	));
}

export function renameFolder(folders: ShelfFolder[], folderId: string, name: string): ShelfFolder[] {
	const trimmed = name.trim();
	if (!trimmed) return folders;
	return folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f));
}

export function deleteFolder(folders: ShelfFolder[], folderId: string): ShelfFolder[] {
	return dissolveFolders(folders, [folderId]);
}

export function dissolveFolders(folders: ShelfFolder[], folderIds: string[]): ShelfFolder[] {
	const drop = new Set(folderIds);
	for (const f of folders) {
		if (f.parentId && drop.has(f.parentId)) drop.add(f.id);
	}
	return folders.filter((f) => !drop.has(f.id));
}

export function ungroupBooks(folders: ShelfFolder[], bookIds: string[]): ShelfFolder[] {
	const drop = new Set(bookIds);
	return folders.map((f) => ({
		...f,
		bookIds: f.bookIds.filter((id) => !drop.has(id)),
	}));
}

export function pruneFolders(folders: ShelfFolder[], liveIds: Set<string>): ShelfFolder[] {
	return folders.map((f) => ({
		...f,
		bookIds: f.bookIds.filter((id) => liveIds.has(id)),
	}));
}

export function folderShowsOnWall(
	folder: ShelfFolder,
	visibleBookIds: Set<string>,
	query: string,
	all: ShelfFolder[] = [folder],
): boolean {
	const q = query.trim().toLowerCase();
	const kids = childFolders(all, folder.id);
	const ids = folderBookIdsInclusive(all, folder);
	if (q) {
		if (folder.name.toLowerCase().includes(q)) return true;
		if (kids.some((k) => k.name.toLowerCase().includes(q))) return true;
		return ids.some((id) => visibleBookIds.has(id));
	}
	if (ids.some((id) => visibleBookIds.has(id))) return true;
	return ids.length === 0;
}

export function wallFolders(
	folders: ShelfFolder[],
	visibleBookIds: Set<string>,
	query: string,
	sourceFilter?: string,
): ShelfFolder[] {
	const source = sourceFilter && sourceFilter !== "all" ? sourceFilter : "";
	return folders.filter((f) => {
		if (f.parentId) return false;
		if (source && f.source !== source) return false;
		return folderShowsOnWall(f, visibleBookIds, query, folders);
	});
}

export function compareBooks(a: Book, b: Book, sort: SortKey): number {
	if (sort === "recent") return (b.lastRead || "").localeCompare(a.lastRead || "");
	if (sort === "progress") return b.progress - a.progress;
	return a.title.localeCompare(b.title, "zh");
}

export function sortBooks(books: Book[], sort: SortKey): Book[] {
	return books.slice().sort((a, b) => compareBooks(a, b, sort));
}

export function sortFolders(folders: ShelfFolder[]): ShelfFolder[] {
	return folders.slice().sort((a, b) => a.name.localeCompare(b.name, "zh", { numeric: true }));
}

export function syncFoldersAfterMerge(input: {
	folders: ShelfFolder[];
	folderSeeded: boolean;
	books: Book[];
	newId: () => string;
}): { folders: ShelfFolder[]; folderSeeded: boolean } {
	const live = new Set(input.books.map((b) => b.id));
	const pruned = normalizeFolders(pruneFolders(input.folders, live), input.books, input.newId);
	if (input.folderSeeded) return { folders: pruned, folderSeeded: true };
	const seeded = seedFoldersFromBooks(input.books, input.newId);
	if (seeded.length) return { folders: seeded, folderSeeded: true };
	return { folders: pruned, folderSeeded: false };
}
