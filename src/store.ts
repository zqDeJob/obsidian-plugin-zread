import type { Book, ChannelState, Persisted, Platform, ShelfFolder, ZReadSettings } from "./model";
import {
	DEFAULT_SETTINGS,
	dropSeedBooks,
	defaultChannels,
	newId,
	nowStr,
	todayStr,
	type BindMethod,
} from "./model";
import {
	createFolder,
	deleteFolder,
	dissolveFolders,
	foldersOfBook,
	nextFolderName,
	placeBookInFolder,
	removeBookFromFolder,
	renameFolder,
	syncFoldersAfterMerge,
	ungroupBooks,
	sortBooks,
	canAddBookToFolder,
	isArchiveFolder,
	isArchivedBook,
} from "./folders";

export class ReadStore {
	settings: ZReadSettings = { ...DEFAULT_SETTINGS };
	books: Book[] = [];
	channels: Record<string, ChannelState> = defaultChannels();
	customPlatforms: Platform[] = [];
	folders: ShelfFolder[] = [];
	folderSeeded = false;

	constructor(
		private load: () => Promise<Persisted | null>,
		private save: (data: Persisted) => Promise<void>,
	) {}

	async loadAll(): Promise<void> {
		const data = await this.load();
		this.settings = { ...DEFAULT_SETTINGS, ...data?.settings };
		this.channels = { ...defaultChannels(), ...data?.channels };
		this.customPlatforms = data?.customPlatforms ?? [];
		this.folders = Array.isArray(data?.folders) ? data.folders : [];
		this.folderSeeded = Boolean(data?.folderSeeded) || this.folders.length > 0;
		const raw = Array.isArray(data?.books) ? data.books.map(normalizeBook) : [];
		this.books = dropSeedBooks(raw);
		this.applyFolderSync();
		if (raw.length !== this.books.length || this.folderSeeded !== Boolean(data?.folderSeeded)) await this.persist();
	}

	async persist(): Promise<void> {
		await this.save({
			settings: this.settings,
			books: this.books,
			channels: this.channels,
			customPlatforms: this.customPlatforms,
			folders: this.folders,
			folderSeeded: this.folderSeeded,
		});
	}

	get(id: string): Book | undefined {
		return this.books.find((b) => b.id === id);
	}

	list(filter: string, query: string, sort: "recent" | "progress" | "title"): Book[] {
		let list = this.books.slice();
		if (filter && filter !== "all") list = list.filter((b) => b.source === filter);
		const q = query.trim().toLowerCase();
		if (q) list = list.filter((b) => (b.title + b.author).toLowerCase().includes(q));
		return sortBooks(list, sort);
	}

	async upsertBook(book: Book): Promise<void> {
		const i = this.books.findIndex((b) => b.id === book.id);
		if (i >= 0) this.books[i] = book;
		else this.books.unshift(book);
		await this.persist();
	}

	async removeBook(id: string): Promise<void> {
		this.books = this.books.filter((b) => b.id !== id);
		await this.persist();
	}

	async bind(id: string, account: string, method: BindMethod, extra?: { cookies?: { name: string; value: string }[]; apiKey?: string }): Promise<void> {
		this.channels[id] = {
			bound: true,
			account,
			method,
			lastSync: nowStr(),
			cookies: extra?.cookies,
			apiKey: extra?.apiKey,
		};
		await this.persist();
	}

	async unbind(id: string): Promise<void> {
		this.channels[id] = { bound: false, account: "", lastSync: "" };
		await this.persist();
	}

	async mergeSourceBooks(source: string, incoming: Book[]): Promise<void> {
		const previous = this.books.filter((b) => b.source === source);
		const byRemote = new Map(previous.map((b) => [b.remoteId || b.id, b]));
		const merged = incoming.map((book) => {
			const old = byRemote.get(book.remoteId || book.id);
			if (!old) return book;
			return {
				...book,
				cover: book.cover || old.cover,
				lastRead: book.lastRead || old.lastRead,
				kind: book.kind || old.kind,
				markCount: book.markCount ?? old.markCount,
				reviewCount: book.reviewCount ?? old.reviewCount,
				notes: old.notes.length ? old.notes : book.notes,
				highlights: old.highlights.length ? old.highlights : book.highlights,
			};
		});
		this.books = [...merged, ...this.books.filter((b) => b.source !== source)];
		this.applyFolderSync();
		await this.persist();
	}

	foldersOf(bookId: string): ShelfFolder[] {
		return foldersOfBook(this.folders, bookId);
	}

	async createFolderFromBooks(bookIds: string[], name?: string, parentId?: string, source?: string): Promise<ShelfFolder> {
		const parent = parentId ? this.folders.find((f) => f.id === parentId) : undefined;
		const members = bookIds.map((id) => this.get(id)).filter((b): b is Book => Boolean(b));
		const guessed = members[0]?.source;
		const src = parent?.source || source || (guessed && members.every((b) => b.source === guessed) ? guessed : undefined);
		const ids = src
			? bookIds.filter((id) => {
				const book = this.get(id);
				return !book || book.source === src;
			})
			: bookIds;
		const { folders, folder } = createFolder(
			this.folders,
			name?.trim() || nextFolderName(this.folders, parentId, src),
			ids,
			() => newId("fld"),
			parentId,
			src,
		);
		this.folders = folders;
		this.folderSeeded = true;
		await this.persist();
		return folder;
	}

	async addToFolder(folderId: string, bookId: string): Promise<boolean> {
		return this.placeInFolder(folderId, bookId, "keep");
	}

	async placeInFolder(
		targetId: string,
		bookId: string,
		mode: "move" | "keep",
		leaveFolderIds?: string[],
	): Promise<boolean> {
		const folder = this.folders.find((f) => f.id === targetId);
		const book = this.get(bookId);
		if (!folder || !book || !canAddBookToFolder(folder, book)) return false;
		if (isArchivedBook(book.id, this.folders) && !isArchiveFolder(this.folders, folder)) return false;
		const exclusive = isArchiveFolder(this.folders, folder);
		this.folders = placeBookInFolder(
			this.folders,
			targetId,
			bookId,
			exclusive ? "move" : mode,
			book.source,
			exclusive ? undefined : leaveFolderIds,
			exclusive,
		);
		this.folderSeeded = true;
		await this.persist();
		return this.foldersOf(bookId).some((f) => f.id === targetId);
	}

	async removeFromFolder(folderId: string, bookId: string): Promise<void> {
		this.folders = removeBookFromFolder(this.folders, folderId, bookId);
		await this.persist();
	}

	async renameFolder(folderId: string, name: string): Promise<void> {
		this.folders = renameFolder(this.folders, folderId, name);
		await this.persist();
	}

	async deleteFolder(folderId: string): Promise<void> {
		this.folders = deleteFolder(this.folders, folderId);
		await this.persist();
	}

	async dissolveFolders(folderIds: string[]): Promise<void> {
		this.folders = dissolveFolders(this.folders, folderIds);
		await this.persist();
	}

	async ungroupBooks(bookIds: string[]): Promise<void> {
		this.folders = ungroupBooks(this.folders, bookIds);
		await this.persist();
	}

	private applyFolderSync(): void {
		const next = syncFoldersAfterMerge({
			folders: this.folders,
			folderSeeded: this.folderSeeded,
			books: this.books,
			newId: () => newId("fld"),
		});
		this.folders = next.folders;
		this.folderSeeded = next.folderSeeded;
	}

	async touchSync(ids: string[]): Promise<void> {
		const t = nowStr();
		for (const id of ids) {
			const ch = this.channels[id];
			if (ch?.bound) ch.lastSync = t;
		}
		await this.persist();
	}

	async addPlatform(p: Platform): Promise<void> {
		this.customPlatforms.push(p);
		await this.persist();
	}

	async importLocal(file: { name: string; text: string; ext: string }): Promise<Book> {
		const title = file.name.replace(/\.[^.]+$/, "");
		const book: Book = {
			id: newId("loc"),
			source: "local",
			title,
			author: "本地",
			progress: 0,
			lastRead: todayStr(),
			format: file.ext,
			kind: "file",
			chapters: ["全文"],
			text: file.text,
			highlights: [],
			notes: [],
		};
		this.books.unshift(book);
		await this.persist();
		return book;
	}
}

function normalizeBook(b: Book): Book {
	return {
		...b,
		chapters: b.chapters?.length ? b.chapters : ["全文"],
		text: b.text ?? "",
		highlights: b.highlights ?? [],
		notes: (b.notes ?? []).map((n, i) => ({
			id: n.id || `n-legacy-${i}`,
			text: n.text,
			chapter: n.chapter ?? "",
			at: n.at ?? "",
			from: n.from ?? "手写",
		})),
	};
}
