import { ItemView, Menu, Notice, Platform, TFile, normalizePath, type WorkspaceLeaf } from "obsidian";
import type ZReadPlugin from "./main";
import {
	BIND_IDS,
	FOLDER_PRESETS,
	PLATFORMS,
	SOURCES,
	VIEW_TYPE,
	esc,
	hasNativeText,
	newId,
	nowStr,
	openUrl,
	sourceOf,
	todayStr,
	vaultPath,
	type Book,
	type BindMethod,
	type MainView,
	type Note,
	type ShelfFolder,
	type ShelfMode,
	type SortKey,
} from "./model";
import { canAddBookToFolder, canNestUnder, childFolders, filterByGrouped, folderBookIdsInclusive, folderPath, folderSelectTree, isArchiveFolder, isArchivedBook, nextFolderName, sharedSource, sortBooks, sortFolders, ungroupedBooks, wallFolders, type FolderTreeBranch, type GroupFilter } from "./folders";
import { loadNotesFromVault, writeNoteToVault } from "./notes";
import { qrSvg } from "./qr";
import { isApiKey, parseCookieHeader } from "./weread-map";
import { guestViewportPx, keepInGuestScript, wereadHeightCss, wereadHeightScript } from "./webview-guest";
import {
	completeFanqieSession,
	fanqieCookiesReady,
	fetchFanqieBooks,
	normalizeFanqieCookie,
	pollFanqieQr,
	startFanqieQr,
	writeFanqiePartitionCookies,
	type FanqieQrPending,
} from "./fanqie";
import {
	completeWereadSession,
	fetchCoverDataUrl,
	fetchWereadNotebooks,
	loginWeread,
} from "./weread";

export class ZReadView extends ItemView {
	plugin: ZReadPlugin;
	page: MainView = "shelf";
	filter = "all";
	mode: ShelfMode = "mix";
	query = "";
	sort: SortKey = "recent";
	private lens: "all" | "groups" = "all";
	private groupFilter: GroupFilter = "all";
	private openFolderId: string | null = null;
	private namingOpen = false;
	private namingParentId: string | null = null;
	private namingSource = "";
	private selecting = false;
	private folderSelecting = false;
	private pickSubfoldersOnly = false;
	private selectedFolderIds = new Set<string>();
	private selectedBookIds = new Set<string>();
	private moveBookIds: string[] = [];
	private folderPickQuery = "";
	private pendingPickFolderId: string | null = null;
	private pendingCopyFolderId: string | null = null;
	private folderMoveQuery = "";
	private folderBookQuery = "";
	private pendingDissolveIds: string[] = [];
	private dragBookId: string | null = null;
	private skipBookClick = false;
	private dragTicks = 0;
	selectedId: string | null = null;
	chapter = 0;
	bindId: string | null = null;
	bindTab: BindMethod = "qr";
	storePlatformId = "weread";
	private importOpen = false;
	private wereadBusy = false;
	private fanqieBusy = false;
	private fanqieQr: FanqieQrPending | null = null;
	private fanqieQrHint = "";
	private fanqiePoll: number | null = null;
	private fanqieTick = 0;
	private eventsBound = false;
	private coverBytes = new Map<string, string>();
	private coverLoading = false;
	private webviewRo: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ZReadPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Z-Read";
	}

	getIcon(): string {
		return "book-open";
	}

	async onClose(): Promise<void> {
		this.stopFanqieQr(true);
		this.webviewRo?.disconnect();
		this.webviewRo = null;
		this.contentEl.empty();
	}

	openImport(): void {
		this.page = "shelf";
		this.importOpen = true;
		this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("zread");
		if (!this.eventsBound) {
			this.registerDomEvent(this.contentEl, "click", (e) => void this.onClick(e));
			this.registerDomEvent(this.contentEl, "input", (e) => void this.onInput(e));
			this.registerDomEvent(this.contentEl, "compositionend", (e) => this.onSearchCompositionEnd(e));
			this.registerDomEvent(this.contentEl, "change", (e) => void this.onChange(e));
			this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKey(e));
			this.registerDomEvent(this.contentEl, "dragstart", (e) => this.onDragStart(e));
			this.registerDomEvent(this.contentEl, "dragover", (e) => this.onDrag(e, true));
			this.registerDomEvent(this.contentEl, "dragleave", (e) => this.onDrag(e, false));
			this.registerDomEvent(this.contentEl, "drop", (e) => void this.onDrop(e));
			this.registerDomEvent(this.contentEl, "dragend", () => this.onDragEnd());
			this.registerDomEvent(this.contentEl, "contextmenu", (e) => this.onContextMenu(e));
			this.eventsBound = true;
		}
		this.render();
		void this.refreshWereadShelf();
		void this.refreshFanqieShelf();
	}

	async refresh(): Promise<void> {
		this.render();
	}

	private store() {
		return this.plugin.store;
	}

	private shelfHeadActions(): string {
		const pickingBooks = this.selecting && this.lens === "all";
		const pickingFolders = this.selecting && this.lens === "groups";
		const selectable = pickingBooks ? this.selectableShelfBooks() : [];
		const allOn = selectable.length > 0 && selectable.every((b) => this.selectedBookIds.has(b.id));
		const selectAll = pickingBooks
			? `<button class="ghost${allOn ? " on" : ""}" type="button" data-act="toggle-select-all"${selectable.length ? "" : " disabled"}>${allOn ? "取消全选" : "全选"}</button>`
			: "";
		const join = pickingBooks
			? `<button class="ghost accent" type="button" data-act="join-selected"${this.selectedBookIds.size ? "" : " disabled"}>加入分组</button>`
			: "";
		const dissolve = pickingFolders
			? `<button class="ghost danger" type="button" data-act="dissolve-selected"${this.selectedFolderIds.size ? "" : " disabled"}>打散</button>`
			: "";
		return `
			<button class="ghost accent" type="button" data-act="new-folder">新建分组</button>
			<button class="ghost${this.selecting ? " on" : ""}" type="button" data-act="toggle-select">${this.selecting ? "取消选择" : "选择"}</button>
			${selectAll}${join}${dissolve}`;
	}

	private pickMark(on: boolean, locked = false): string {
		if (!this.selecting && !this.folderSelecting) return "";
		return `<span class="pick-mark${on ? " on" : ""}${locked ? " locked" : ""}"></span>`;
	}

	private movingBooks(): Book[] {
		return this.moveBookIds.map((id) => this.store().get(id)).filter((b): b is Book => Boolean(b));
	}

	private movingLabel(): string {
		const books = this.movingBooks();
		if (books.length === 1) return `「${esc(books[0]!.title)}」`;
		if (books.length > 1) return `这 ${books.length} 本`;
		return "这本书";
	}

	private render(): void {
		const show = (name: MainView) => this.page === name ? "on" : "";
		const tabOn = (name: MainView) =>
			this.page === name || (name === "shelf" && this.page === "reader") ? "on" : "";
		this.contentEl.innerHTML = `
			<div class="workspace">
				<header class="zread-head">
					<div class="brand">Z-Read</div>
					<nav class="tabs">
						<button data-act="nav" data-view="shelf" class="${tabOn("shelf")}">书架</button>
						<button data-act="nav" data-view="store" class="${tabOn("store")}">书城</button>
						<button data-act="nav" data-view="channels" class="${tabOn("channels")}">渠道</button>
						<button data-act="nav" data-view="settings" class="${tabOn("settings")}">设置</button>
					</nav>
					<div class="head-ops">
						<button class="ghost" data-act="open-import" title="导入本地书籍">导入</button>
						<button class="btn" data-act="sync-all" title="同步已绑定渠道">同步</button>
					</div>
				</header>
				<div class="zread-main">
					<section class="view zread-shelf ${show("shelf")}" data-page="shelf">${this.page === "shelf" ? this.shelfHtml() : ""}</section>
					<section class="view zread-store ${show("store")}" data-page="store">${this.page === "store" ? this.storeHtml() : ""}</section>
					<section class="view zread-channels ${show("channels")}" data-page="channels">${this.page === "channels" ? this.channelsHtml() : ""}</section>
					<section class="view zread-reader ${show("reader")}" data-page="reader">${this.page === "reader" ? this.readerHtml() : ""}</section>
					<section class="view zread-settings ${show("settings")}" data-page="settings">${this.page === "settings" ? this.settingsHtml() : ""}</section>
				</div>
			</div>
			<div class="zread-overlay ${this.importOpen ? "on" : ""}" data-overlay="import">
				<div class="zread-dialog">
					<h2 style="margin:0 0 8px;font-size:18px;">导入本地书籍</h2>
					<p class="muted">TXT / Markdown 会读进阅读器；EPUB / PDF 只登记到书架。</p>
					<div class="drop" data-drop="1">把文件拖到这里，或
						<label class="btn" style="display:inline-block;margin-top:10px;">选择文件
							<input class="file-input" type="file" accept=".txt,.md,.epub,.pdf,.mobi,.azw3" multiple hidden />
						</label>
					</div>
					<div class="row"><button class="ghost" type="button" data-act="close-import">取消</button></div>
				</div>
			</div>
			<div class="zread-overlay ${this.bindId ? "on" : ""}" data-overlay="bind">
				<div class="zread-dialog bind-dialog">${this.bindId ? this.bindHtml() : ""}</div>
			</div>
			<div class="zread-overlay ${this.openFolderId ? "on" : ""}" data-overlay="folder">
				<div class="zread-dialog folder-dialog">${this.openFolderId ? this.folderDialogHtml() : ""}</div>
			</div>
			<div class="zread-overlay ${this.namingOpen ? "on" : ""}" data-overlay="folder-name">
				<div class="zread-dialog">${this.namingOpen ? this.folderNameDialogHtml() : ""}</div>
			</div>
			<div class="zread-overlay ${this.moveBookIds.length ? "on" : ""}" data-overlay="folder-pick">
				<div class="zread-dialog">${this.moveBookIds.length ? this.folderPickDialogHtml() : ""}</div>
			</div>
			<div class="zread-overlay ${this.pendingDissolveIds.length ? "on" : ""}" data-overlay="dissolve">
				<div class="zread-dialog">${this.pendingDissolveIds.length ? this.dissolveDialogHtml() : ""}</div>
			</div>`;
		this.mountWebview();
		this.bindCovers();
		this.focusDialogField();
	}

	private bindCovers(): void {
		this.contentEl.querySelectorAll<HTMLImageElement>(".jacket img, .cover-lg img").forEach((img) => {
			const wrap = img.parentElement;
			const show = () => wrap?.classList.add("has-cover");
			if (img.complete && img.naturalWidth) show();
			img.addEventListener("load", show);
			img.addEventListener("error", () => {
				img.remove();
				wrap?.classList.remove("has-cover");
			});
		});
	}

	private shelfHtml(): string {
		const store = this.store();
		const counts = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, store.books.filter((b) => b.source === k).length]));
		const srcBtns = [{ id: "all", name: "全部", color: "var(--lamp)", n: store.books.length }]
			.concat(Object.values(SOURCES).map((s) => ({ ...s, n: counts[s.id] || 0 })))
			.map((s) => `<button type="button" class="${this.filter === s.id ? "on" : ""}" data-act="filter" data-id="${s.id}">
				<span class="dot" style="background:${s.color}"></span>${esc(s.name)}<span class="count">${s.n}</span>
			</button>`).join("");
		const groupN = this.groupFilterCounts();
		const groupBtns = [
			{ id: "all", name: "全部", n: groupN.all },
			{ id: "none", name: "未分组", n: groupN.none },
			{ id: "in", name: "已分组", n: groupN.in },
		].map((s) => `<button type="button" class="${this.groupFilter === s.id ? "on" : ""}" data-act="group-filter" data-id="${s.id}">
			${esc(s.name)}<span class="count">${s.n}</span>
		</button>`).join("");
		return `
			<aside class="side">
				<h2>来源</h2>
				<div class="src-list">${srcBtns}</div>
				<h2>分组</h2>
				<div class="src-list">${groupBtns}</div>
			</aside>
			<div class="library">
				<div class="lib-top">
					<div class="lib-toolbar">
						${this.searchFieldHtml("search", this.lens === "groups" ? "搜索书名、作者或分组" : "搜索书名或作者", this.query, "shelf")}
						<div class="lens-tabs">
							<button type="button" class="${this.lens === "all" ? "on" : ""}" data-act="lens" data-id="all">全部</button>
							<button type="button" class="${this.lens === "groups" ? "on" : ""}" data-act="lens" data-id="groups">分组</button>
						</div>
					</div>
					<div class="lib-rail">
						${this.lens === "all"
							? (this.selecting
								? `<span class="rail-hint">可全选当前筛选。已在完本留存里的不能再勾</span>`
								: `<div class="mode-tabs">
							<button type="button" class="chip ${this.mode === "split" ? "on" : ""}" data-act="mode" data-id="split">分来源</button>
							<button type="button" class="chip ${this.mode === "mix" ? "on" : ""}" data-act="mode" data-id="mix">按年份</button>
						</div>`)
							: `<span class="rail-hint">${this.selecting ? "勾选分组后打散" : "把书拖进分组，或右键移动"}</span>`}
						<label class="sort-wrap">排序
							<select class="sort-sel">
								<option value="recent" ${this.sort === "recent" ? "selected" : ""}>最近阅读</option>
								<option value="progress" ${this.sort === "progress" ? "selected" : ""}>阅读进度</option>
								<option value="title" ${this.sort === "title" ? "selected" : ""}>书名</option>
							</select>
						</label>
						<div class="group-ops">${this.shelfHeadActions()}</div>
					</div>
				</div>
				<div class="lib-results">${this.shelfResultsHtml()}</div>
			</div>`;
	}

	private shelfBooks(source = this.filter): Book[] {
		return filterByGrouped(this.store().list(source, this.query, this.sort), this.store().folders, this.groupFilter);
	}

	private groupFilterCounts(): { all: number; none: number; in: number } {
		const scoped = this.filter === "all"
			? this.store().books
			: this.store().books.filter((b) => b.source === this.filter);
		const none = filterByGrouped(scoped, this.store().folders, "none").length;
		return { all: scoped.length, none, in: scoped.length - none };
	}

	private shelfResultsHtml(): string {
		const list = this.shelfBooks();
		const noteN = list.reduce((n, b) => n + b.notes.length, 0);
		let shelves = "";
		if (!list.length && this.lens === "all") {
			if (this.groupFilter === "none") {
				shelves = `<div class="empty">没有未分组的书。当前筛选下都已经进组了。</div>`;
			} else if (this.groupFilter === "in") {
				shelves = `<div class="empty">没有已分组的书。点「未分组」把书拖进分组，或右键移动。</div>`;
			} else {
				shelves = `<div class="empty">${this.query.trim() || this.filter !== "all" ? "没有匹配的书" : "书架是空的。去「书城」打开站点，或点右上角「导入」。"}</div>`;
			}
		} else if (this.lens === "groups") {
			shelves = this.folderWallHtml(list);
		} else if (this.mode === "mix" || this.filter !== "all") {
			shelves = this.yearShelves(list);
		} else {
			shelves = ["weread", "fanqie", "qidian", "jjwxc", "local"]
				.map((id) => this.shelfRow(sourceOf(id).name, this.shelfBooks(id)))
				.join("");
		}
		return `
				<div class="lib-stats">
					<span>${list.length} 本书</span>
					<span>${noteN} 条笔记</span>
					<span>最近同步 ${esc(this.lastSyncLabel())}</span>
				</div>
				${shelves}`;
	}

	private refreshShelfResults(): void {
		const box = this.contentEl.querySelector(".lib-results");
		if (!box) return;
		box.innerHTML = this.shelfResultsHtml();
		this.bindCovers();
		const counts = this.groupFilterCounts();
		this.contentEl.querySelectorAll<HTMLElement>("[data-act='group-filter']").forEach((el) => {
			const key = el.dataset.id as GroupFilter;
			const n = el.querySelector(".count");
			if (n && key && key in counts) n.textContent = String(counts[key]);
		});
	}

	private refreshFolderBooks(): void {
		const folder = this.store().folders.find((f) => f.id === this.openFolderId);
		const box = this.contentEl.querySelector(".folder-dialog .books");
		if (!folder || !box) return;
		const shown = this.folderBooksList(folder);
		box.innerHTML = shown.map((b) => this.bookCard(b, folder.id)).join("") || this.folderBooksEmptyHtml(folder, folder.bookIds.length);
		const count = this.contentEl.querySelector(".folder-count");
		if (count) {
			count.textContent = this.folderBookQuery.trim() && shown.length !== folder.bookIds.length
				? `${shown.length} / ${folder.bookIds.length} 本`
				: `${folder.bookIds.length} 本`;
		}
		this.bindCovers();
		this.refreshSelectionUi();
	}

	private lastSyncLabel(): string {
		const ch = this.store().channels;
		const ids = this.filter === "all" ? Object.keys(ch) : [this.filter];
		const times = ids.map((id) => ch[id]?.lastSync).filter((t): t is string => Boolean(t));
		if (!times.length) return "从未";
		return times.sort()[times.length - 1] ?? "从未";
	}

	private yearShelves(list: Book[]): string {
		const groups = new Map<string, Book[]>();
		for (const book of list) {
			const year = /^\d{4}/.test(book.lastRead) ? `${book.lastRead.slice(0, 4)} 年` : "未记录阅读时间";
			const row = groups.get(year) ?? [];
			row.push(book);
			groups.set(year, row);
		}
		const keys = Array.from(groups.keys()).sort((a, b) => {
			if (a === "未记录阅读时间") return 1;
			if (b === "未记录阅读时间") return -1;
			return b.localeCompare(a);
		});
		return keys.map((year) => this.shelfRow(year, groups.get(year) ?? [])).join("");
	}

	private folderWallHtml(list: Book[]): string {
		const store = this.store();
		const visible = new Set(list.map((b) => b.id));
		const shown = this.groupFilter === "none"
			? []
			: sortFolders(wallFolders(store.folders, visible, this.query, this.filter));
		const loose = this.groupFilter === "in" ? [] : ungroupedBooks(list, store.folders);
		if (!shown.length && !loose.length) {
			if (this.groupFilter === "none") {
				return `<div class="empty">没有未分组的书</div>`;
			}
			if (this.query.trim() || this.filter !== "all" || this.groupFilter !== "all") {
				return `<div class="empty">没有匹配的分组或书籍</div>`;
			}
			return `<div class="empty">还没有分组。点上方「新建分组」，再把书拖进去。</div>`;
		}
		const folderCards = shown.map((f) => this.folderCardHtml(f, visible)).join("");
		const icons = loose.map((b) => this.iconBookHtml(b)).join("");
		return `<div class="folder-wall">${folderCards}${icons}</div>`;
	}

	private folderCardHtml(folder: ShelfFolder, visible: Set<string>, nested = false): string {
		const store = this.store();
		const memberIds = folderBookIdsInclusive(store.folders, folder);
		const members = memberIds.map((id) => store.get(id)).filter((b): b is Book => Boolean(b));
		const preview = members.filter((b) => !visible.size || visible.has(b.id)).slice(0, 4);
		const tiles = preview.length ? preview : members.slice(0, 4);
		const mosaic = [0, 1, 2, 3].map((i) => {
			const book = tiles[i];
			return book ? this.miniJacket(book) : `<span class="folder-slot"></span>`;
		}).join("");
		const pickingFolders = this.selecting && this.lens === "groups" && !this.openFolderId;
		const picked = pickingFolders && this.selectedFolderIds.has(folder.id);
		const kids = childFolders(store.folders, folder.id).length;
		const joinSub = Boolean(this.folderSelecting && nested);
		const act = joinSub ? "join-to-sub" : pickingFolders && !nested ? "toggle-folder" : "open-folder";
		return `<button type="button" class="folder-card${picked ? " picked" : ""}${nested ? " nested" : ""}${joinSub ? " join-target" : ""}" data-act="${act}" data-id="${esc(folder.id)}" data-folder-drop="${esc(folder.id)}"${joinSub ? ` title="把勾选的书加入这个子分组"` : ""}>
			${nested || !pickingFolders ? "" : this.pickMark(picked)}
			<span class="folder-cubby">${mosaic}</span>
			<strong>${esc(folder.name)}</strong>
			<em>${this.filter === "all" && folder.source ? `${esc(sourceOf(folder.source).name)} · ` : ""}${members.length} 本${kids ? ` · ${kids} 组` : ""}</em>
		</button>`;
	}

	private iconBookHtml(book: Book): string {
		return `<button type="button" class="icon-book" draggable="true" data-book-id="${esc(book.id)}" data-act="open-book" data-id="${esc(book.id)}">
			${this.miniJacket(book)}
			<strong>${esc(book.title)}</strong>
		</button>`;
	}

	private miniJacket(book: Book): string {
		const src = sourceOf(book.source);
		const coverSrc = this.coverBytes.get(book.id) ?? "";
		const cover = coverSrc ? `<img src="${esc(coverSrc)}" alt="" draggable="false">` : "";
		return `<span class="jacket mini" style="--c:${src.color}">${cover}<span class="jacket-fallback">${esc(book.title.slice(0, 4))}</span></span>`;
	}

	private folderDialogHtml(): string {
		const store = this.store();
		const folder = store.folders.find((f) => f.id === this.openFolderId);
		if (!folder) return `<div class="empty">分组不存在</div>`;
		const kids = sortFolders(childFolders(store.folders, folder.id));
		const visible = new Set(this.shelfBooks().map((b) => b.id));
		const shown = this.folderBooksList(folder);
		const parent = folder.parentId ? store.folders.find((f) => f.id === folder.parentId) : undefined;
		const crumb = parent
			? `<p class="folder-crumb"><button type="button" class="ghost link" data-act="open-folder" data-id="${esc(parent.id)}">${esc(parent.name)}</button><span>/</span><strong>${esc(folder.name)}</strong></p>`
			: "";
		const subBtn = !folder.parentId
			? `<button type="button" class="ghost" data-act="new-subfolder" data-id="${esc(folder.id)}">新建子分组</button>`
			: "";
		const hasKids = !folder.parentId && kids.length > 0;
		const side = hasKids
			? `<aside class="folder-side">
				<p class="folder-side-label">子分组<span>${kids.length}</span></p>
				<div class="folder-wall nested">${kids.map((f) => this.folderCardHtml(f, visible, true)).join("")}</div>
			</aside>`
			: "";
		const hint = !folder.parentId && !kids.length
			? `<p class="folder-hint">还没有子分组。可建「已完结玄幻」这类二级分组。</p>`
			: "";
		const srcName = folder.source ? sourceOf(folder.source).name : "";
		const others = store.folders.filter((f) => (
			f.id !== folder.id && (!folder.source || !f.source || f.source === folder.source)
		));
		const copying = this.pendingCopyFolderId ? store.folders.find((f) => f.id === this.pendingCopyFolderId) : undefined;
		const moveBox = others.length
			? `<details class="folder-move-box"${copying ? " open" : ""}>
				<summary>放到其他组</summary>
				${copying ? "" : this.searchFieldHtml("folder-move-q", "搜索分组", this.folderMoveQuery, "folder-move")}
				<div class="folder-move-list">${this.folderMoveListHtml(folder.id)}</div>
			</details>`
			: "";
		const selectable = this.selectableFolderBooks();
		const allOn = selectable.length > 0 && selectable.every((b) => this.selectedBookIds.has(b.id));
		const selectBtns = folder.parentId
			? ""
			: this.folderSelecting
				? `<button class="ghost on" type="button" data-act="toggle-folder-select">取消选择</button>
					<button class="ghost${allOn ? " on" : ""}" type="button" data-act="toggle-select-all"${selectable.length ? "" : " disabled"}>${allOn ? "取消全选" : "全选"}</button>
					<button class="ghost accent" type="button" data-act="join-selected-sub"${this.selectedBookIds.size && kids.length ? "" : " disabled"}>加入子分组</button>`
				: `<button class="ghost" type="button" data-act="toggle-folder-select">选择</button>`;
		const emptyBooks = this.folderBooksEmptyHtml(folder, folder.bookIds.length);
		const pickHint = this.folderSelecting
			? `<p class="folder-hint">${kids.length ? "勾选图书后点左侧子分组，或点「加入子分组」。" : "先新建子分组，再把勾选的书放进去。"}</p>`
			: hint;
		const countLabel = this.folderBookQuery.trim() && shown.length !== folder.bookIds.length
			? `${shown.length} / ${folder.bookIds.length} 本`
			: `${folder.bookIds.length} 本`;
		return `
			<div class="folder-head">
				<div class="folder-head-row">
					<input class="folder-title" data-folder-rename="${esc(folder.id)}" value="${esc(folder.name)}" />
					${srcName ? `<span class="folder-src">${esc(srcName)}</span>` : ""}
					<span class="folder-count">${countLabel}</span>
					<button type="button" class="ghost" data-act="close-folder">关闭</button>
				</div>
				<div class="folder-toolbar">
					${this.searchFieldHtml("folder-book-q", "搜索书名或作者", this.folderBookQuery, "folder-book")}
				</div>
				<div class="folder-rail">
					<div class="folder-toolbar-ops">${selectBtns || `<span class="folder-rail-hint">可按书名或作者筛选本组图书</span>`}</div>
					<div class="folder-toolbar-more">
						${subBtn}
						<button type="button" class="ghost danger" data-act="split-folder" data-id="${esc(folder.id)}">打散分组</button>
					</div>
				</div>
			</div>
			${crumb}
			<div class="folder-body${side ? " split" : ""}">
				${side}
				<div class="folder-main">
					${pickHint}
					${this.folderSelecting ? "" : moveBox}
					<div class="books">${shown.map((b) => this.bookCard(b, folder.id)).join("") || emptyBooks}</div>
				</div>
			</div>`;
	}

	private folderBooksList(folder: ShelfFolder): Book[] {
		const books = sortBooks(
			folder.bookIds.map((id) => this.store().get(id)).filter((b): b is Book => Boolean(b)),
			this.sort,
		);
		const q = this.folderBookQuery.trim().toLowerCase();
		if (!q) return books;
		return books.filter((b) => (b.title + b.author).toLowerCase().includes(q));
	}

	private folderBooksEmptyHtml(folder: ShelfFolder, total: number): string {
		if (this.folderBookQuery.trim() && total) {
			return `<div class="empty">本组没有匹配「${esc(this.folderBookQuery.trim())}」的书</div>`;
		}
		return folder.parentId
			? `<div class="empty">组是空的。把书拖到这个子分组封面上，或在书上右键「移动到分组」。</div>`
			: `<div class="empty">还没有直接放在本组的书。可拖到封面，或放进左侧子分组。</div>`;
	}

	private searchFieldHtml(cls: string, placeholder: string, value: string, kind: string): string {
		const has = value.length > 0;
		return `<div class="search-wrap${has ? " has-q" : ""}">
			<input class="${cls}" type="text" placeholder="${esc(placeholder)}" value="${esc(value)}" />
			<button type="button" class="search-clear" data-act="clear-search" data-q="${esc(kind)}" aria-label="清空搜索"${has ? "" : " hidden"}>
				<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4L4 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
			</button>
		</div>`;
	}

	private clearSearchAfterGroupChange(): void {
		this.query = "";
		this.folderBookQuery = "";
		this.folderPickQuery = "";
		this.folderMoveQuery = "";
	}

	private clearSearchField(kind: string): void {
		if (kind === "folder-book") {
			this.folderBookQuery = "";
			this.resetSearchInput(".folder-book-q");
			this.refreshFolderBooks();
			return;
		}
		if (kind === "folder-pick") {
			this.folderPickQuery = "";
			this.resetSearchInput(".folder-pick-q");
			const list = this.contentEl.querySelector(".folder-pick-list");
			if (list) list.innerHTML = this.folderPickListHtml();
			return;
		}
		if (kind === "folder-move") {
			this.folderMoveQuery = "";
			this.resetSearchInput(".folder-move-q");
			const list = this.contentEl.querySelector(".folder-move-list");
			const folderId = this.openFolderId;
			if (list && folderId) list.innerHTML = this.folderMoveListHtml(folderId);
			return;
		}
		this.query = "";
		this.resetSearchInput(".search");
		this.refreshShelfResults();
	}

	private resetSearchInput(sel: string): void {
		const input = this.contentEl.querySelector(sel) as HTMLInputElement | null;
		if (input) input.value = "";
		this.syncSearchClear(input);
	}

	private syncSearchClear(input: HTMLInputElement | null | undefined): void {
		if (!input) return;
		const wrap = input.closest(".search-wrap");
		if (!wrap) return;
		const on = input.value.length > 0;
		wrap.classList.toggle("has-q", on);
		const btn = wrap.querySelector(".search-clear") as HTMLButtonElement | null;
		if (btn) btn.hidden = !on;
	}

	private folderMoveListHtml(currentId: string): string {
		const pending = this.store().folders.find((f) => f.id === this.pendingCopyFolderId);
		if (pending) {
			const current = this.store().folders.find((f) => f.id === currentId);
			const n = current?.bookIds.length ?? 0;
			if (current && isArchiveFolder(this.store().folders, current) && !isArchiveFolder(this.store().folders, pending)) {
				return `
					<p class="muted">「完本留存」里的书不能再放到其他分组。</p>
					<div class="row folder-pick-foot">
						<button type="button" class="ghost" data-act="close-copy-folder">返回</button>
					</div>`;
			}
			return `
				<p class="muted">把本组 ${n} 本放到「${esc(folderPath(this.store().folders, pending))}」？</p>
				${this.placeModeButtonsHtml("confirm-copy-folder", n > 0)}
				${this.placeModeFootHtml("confirm-copy-folder", n > 0, "close-copy-folder")}`;
		}
		const q = this.folderMoveQuery.trim().toLowerCase();
		const current = this.store().folders.find((f) => f.id === currentId);
		const branches = folderSelectTree(this.store().folders, {
			query: q,
			excludeIds: [currentId],
			source: current?.source,
		});
		if (!branches.length) return `<div class="empty">没有匹配的分组</div>`;
		return this.folderTreeHtml(branches, (folder, kind) => this.folderPickItemHtml(folder, {
			kind,
			act: "copy-into-folder",
		}));
	}

	private folderNameDialogHtml(): string {
		const parent = this.namingParentId ? this.store().folders.find((f) => f.id === this.namingParentId) : undefined;
		const name = nextFolderName(this.store().folders, this.namingParentId ?? undefined, this.namingSource || undefined);
		const srcName = (parent?.source || this.namingSource) ? sourceOf(parent?.source || this.namingSource).name : "";
		const pick = !parent && this.filter === "all"
			? `<div class="src-pick">${Object.values(SOURCES).map((s) => `<button type="button" class="chip${this.namingSource === s.id ? " on" : ""}" data-act="naming-source" data-id="${esc(s.id)}"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</button>`).join("")}</div>`
			: "";
		const hint = parent
			? `建在「${esc(parent.name)}」下面，最多两层。属于${esc(srcName || "当前来源")}。`
			: srcName
				? `建在${esc(srcName)}下。微信读书和番茄的分组不是同一套。`
				: "先选来源。微信读书和番茄的分组不是同一套。";
		return `
			<h2 style="margin:0 0 8px;font-size:18px;">${parent ? "新建子分组" : "新建分组"}</h2>
			<p class="muted">${hint}</p>
			${pick}
			<input class="folder-new-name" type="text" value="${esc(name)}" />
			<div class="row" style="margin-top:12px;">
				<button type="button" class="btn" data-act="confirm-folder-name">创建</button>
				<button type="button" class="ghost" data-act="close-folder-name">取消</button>
			</div>`;
	}

	private dissolveDialogHtml(): string {
		const names = this.pendingDissolveIds
			.map((id) => this.store().folders.find((f) => f.id === id)?.name)
			.filter((n): n is string => Boolean(n));
		const label = names.length <= 3
			? names.map((n) => `「${esc(n)}」`).join("、")
			: `${names.length} 个分组`;
		const hasKids = this.pendingDissolveIds.some((id) => childFolders(this.store().folders, id).length > 0);
		return `
			<h2 style="margin:0 0 8px;font-size:18px;">打散分组</h2>
			<p class="muted">确定打散${label}？分组会消失，里面的书仍留在书架上。${hasKids ? "其下的子分组也会一起打散。" : ""}</p>
			<div class="row" style="margin-top:12px;">
				<button type="button" class="btn" data-act="confirm-dissolve">打散</button>
				<button type="button" class="ghost" data-act="close-dissolve">取消</button>
			</div>`;
	}

	private placeModeButtonsHtml(act: string, hasOriginal: boolean, forceMove = false): string {
		if (!hasOriginal) return "";
		return `<div class="place-choices">
			<button type="button" class="folder-pick-item on" data-act="${esc(act)}" data-mode="move">
				<span class="place-choice-head"><strong>原来分组里移除</strong>${forceMove ? "" : `<em class="rec">推荐</em>`}</span>
				<span>${forceMove ? "完本留存的书不能同时留在其他组" : "只留在新组"}</span>
			</button>
			${forceMove ? "" : `<button type="button" class="folder-pick-item" data-act="${esc(act)}" data-mode="keep">
				<strong>原来分组不变</strong>
				<span>同时留在原来的组</span>
			</button>`}
		</div>`;
	}

	private placeModeFootHtml(act: string, hasOriginal: boolean, backAct: string): string {
		return `<div class="row folder-pick-foot">
			<button type="button" class="ghost" data-act="${esc(backAct)}">返回</button>
			${hasOriginal ? "" : `<button type="button" class="btn" data-act="${esc(act)}" data-mode="keep">加入</button>`}
		</div>`;
	}

	private folderPickDialogHtml(): string {
		const books = this.movingBooks();
		const pending = this.store().folders.find((f) => f.id === this.pendingPickFolderId);
		const label = this.movingLabel();
		if (pending) {
			const hasOriginal = books.some((b) => this.store().foldersOf(b.id).some((f) => f.id !== pending.id));
			const forceMove = books.some((b) => isArchivedBook(b.id, this.store().folders) && this.store().foldersOf(b.id).some((f) => f.id !== pending.id));
			return `
				<h2 style="margin:0 0 8px;font-size:18px;">怎么放到这个组</h2>
				<p class="muted">把${label}加入「${esc(folderPath(this.store().folders, pending))}」。</p>
				${this.placeModeButtonsHtml("confirm-move-folder", hasOriginal, forceMove)}
				${this.placeModeFootHtml("confirm-move-folder", hasOriginal, "back-folder-pick")}`;
		}
		return `
			<h2 style="margin:0 0 8px;font-size:18px;">${this.pickSubfoldersOnly ? "加入子分组" : "移动到分组"}</h2>
			<p class="muted">${books.length ? `把${label}放到哪个${this.pickSubfoldersOnly ? "子分组" : "组"}？选好后再决定是否从原组移除。` : "选择分组"}</p>
			${this.searchFieldHtml("folder-pick-q", this.pickSubfoldersOnly ? "搜索子分组" : "搜索分组", this.folderPickQuery, "folder-pick")}
			<div class="folder-pick-list">${this.folderPickListHtml()}</div>
			<div class="row folder-pick-foot">
				<button type="button" class="ghost" data-act="close-folder-pick">取消</button>
			</div>`;
	}

	private folderPickListHtml(): string {
		const q = this.folderPickQuery.trim().toLowerCase();
		const books = this.movingBooks();
		const source = sharedSource(books);
		const archived = books.some((b) => isArchivedBook(b.id, this.store().folders));
		const branches = folderSelectTree(this.store().folders, {
			query: q,
			source,
			onlyChildrenOf: this.pickSubfoldersOnly ? this.openFolderId ?? undefined : undefined,
			include: (f) => !archived || isArchiveFolder(this.store().folders, f),
		});
		if (!this.store().folders.length) {
			return `<div class="empty">还没有分组。请先点上方「新建分组」。</div>`;
		}
		if (!branches.length) {
			if (this.pickSubfoldersOnly) return `<div class="empty">${q ? "没有匹配的子分组" : "请先新建子分组"}</div>`;
			return `<div class="empty">${!q && source ? `还没有${esc(sourceOf(source).name)}的分组。请先点上方「新建分组」。` : archived ? "完本留存的书只能留在完本留存及其子分组" : "没有匹配的分组"}</div>`;
		}
		const inIds = new Set(
			this.store().folders
				.filter((f) => books.length && books.every((b) => f.bookIds.includes(b.id)))
				.map((f) => f.id),
		);
		return this.folderTreeHtml(branches, (folder, kind) => this.folderPickItemHtml(folder, {
			kind,
			act: "pick-move-folder",
			inGroup: inIds.has(folder.id),
			picked: this.pendingPickFolderId === folder.id,
			disabled: inIds.has(folder.id),
		}));
	}

	private folderTreeHtml(
		branches: FolderTreeBranch[],
		renderItem: (folder: ShelfFolder, kind: "parent" | "child") => string,
	): string {
		return `<div class="folder-tree">${branches.map((branch) => {
			const head = branch.parentSelectable
				? renderItem(branch.parent, "parent")
				: `<div class="folder-tree-head"><strong>${esc(branch.parent.name)}</strong><span>${branch.parent.bookIds.length} 本</span></div>`;
			const kids = branch.children.map((child) => renderItem(child, "child")).join("");
			return `<div class="folder-tree-branch">${head}${kids ? `<div class="folder-tree-kids">${kids}</div>` : ""}</div>`;
		}).join("")}</div>`;
	}

	private folderPickItemHtml(folder: ShelfFolder, opts: {
		kind: "parent" | "child";
		act: string;
		inGroup?: boolean;
		picked?: boolean;
		disabled?: boolean;
	}): string {
		const extra = opts.inGroup ? " · 已在本组" : "";
		return `<button type="button" class="folder-pick-item tree-${opts.kind}${opts.inGroup ? " in" : ""}${opts.picked ? " on" : ""}" data-act="${esc(opts.act)}" data-id="${esc(folder.id)}"${opts.disabled ? " disabled" : ""}>
			<strong>${esc(folder.name)}</strong>
			<span>${folder.bookIds.length} 本${extra}</span>
		</button>`;
	}

	private shelfRow(title: string, list: Book[]): string {
		if (!list.length) return "";
		return `<section class="shelf-block">
			<div class="shelf-label">${esc(title)}<span>${list.length} 本</span></div>
			<div class="books">${list.map((b) => this.bookCard(b)).join("")}</div>
		</section>`;
	}

	private bookCard(book: Book, inFolder?: string): string {
		const src = sourceOf(book.source);
		const folders = this.store().foldersOf(book.id);
		const groupTags = folders.length
			? folders.map((f) => `<span class="tag group">${esc(folderPath(this.store().folders, f))}</span>`).join("")
			: `<span class="tag none">暂未分配分组</span>`;
		const tags = `<span class="tag source">${esc(src.name)}</span>${groupTags}`;
		const coverSrc = this.coverBytes.get(book.id) ?? "";
		const cover = coverSrc
			? `<img src="${esc(coverSrc)}" alt="" draggable="false" loading="lazy">`
			: "";
		const leave = inFolder && !this.folderSelecting
			? `<button type="button" class="book-remove" data-act="leave-folder" data-fid="${esc(inFolder)}" data-id="${esc(book.id)}">移出本组</button>`
			: "";
		const pickingInFolder = Boolean(this.folderSelecting && inFolder && inFolder === this.openFolderId);
		const pickingBooks = (this.selecting && this.lens === "all" && !inFolder) || pickingInFolder;
		const locked = pickingBooks && !pickingInFolder && isArchivedBook(book.id, this.store().folders);
		const picked = pickingBooks && !locked && this.selectedBookIds.has(book.id);
		return `<div class="book-card${inFolder ? " in-folder" : ""}${picked ? " picked" : ""}${locked ? " locked" : ""}" draggable="${pickingBooks ? "false" : "true"}" data-book-id="${esc(book.id)}"${locked ? ` title="已在「完本留存」里，不能再放到其他分组"` : ""}>
			${pickingBooks ? this.pickMark(picked, locked) : ""}
			<button type="button" class="book" data-act="open-book" data-id="${esc(book.id)}">
				<span class="jacket" style="--c:${src.color}">${cover}<span class="jacket-fallback">${esc(book.title.slice(0, 8))}</span></span>
				<span class="book-meta">
					<strong>${esc(book.title)}</strong>
					<em>${esc(book.author)}</em>
					<span class="tags">${tags}</span>
					<span class="book-read">最近阅读 ${esc(book.lastRead || "—")}</span>
				</span>
			</button>
			${leave}
		</div>`;
	}

	private platforms() {
		return PLATFORMS.concat(this.store().customPlatforms);
	}

	private storeHtml(): string {
		const all = this.platforms();
		const current = all.find((p) => p.id === this.storePlatformId) ?? all[0];
		if (current && this.storePlatformId !== current.id) this.storePlatformId = current.id;
		const hasBind = Boolean(current && current.id in this.store().channels);
		const bound = current ? this.store().channels[current.id]?.bound : false;
		const nav = all.map((p) => {
			const color = sourceOf(p.id).color;
			const on = p.id === current?.id ? "on" : "";
			return `<button type="button" class="${on}" data-act="store-open" data-id="${esc(p.id)}">
				<span class="dot" style="background:${color}"></span>${esc(p.name)}
			</button>`;
		}).join("");
		const url = current?.url ?? "";
		return `
			<aside class="side">
				<h2>入口</h2>
				<div class="src-list">${nav}</div>
				<label>添加入口</label>
				<input id="np-name" type="text" placeholder="名称，例如 掌阅" />
				<input id="np-url" type="url" placeholder="https://" style="margin-top:8px" />
				<div class="row"><button type="button" class="btn" data-act="add-platform">加入书城</button></div>
			</aside>
			<div class="store-frame">
				<div class="wv-bar">
					<span class="wv-dots" style="background:${current ? sourceOf(current.id).color : "var(--lamp)"}"></span>
					<span class="wv-url">${esc(url)}</span>
					<div class="spacer"></div>
					${hasBind ? `<button type="button" class="ghost" data-act="open-bind" data-id="${esc(current?.id ?? "")}">${bound ? "已绑定" : "去绑定"}</button>` : ""}
					<button type="button" class="ghost" data-act="ext-url" data-url="${esc(url)}">浏览器打开</button>
				</div>
				<div class="wv-host" data-embed="${esc(url)}"></div>
			</div>`;
	}

	private channelsHtml(): string {
		const cards = BIND_IDS.map((id) => {
			const s = sourceOf(id);
			const c = this.store().channels[id] ?? { bound: false, account: "", lastSync: "" };
			const how = ({ qr: "扫码", web: "网页登录", paste: "粘贴凭证" } as Record<string, string>)[c.method ?? ""] ?? "";
			const status = c.bound
				? "已绑定" + (how ? " · " + how : "") + (c.account ? " · " + c.account : "")
				: "未绑定";
			return `<article class="card">
				<h3>${esc(s.name)}</h3>
				<p>${esc(s.bind)}</p>
				<div class="status ${c.bound ? "ok" : "warn"}">${esc(status)}</div>
				${c.lastSync ? `<p class="muted">上次同步 ${esc(c.lastSync)}</p>` : `<p class="muted">${id === "weread" || id === "fanqie" ? "点扫码绑定，会弹出官方登录窗口。" : "扫码打开官方页，再把 Key / ID / Cookie 贴回来。"}</p>`}
				<div class="row">
					<button class="btn" data-act="open-bind" data-id="${id}" data-tab="qr">${c.bound ? "重新扫码" : "扫码绑定"}</button>
					<button class="ghost" data-act="open-bind" data-id="${id}" data-tab="paste">粘贴凭证</button>
					${c.bound ? `<button class="ghost" data-act="unbind" data-id="${id}">解除</button>` : ""}
				</div>
			</article>`;
		}).join("");
		return `<div class="spec">
			<p class="muted lead">微信读书、番茄小说：扫码登录后同步书架书目（不抓正文）。其它渠道仍用粘贴凭证标记绑定。</p>
			<div class="card-grid">${cards}</div>
		</div>`;
	}

	private readerHtml(): string {
		const book = this.store().get(this.selectedId ?? "");
		if (!book) return `<div class="empty">未选中书籍。<button class="ghost" data-act="nav" data-view="shelf">返回书架</button></div>`;
		const src = sourceOf(book.source);
		const chapter = book.chapters[this.chapter] || book.chapters[0] || book.title;
		const site = openUrl(book.source, book);
		const path = vaultPath(book, this.store().settings);
		const useEmbed = Boolean(src.url) && !hasNativeText(book);
		let mid = "";
		if (useEmbed) {
			mid = `<div class="webview" style="--c:${src.color}">
				<div class="wv-bar"><span class="wv-dots"></span><span class="wv-url">${esc(site)}</span></div>
				<div class="wv-host" data-embed="${esc(site)}"></div>
			</div>`;
		} else if (hasNativeText(book)) {
			mid = `<div class="reader-scroll"><article class="article">
				<h2>${esc(chapter)}</h2>
				<p>${this.markHighlights(esc(book.text), book.highlights).replace(/\n\n/g, "</p><p>")}</p>
			</article></div>`;
		} else {
			mid = `<div class="reader-scroll"><article class="article">
				<h2>${esc(chapter)}</h2>
				<p class="muted">这本书的正文在 ${esc(src.name)}。可在浏览器打开原站；右侧笔记照常写。</p>
				<div class="row"><button class="btn" data-act="ext-url" data-url="${esc(site)}">在浏览器打开</button></div>
			</article></div>`;
		}
		return `
			<aside class="reader-side">
				<button class="ghost" data-act="nav" data-view="shelf">返回书架</button>
				<button class="ghost" data-act="ext-url" data-url="${esc(site)}">浏览器打开</button>
				<button class="ghost" data-act="open-note-file">打开笔记文件</button>
			</aside>
			<div class="reader-main">${mid}</div>
			<aside class="notes-pane">
				<div class="notes-head">
					<h2>统一笔记</h2>
					<div class="path">${esc(path)}</div>
				</div>
				<div class="note-composer">
					<textarea id="note-input" placeholder="读到哪里写到哪里…"></textarea>
					<div class="row"><button class="btn" data-act="add-note">记到本章</button></div>
				</div>
				<div class="notes-list">${this.notesListHtml(book)}</div>
			</aside>`;
	}

	private notesListHtml(book: Book): string {
		if (!book.notes.length) {
			return "<p class='muted'>还没有笔记。任意渠道都写在这里，会保存到设置里的 Vault 路径。</p>";
		}
		return book.notes.map((n) => `<div class="note-item">
			<div class="note">${esc(n.text)}</div>
			<div class="muted"><span>${[n.chapter, n.at, n.from].filter(Boolean).map(esc).join(" · ")}</span>
				<button class="ghost" data-act="del-note" data-nid="${esc(n.id)}">删除</button>
			</div>
		</div>`).join("");
	}

	private refreshNotesPane(book: Book, clearInput = false): void {
		const list = this.contentEl.querySelector(".notes-list");
		if (list) list.innerHTML = this.notesListHtml(book);
		const pathEl = this.contentEl.querySelector(".notes-head .path");
		if (pathEl) pathEl.textContent = vaultPath(book, this.store().settings);
		if (clearInput) {
			const input = this.contentEl.querySelector("#note-input") as HTMLTextAreaElement | null;
			if (input) input.value = "";
		}
	}

	private settingsHtml(): string {
		const cfg = this.store().settings;
		const sample = this.store().books[0] ?? {
			id: "demo", source: "weread", title: "置身事内", author: "兰小欢",
			progress: 0, lastRead: "", chapters: [], text: "", highlights: [], notes: [],
		};
		return `<div class="spec">
			<p class="muted lead">笔记必须落在 Vault 某个目录。正式插件也在「设置 → Z-Read」里提供同样的项。</p>
			<h2>设置</h2>
			<h3>笔记落盘</h3>
			<div class="setting">
				<div><h3>Vault 目录</h3><p class="muted">相对库根目录。所有渠道的统一笔记都写到这里。</p></div>
				<div class="ctrl">
					<input data-set="notesFolder" type="text" value="${esc(cfg.notesFolder)}" />
					<select id="folder-preset">
						<option value="">常用目录…</option>
						${FOLDER_PRESETS.map((p) => `<option value="${esc(p)}" ${p === cfg.notesFolder ? "selected" : ""}>${esc(p)}</option>`).join("")}
					</select>
				</div>
			</div>
			<div class="setting">
				<div><h3>文件名模板</h3><p class="muted">可用 <code>{{title}}</code> <code>{{author}}</code> <code>{{source}}</code>。</p></div>
				<div class="ctrl"><input data-set="fileName" type="text" value="${esc(cfg.fileName)}" /></div>
			</div>
			<div class="setting">
				<div><h3>子文件夹</h3><p class="muted">按来源或书名再分一层。</p></div>
				<div class="ctrl">
					<select data-set="subfolder">
						<option value="none" ${cfg.subfolder === "none" ? "selected" : ""}>不分，全在笔记目录</option>
						<option value="source" ${cfg.subfolder === "source" ? "selected" : ""}>按来源</option>
						<option value="book" ${cfg.subfolder === "book" ? "selected" : ""}>按书名建子文件夹</option>
					</select>
				</div>
			</div>
			<p class="muted" style="margin:16px 0 6px">当前会写成</p>
			<div class="preview-path" id="path-preview">${esc(vaultPath(sample, cfg))}</div>
			<h3>Daily Notes</h3>
			<div class="setting">
				<div><h3>同步当日划线到日记</h3><p class="muted">可选，后续版本写入日记区间。</p></div>
				<button class="toggle ${cfg.dailyNotes ? "on" : ""}" data-act="toggle-daily"><i></i></button>
			</div>
			<div class="setting">
				<div><h3>日记目录</h3><p class="muted">相对 Vault 的 Daily Notes 路径。</p></div>
				<div class="ctrl"><input data-set="dailyFolder" type="text" value="${esc(cfg.dailyFolder)}" ${cfg.dailyNotes ? "" : "disabled"} /></div>
			</div>
		</div>`;
	}

	private bindHtml(): string {
		const id = this.bindId;
		if (!id) return "";
		const s = sourceOf(id);
		const tab = this.bindTab;
		const pane = {
			qr: id === "weread" ? this.wereadScanHtml() : id === "fanqie" ? this.fanqieScanHtml() : `<div class="qr-pane">
				<div class="qr-well" style="--c:${s.color}">${qrSvg(s.qrPayload)}<span class="qr-frame"></span></div>
				<p class="muted">用 ${esc(s.qrApp)} 扫码打开官方页。登录后把凭证贴回来。</p>
				<p class="muted">${esc(s.qrHint)}</p>
				<p class="url">${esc(s.qrPayload)}</p>
				<div class="row" style="justify-content:center">
					<button class="btn" type="button" data-act="ext-url" data-url="${esc(s.qrPayload)}">打开官方页</button>
					<button class="ghost" type="button" data-act="copy-url" data-url="${esc(s.qrPayload)}">复制链接</button>
					<button class="ghost" type="button" data-act="bind-tab" data-tab="paste">去粘贴凭证</button>
				</div>
			</div>`,
			paste: `<div class="paste-pane">
				<p class="muted">${esc(s.pasteHint)}</p>
				<label>${esc(s.pasteLabel)}</label>
				<input id="bind-token" type="text" placeholder="${esc(s.pastePh)}" />
				<label>${esc(s.cookieLabel)}</label>
				<input id="bind-cookie" type="text" placeholder="${esc(s.cookiePh)}" />
				<div class="row"><button class="btn" type="button" data-act="bind-paste">写入并绑定</button></div>
			</div>`,
			web: `<div class="web-pane">
				<p class="muted">在系统浏览器打开官方登录页。登录后把 Key / Cookie 贴到「粘贴凭证」。</p>
				<div class="row">
					<button class="btn" type="button" data-act="ext-url" data-url="${esc(s.webLogin)}">打开登录页</button>
					<button class="ghost" type="button" data-act="bind-tab" data-tab="paste">去粘贴凭证</button>
				</div>
			</div>`,
		}[tab];
		return `
			<div class="bind-head">
				<div>
					<h2>绑定 ${esc(s.name)}</h2>
					<p class="muted" style="margin:4px 0 0">${esc(s.bind)}</p>
				</div>
				<button class="ghost" data-act="close-bind">关闭</button>
			</div>
			<div class="bind-tabs">
				<button class="${tab === "qr" ? "on" : ""}" data-act="bind-tab" data-tab="qr">扫码</button>
				<button class="${tab === "paste" ? "on" : ""}" data-act="bind-tab" data-tab="paste">粘贴凭证</button>
				<button class="${tab === "web" ? "on" : ""}" data-act="bind-tab" data-tab="web">网页登录</button>
			</div>
			${pane}`;
	}

	private wereadScanHtml(): string {
		return `<div class="qr-pane">
			<p class="muted">会弹出微信读书登录窗口（<code>weread.qq.com/#login</code>）。用微信扫<strong>窗口里</strong>的码，登录成功后自动读取登录态并同步书架书目（不抓正文）。</p>
			<p class="muted" id="weread-bind-status">${this.wereadBusy ? "等待扫码…" : "点下面按钮开始。"}</p>
			<div class="row" style="justify-content:center">
				<button class="btn" type="button" data-act="weread-scan" ${this.wereadBusy ? "disabled" : ""}>打开登录窗口扫码</button>
				<button class="ghost" type="button" data-act="bind-tab" data-tab="paste">粘贴凭证</button>
			</div>
		</div>`;
	}

	private fanqieScanHtml(): string {
		const img = this.fanqieQr?.qrDataUrl ?? "";
		return `<div class="qr-pane">
			<p class="muted">用番茄小说 App 扫下面的码，登录成功后同步书架书目（不抓正文）。</p>
			<div class="qr-well" style="--c:var(--zread-fanqie)">
				${img ? `<img class="fanqie-qr" alt="番茄登录二维码" src="${img}" />` : `<span class="muted">正在获取二维码…</span>`}
				<span class="qr-frame"></span>
			</div>
			<p class="muted" id="fanqie-bind-status">${esc(this.fanqieQrHint || (img ? "等待扫码…" : "点下面按钮获取二维码"))}</p>
			<div class="row" style="justify-content:center">
				<button class="btn" type="button" data-act="fanqie-scan">${img ? "刷新二维码" : "获取二维码"}</button>
				<button class="ghost" type="button" data-act="bind-tab" data-tab="paste">粘贴凭证</button>
			</div>
		</div>`;
	}

	private pokeGuestViewport(guest: HTMLElement, host: HTMLElement): void {
		const h = guestViewportPx(host.getBoundingClientRect().height);
		const script = wereadHeightScript(h);
		if (!script) return;
		const anyGuest = guest as HTMLElement & {
			executeJavaScript?: (code: string) => Promise<unknown>;
			contentWindow?: Window | null;
		};
		if (typeof anyGuest.executeJavaScript === "function") {
			void anyGuest.executeJavaScript(script).catch(() => undefined);
			return;
		}
		try {
			anyGuest.contentWindow?.dispatchEvent(new Event("resize"));
		} catch {
			/* cross-origin iframe */
		}
	}

	private bindGuestViewport(guest: HTMLElement, host: HTMLElement): void {
		this.webviewRo?.disconnect();
		this.webviewRo = null;
		const poke = () => this.pokeGuestViewport(guest, host);
		const anyGuest = guest as HTMLElement & {
			src?: string;
			insertCSS?: (css: string) => Promise<unknown>;
			executeJavaScript?: (code: string) => Promise<unknown>;
			getWebContents?: () => {
				setWindowOpenHandler: (handler: (details: { url: string }) => { action: "allow" | "deny" }) => void;
			};
		};
		const stayInside = () => {
			if (typeof anyGuest.insertCSS === "function") {
				void anyGuest.insertCSS(wereadHeightCss()).catch(() => undefined);
			}
			if (typeof anyGuest.executeJavaScript === "function") {
				void anyGuest.executeJavaScript(keepInGuestScript()).catch(() => undefined);
			}
			try {
				anyGuest.getWebContents?.()?.setWindowOpenHandler(({ url }) => {
					if (url) anyGuest.src = url;
					return { action: "deny" };
				});
			} catch {
				/* Obsidian 可能不暴露 webContents */
			}
			poke();
		};
		guest.addEventListener("dom-ready", stayInside);
		guest.addEventListener("did-finish-load", poke);
		guest.addEventListener("did-navigate", (e) => this.syncGuestUrl(e as Event & { url?: string }));
		guest.addEventListener("did-navigate-in-page", (e) => this.syncGuestUrl(e as Event & { url?: string }));
		guest.addEventListener("new-window", (e) => {
			const ev = e as Event & { url?: string; preventDefault?: () => void };
			ev.preventDefault?.();
			if (ev.url) anyGuest.src = ev.url;
		});
		guest.addEventListener("load", poke);
		this.webviewRo = new ResizeObserver(poke);
		this.webviewRo.observe(host);
		requestAnimationFrame(poke);
	}

	private syncGuestUrl(e: Event & { url?: string }): void {
		if (!e.url) return;
		const bar = this.contentEl.querySelector(".wv-url");
		if (bar) bar.textContent = e.url;
	}

	private mountWebview(): void {
		this.webviewRo?.disconnect();
		this.webviewRo = null;
		const host = this.contentEl.querySelector(".wv-host") as HTMLElement | null;
		if (!host) return;
		const url = host.dataset.embed;
		if (!url) return;
		const fallback = () => {
			host.innerHTML = `<div class="wv-body">
				<p>当前环境不能内嵌网页，或站点禁止嵌入。可在浏览器打开。</p>
				<div class="row"><button type="button" class="btn" data-act="ext-url" data-url="${esc(url)}">在浏览器打开</button></div>
			</div>`;
		};
		if (!Platform.isDesktopApp) {
			fallback();
			return;
		}
		try {
			const wv = document.createElement("webview") as HTMLElement & { src: string };
			wv.setAttribute("src", url);
			wv.setAttribute("partition", "persist:zread");
			const ua = navigator.userAgent.replace(/Electron\/[\d.]+ ?/g, "").replace(/obsidian\/[\d.]+ ?/gi, "");
			wv.setAttribute("useragent", ua.trim());
			wv.style.width = "100%";
			wv.style.height = "100%";
			wv.style.border = "0";
			host.empty();
			host.appendChild(wv);
			this.bindGuestViewport(wv, host);
		} catch {
			try {
				const frame = document.createElement("iframe");
				frame.src = url;
				frame.setAttribute("allow", "fullscreen");
				frame.style.cssText = "width:100%;height:100%;border:0";
				host.empty();
				host.appendChild(frame);
				this.bindGuestViewport(frame, host);
			} catch {
				fallback();
			}
		}
	}

	private markHighlights(html: string, highlights: Book["highlights"]): string {
		let out = html;
		for (const h of highlights) {
			const t = esc(h.text);
			if (t && out.includes(t)) out = out.replace(t, `<mark class="hl">${t}</mark>`);
		}
		return out;
	}

	private async onClick(e: MouseEvent): Promise<void> {
		const raw = e.target as HTMLElement;
		if (raw.classList.contains("zread-overlay")) {
			const kind = raw.dataset.overlay;
			if (kind === "import") this.importOpen = false;
			if (kind === "bind") {
				this.stopFanqieQr(true);
				this.bindId = null;
			}
			if (kind === "folder") {
				this.openFolderId = null;
				this.pendingCopyFolderId = null;
				this.folderSelecting = false;
				this.selectedBookIds.clear();
			}
			if (kind === "folder-name") {
				this.namingOpen = false;
				this.namingParentId = null;
				this.namingSource = "";
			}
			if (kind === "folder-pick") {
				this.moveBookIds = [];
				this.pendingPickFolderId = null;
				this.pickSubfoldersOnly = false;
			}
			if (kind === "dissolve") this.pendingDissolveIds = [];
			this.render();
			return;
		}
		const t = raw.closest("[data-act]") as HTMLElement | null;
		if (!t) return;
		if (t instanceof HTMLButtonElement && t.disabled) return;
		const act = t.dataset.act;
		if (act === "clear-search") {
			e.preventDefault();
			this.clearSearchField(t.dataset.q ?? "shelf");
			return;
		}
		if (act === "ext-url") {
			e.preventDefault();
			const url = t.dataset.url ?? "";
			if (url) window.open(url, "_blank");
			return;
		}
		if (act === "copy-url") {
			e.preventDefault();
			const url = t.dataset.url ?? "";
			if (!url) return;
			try {
				await navigator.clipboard.writeText(url);
				new Notice("链接已复制");
			} catch {
				new Notice(url);
			}
			return;
		}
		if (act === "nav") {
			this.page = (t.dataset.view as MainView) ?? "shelf";
			if (this.page !== "reader") this.selectedId = null;
			if (this.page !== "shelf") {
				this.clearSelect();
				this.openFolderId = null;
				this.folderSelecting = false;
				this.pickSubfoldersOnly = false;
				this.namingOpen = false;
				this.namingParentId = null;
				this.namingSource = "";
				this.moveBookIds = [];
				this.pendingPickFolderId = null;
				this.pendingCopyFolderId = null;
				this.pendingDissolveIds = [];
			}
			this.render();
		}
		if (act === "filter") {
			this.filter = t.dataset.id ?? "all";
			this.contentEl.querySelectorAll("[data-act='filter']").forEach((el) => {
				el.classList.toggle("on", (el as HTMLElement).dataset.id === this.filter);
			});
			this.refreshShelfResults();
			return;
		}
		if (act === "group-filter") {
			this.groupFilter = t.dataset.id === "none" || t.dataset.id === "in" ? t.dataset.id : "all";
			this.selectedBookIds.clear();
			this.contentEl.querySelectorAll("[data-act='group-filter']").forEach((el) => {
				el.classList.toggle("on", (el as HTMLElement).dataset.id === this.groupFilter);
			});
			this.refreshShelfResults();
			this.refreshSelectionUi();
			return;
		}
		if (act === "lens") {
			this.lens = t.dataset.id === "groups" ? "groups" : "all";
			this.openFolderId = null;
			this.selectedFolderIds.clear();
			this.selectedBookIds.clear();
			this.render();
		}
		if (act === "store-open") {
			this.storePlatformId = t.dataset.id ?? this.storePlatformId;
			this.page = "store";
			this.render();
		}
		if (act === "mode") {
			this.mode = (t.dataset.id as ShelfMode) ?? "split";
			this.contentEl.querySelectorAll("[data-act='mode']").forEach((el) => {
				el.classList.toggle("on", (el as HTMLElement).dataset.id === this.mode);
			});
			this.refreshShelfResults();
			return;
		}
		if (act === "open-book") {
			if (this.skipBookClick) {
				this.skipBookClick = false;
				return;
			}
			const id = t.dataset.id ?? "";
			if (this.selecting) {
				if (this.lens === "all") this.toggleBook(id);
				return;
			}
			if (this.folderSelecting) {
				this.toggleBook(id);
				return;
			}
			const book = this.store().get(id);
			if (!book) return;
			this.selectedId = id;
			this.page = "reader";
			this.chapter = 0;
			this.openFolderId = null;
			await this.hydrateNotes(book);
			this.render();
		}
		if (act === "toggle-folder") {
			this.toggleFolder(t.dataset.id ?? "");
			return;
		}
		if (act === "chapter") { this.chapter = Number(t.dataset.i); this.render(); }
		if (act === "open-import") { this.importOpen = true; this.render(); }
		if (act === "close-import") { this.importOpen = false; this.render(); }
		if (act === "open-bind") {
			this.bindId = t.dataset.id ?? null;
			this.bindTab = (t.dataset.tab as BindMethod) || "qr";
			this.page = "channels";
			this.render();
			if (this.bindId === "fanqie" && this.bindTab === "qr") void this.startFanqieScan();
		}
		if (act === "close-bind") {
			this.stopFanqieQr(true);
			this.bindId = null;
			this.render();
		}
		if (act === "bind-tab") {
			this.bindTab = (t.dataset.tab as BindMethod) ?? "qr";
			this.render();
			if (this.bindId === "fanqie" && this.bindTab === "qr") void this.startFanqieScan();
			else this.stopFanqieQr();
		}
		if (act === "bind-paste") await this.bindPaste();
		if (act === "weread-scan") await this.startWereadScan();
		if (act === "fanqie-scan") await this.startFanqieScan();
		if (act === "unbind") {
			const id = t.dataset.id ?? "";
			await this.store().unbind(id);
			new Notice(`已解除 ${sourceOf(id).name}`);
			this.render();
		}
		if (act === "sync-all") await this.syncAll();
		if (act === "open-folder") {
			if (this.skipBookClick) {
				this.skipBookClick = false;
				return;
			}
			this.openFolderId = t.dataset.id ?? null;
			this.folderMoveQuery = "";
			this.folderBookQuery = "";
			this.pendingCopyFolderId = null;
			this.folderSelecting = false;
			this.selectedBookIds.clear();
			this.render();
		}
		if (act === "close-folder") {
			this.openFolderId = null;
			this.pendingCopyFolderId = null;
			this.folderSelecting = false;
			this.folderBookQuery = "";
			this.selectedBookIds.clear();
			this.render();
		}
		if (act === "close-folder-name") {
			this.namingOpen = false;
			this.namingParentId = null;
			this.namingSource = "";
			this.render();
		}
		if (act === "close-folder-pick") {
			this.moveBookIds = [];
			this.pendingPickFolderId = null;
			this.pickSubfoldersOnly = false;
			this.render();
		}
		if (act === "back-folder-pick") {
			this.pendingPickFolderId = null;
			this.render();
		}
		if (act === "pick-move-folder") {
			const id = t.dataset.id ?? "";
			if (!id) return;
			this.pendingPickFolderId = id;
			this.render();
		}
		if (act === "confirm-move-folder") await this.moveBookToFolder(this.pendingPickFolderId ?? "", t.dataset.mode === "move" ? "move" : "keep");
		if (act === "move-to-folder") await this.moveBookToFolder(t.dataset.id ?? "", t.dataset.mode === "move" ? "move" : "keep");
		if (act === "close-dissolve") {
			this.pendingDissolveIds = [];
			this.render();
		}
		if (act === "confirm-dissolve") await this.confirmDissolve();
		if (act === "confirm-folder-name") await this.confirmNewFolder();
		if (act === "new-folder") this.onNewFolder();
		if (act === "new-subfolder") this.onNewSubfolder(t.dataset.id ?? "");
		if (act === "naming-source") {
			this.namingSource = t.dataset.id ?? "";
			this.contentEl.querySelectorAll<HTMLElement>("[data-act='naming-source']").forEach((el) => {
				el.classList.toggle("on", el.dataset.id === this.namingSource);
			});
			const hint = this.contentEl.querySelector<HTMLElement>("[data-overlay='folder-name'] .muted");
			if (hint && this.namingSource) {
				hint.textContent = `建在${sourceOf(this.namingSource).name}下。微信读书和番茄的分组不是同一套。`;
			}
			return;
		}
		if (act === "toggle-select") {
			this.selecting = !this.selecting;
			this.selectedFolderIds.clear();
			this.selectedBookIds.clear();
			if (this.selecting) this.openFolderId = null;
			this.folderSelecting = false;
			this.render();
		}
		if (act === "toggle-folder-select") {
			this.folderSelecting = !this.folderSelecting;
			this.selectedBookIds.clear();
			this.render();
		}
		if (act === "toggle-select-all") this.toggleSelectAll();
		if (act === "join-selected") this.joinSelectedBooks();
		if (act === "join-selected-sub") this.joinSelectedToSubfolder();
		if (act === "join-to-sub") {
			if (this.skipBookClick) {
				this.skipBookClick = false;
				return;
			}
			this.joinSelectedToSubfolder(t.dataset.id ?? "");
		}
		if (act === "dissolve-selected") this.askDissolve([...this.selectedFolderIds]);
		if (act === "copy-into-folder") {
			this.pendingCopyFolderId = t.dataset.id ?? null;
			this.render();
		}
		if (act === "close-copy-folder") {
			this.pendingCopyFolderId = null;
			this.render();
		}
		if (act === "confirm-copy-folder") {
			await this.copyFolderInto(this.pendingCopyFolderId ?? "", t.dataset.mode === "move" ? "move" : "keep");
		}
		if (act === "split-folder" || act === "delete-folder") {
			this.askDissolve([t.dataset.id ?? ""]);
		}
		if (act === "leave-folder") {
			const bookId = t.dataset.id ?? "";
			const folderId = t.dataset.fid ?? "";
			await this.store().removeFromFolder(folderId, bookId);
			new Notice("已从本组移出");
			this.clearSearchAfterGroupChange();
			this.render();
		}
		if (act === "add-platform") {
			const name = (this.contentEl.querySelector("#np-name") as HTMLInputElement | null)?.value.trim() ?? "";
			const url = (this.contentEl.querySelector("#np-url") as HTMLInputElement | null)?.value.trim() ?? "";
			if (!name || !url) { new Notice("名称和网址都要填"); return; }
			const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
			const id = newId("c");
			await this.store().addPlatform({ id, name, url: href, desc: "自定义入口" });
			this.storePlatformId = id;
			new Notice("已加入书城");
			this.render();
		}
		if (act === "add-note") await this.addNote();
		if (act === "del-note") {
			const book = this.store().get(this.selectedId ?? "");
			if (!book) return;
			book.notes = book.notes.filter((n) => n.id !== t.dataset.nid);
			await this.store().persist();
			this.refreshNotesPane(book);
		}
		if (act === "toggle-daily") {
			this.store().settings.dailyNotes = !this.store().settings.dailyNotes;
			await this.store().persist();
			this.render();
		}
		if (act === "open-note-file") await this.openNoteFile();
	}

	private onInput(e: Event): void {
		const el = e.target as HTMLInputElement;
		if (el.classList.contains("search")) {
			this.query = el.value;
			this.syncSearchClear(el);
			if ((e as InputEvent).isComposing) return;
			this.refreshShelfResults();
			return;
		}
		if (el.classList.contains("folder-pick-q")) {
			this.folderPickQuery = el.value;
			this.syncSearchClear(el);
			if ((e as InputEvent).isComposing) return;
			const list = this.contentEl.querySelector(".folder-pick-list");
			if (list) list.innerHTML = this.folderPickListHtml();
			return;
		}
		if (el.classList.contains("folder-book-q")) {
			this.folderBookQuery = el.value;
			this.syncSearchClear(el);
			if ((e as InputEvent).isComposing) return;
			this.refreshFolderBooks();
			return;
		}
		if (el.classList.contains("folder-move-q")) {
			this.folderMoveQuery = el.value;
			this.syncSearchClear(el);
			if ((e as InputEvent).isComposing) return;
			const list = this.contentEl.querySelector(".folder-move-list");
			const folderId = this.openFolderId;
			if (list && folderId) list.innerHTML = this.folderMoveListHtml(folderId);
			return;
		}
		if (!el.dataset.set) return;
		this.applySetting(el.dataset.set, el.value);
	}

	private onSearchCompositionEnd(e: Event): void {
		const el = e.target as HTMLInputElement;
		if (!el.classList.contains("search") && !el.classList.contains("folder-pick-q") && !el.classList.contains("folder-move-q") && !el.classList.contains("folder-book-q")) return;
		if (el.classList.contains("folder-book-q")) {
			this.folderBookQuery = el.value;
			this.syncSearchClear(el);
			this.refreshFolderBooks();
			return;
		}
		if (el.classList.contains("folder-pick-q")) {
			this.folderPickQuery = el.value;
			this.syncSearchClear(el);
			const list = this.contentEl.querySelector(".folder-pick-list");
			if (list) list.innerHTML = this.folderPickListHtml();
			return;
		}
		if (el.classList.contains("folder-move-q")) {
			this.folderMoveQuery = el.value;
			this.syncSearchClear(el);
			const list = this.contentEl.querySelector(".folder-move-list");
			const folderId = this.openFolderId;
			if (list && folderId) list.innerHTML = this.folderMoveListHtml(folderId);
			return;
		}
		this.query = el.value;
		this.syncSearchClear(el);
		this.refreshShelfResults();
	}

	private onChange(e: Event): void {
		const el = e.target as HTMLInputElement | HTMLSelectElement;
		if (el.classList.contains("sort-sel")) {
			this.sort = el.value as SortKey;
			this.refreshShelfResults();
			if (this.openFolderId) {
				const box = this.contentEl.querySelector(".folder-dialog");
				if (box) box.innerHTML = this.folderDialogHtml();
				this.bindCovers();
			}
			return;
		}
		if (el.classList.contains("folder-title") && el.dataset.folderRename) {
			void this.store().renameFolder(el.dataset.folderRename, el.value);
			return;
		}
		if (el.classList.contains("file-input") && el instanceof HTMLInputElement && el.files) {
			void this.importFiles(el.files);
			return;
		}
		if (el.id === "folder-preset" && el.value) {
			this.applySetting("notesFolder", el.value);
			this.render();
			return;
		}
		if (el.dataset.set) this.applySetting(el.dataset.set, el.value);
	}

	private onKey(e: KeyboardEvent): void {
		if (e.key === "Enter" && this.namingOpen && (e.target as HTMLElement).classList.contains("folder-new-name")) {
			e.preventDefault();
			void this.confirmNewFolder();
			return;
		}
		if (e.key !== "Escape") return;
		if (this.pendingPickFolderId) {
			this.pendingPickFolderId = null;
			this.render();
			return;
		}
		if (this.pendingCopyFolderId) {
			this.pendingCopyFolderId = null;
			this.render();
			return;
		}
		this.importOpen = false;
		this.bindId = null;
		this.openFolderId = null;
		this.namingOpen = false;
		this.namingParentId = null;
		this.namingSource = "";
		this.moveBookIds = [];
		this.pendingCopyFolderId = null;
		this.pendingDissolveIds = [];
		this.pickSubfoldersOnly = false;
		this.clearSelect();
		this.render();
	}

	private onContextMenu(e: MouseEvent): void {
		const t = e.target as HTMLElement;
		const folder = t.closest(".folder-card") as HTMLElement | null;
		if (folder?.dataset.id) {
			e.preventDefault();
			const id = folder.dataset.id;
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle("打散分组").onClick(() => this.askDissolve([id]));
			});
			if (canNestUnder(this.store().folders, id)) {
				menu.addItem((item) => {
					item.setTitle("新建子分组").onClick(() => this.onNewSubfolder(id));
				});
			}
			menu.showAtMouseEvent(e);
			return;
		}
		const book = t.closest("[data-book-id]") as HTMLElement | null;
		const bookId = book?.dataset.bookId;
		if (bookId) {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle("移动到分组").onClick(() => this.openFolderPick(bookId));
			});
			menu.showAtMouseEvent(e);
		}
	}

	private onDragStart(e: DragEvent): void {
		const card = (e.target as HTMLElement).closest("[data-book-id]") as HTMLElement | null;
		const id = card?.dataset.bookId;
		if (!id || !e.dataTransfer) return;
		if ((e.target as HTMLElement).closest(".folder-card")) {
			e.preventDefault();
			return;
		}
		if ((e.target as HTMLElement).closest("[data-act='leave-folder'], .folder-title, .group-tag")) {
			e.preventDefault();
			return;
		}
		this.dragBookId = id;
		this.dragTicks = 0;
		this.skipBookClick = false;
		e.dataTransfer.setData("text/plain", `zread:${id}`);
		e.dataTransfer.effectAllowed = "copyMove";
	}

	private onDragEnd(): void {
		this.contentEl.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
		this.skipBookClick = this.dragTicks > 4;
		this.dragBookId = null;
		this.dragTicks = 0;
	}

	private onDrag(e: DragEvent, over: boolean): void {
		const t = e.target as HTMLElement;
		const importDrop = t.closest("[data-drop]");
		if (importDrop) {
			e.preventDefault();
			importDrop.classList.toggle("over", over);
			return;
		}
		if (!this.dragBookId) return;
		this.dragTicks += 1;
		const folder = t.closest("[data-folder-drop]") as HTMLElement | null;
		if (!folder || folder.dataset.folderDrop === this.dragBookId) return;
		const target = this.store().folders.find((f) => f.id === folder.dataset.folderDrop);
		const book = this.store().get(this.dragBookId);
		e.preventDefault();
		if (target && book && !canAddBookToFolder(target, book)) {
			if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
			return;
		}
		if (target && book && isArchivedBook(book.id, this.store().folders) && !isArchiveFolder(this.store().folders, target)) {
			if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
			return;
		}
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
		folder.classList.toggle("drop-target", over);
	}

	private async onDrop(e: DragEvent): Promise<void> {
		const t = e.target as HTMLElement;
		const importDrop = t.closest("[data-drop]");
		if (importDrop) {
			e.preventDefault();
			importDrop.classList.remove("over");
			if (e.dataTransfer?.files.length) await this.importFiles(e.dataTransfer.files);
			return;
		}
		const raw = e.dataTransfer?.getData("text/plain") ?? "";
		const fromId = this.dragBookId || (raw.startsWith("zread:") ? raw.slice(6) : "");
		if (!fromId) return;
		e.preventDefault();
		this.skipBookClick = true;
		const folderEl = t.closest("[data-folder-drop]") as HTMLElement | null;
		this.dragBookId = null;
		this.contentEl.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
		if (folderEl?.dataset.folderDrop) {
			const folder = this.store().folders.find((f) => f.id === folderEl.dataset.folderDrop);
			const book = this.store().get(fromId);
			if (!folder || !book) return;
			if (this.refuseCrossSource(folder, book)) return;
			if (this.refuseArchived(folder, book)) return;
			const ok = await this.store().addToFolder(folder.id, fromId);
			if (ok) {
				new Notice("已加入分组");
				this.clearSearchAfterGroupChange();
			}
			this.render();
		}
	}

	private clearSelect(): void {
		this.selecting = false;
		this.folderSelecting = false;
		this.selectedFolderIds.clear();
		this.selectedBookIds.clear();
	}

	private toggleFolder(id: string): void {
		if (!id) return;
		if (this.selectedFolderIds.has(id)) this.selectedFolderIds.delete(id);
		else this.selectedFolderIds.add(id);
		this.refreshSelectionUi();
	}

	private toggleBook(id: string): void {
		if (!id) return;
		const book = this.store().get(id);
		if (!book) return;
		if (!this.folderSelecting && isArchivedBook(book.id, this.store().folders)) return;
		if (this.selectedBookIds.has(id)) this.selectedBookIds.delete(id);
		else this.selectedBookIds.add(id);
		this.refreshSelectionUi();
	}

	private selectableFolderBooks(): Book[] {
		const folder = this.store().folders.find((f) => f.id === this.openFolderId);
		if (!folder) return [];
		return this.folderBooksList(folder);
	}

	private selectableShelfBooks(): Book[] {
		return this.shelfBooks()
			.filter((b) => !isArchivedBook(b.id, this.store().folders));
	}

	private toggleSelectAll(): void {
		const ids = (this.folderSelecting ? this.selectableFolderBooks() : this.selectableShelfBooks()).map((b) => b.id);
		if (!ids.length) return;
		if (ids.every((id) => this.selectedBookIds.has(id))) {
			for (const id of ids) this.selectedBookIds.delete(id);
		} else {
			this.selectedBookIds = new Set(ids);
		}
		this.refreshSelectionUi();
	}

	private refreshSelectionUi(): void {
		this.contentEl.querySelectorAll<HTMLElement>(".folder-card[data-id]").forEach((card) => {
			const on = this.selectedFolderIds.has(card.dataset.id ?? "");
			card.classList.toggle("picked", on);
			card.querySelector(".pick-mark")?.classList.toggle("on", on);
		});
		this.contentEl.querySelectorAll<HTMLElement>(".book-card[data-book-id]").forEach((card) => {
			const on = this.selectedBookIds.has(card.dataset.bookId ?? "") && !card.classList.contains("locked");
			card.classList.toggle("picked", on);
			card.querySelector(".pick-mark")?.classList.toggle("on", on);
		});
		const dissolve = this.contentEl.querySelector("[data-act='dissolve-selected']") as HTMLButtonElement | null;
		if (dissolve) dissolve.disabled = this.selectedFolderIds.size === 0;
		const join = this.contentEl.querySelector("[data-act='join-selected']") as HTMLButtonElement | null;
		if (join) join.disabled = this.selectedBookIds.size === 0;
		const joinSub = this.contentEl.querySelector("[data-act='join-selected-sub']") as HTMLButtonElement | null;
		if (joinSub) {
			const parent = this.store().folders.find((f) => f.id === this.openFolderId);
			joinSub.disabled = this.selectedBookIds.size === 0 || !parent || !childFolders(this.store().folders, parent.id).length;
		}
		const selectAll = this.contentEl.querySelector("[data-act='toggle-select-all']") as HTMLButtonElement | null;
		if (selectAll) {
			const ids = this.folderSelecting ? this.selectableFolderBooks() : this.selectableShelfBooks();
			const allOn = ids.length > 0 && ids.every((b) => this.selectedBookIds.has(b.id));
			selectAll.disabled = ids.length === 0;
			selectAll.textContent = allOn ? "取消全选" : "全选";
			selectAll.classList.toggle("on", allOn);
		}
	}

	private joinSelectedToSubfolder(targetId?: string): void {
		const parent = this.store().folders.find((f) => f.id === this.openFolderId);
		if (!parent || parent.parentId) return;
		const books = this.selectableFolderBooks().filter((b) => this.selectedBookIds.has(b.id));
		if (!books.length) {
			new Notice("请先勾选图书");
			return;
		}
		const kids = sortFolders(childFolders(this.store().folders, parent.id));
		if (!kids.length) {
			new Notice("请先新建子分组");
			return;
		}
		const hit = targetId ? kids.find((k) => k.id === targetId) : undefined;
		this.pickSubfoldersOnly = true;
		this.moveBookIds = books.map((b) => b.id);
		this.folderPickQuery = "";
		this.pendingPickFolderId = hit?.id ?? (kids.length === 1 ? kids[0]!.id : null);
		this.render();
	}

	private joinSelectedBooks(): void {
		const books = [...this.selectedBookIds]
			.map((id) => this.store().get(id))
			.filter((b): b is Book => Boolean(b))
			.filter((b) => !isArchivedBook(b.id, this.store().folders));
		if (!books.length) return;
		if (!sharedSource(books)) {
			new Notice("请只勾选同一来源的书，微信读书和番茄不能混进同一组");
			return;
		}
		this.openFolderPick(books.map((b) => b.id));
	}

	private openFolderPick(bookId: string | string[]): void {
		this.moveBookIds = (Array.isArray(bookId) ? bookId : [bookId]).filter(Boolean);
		if (!this.moveBookIds.length) return;
		this.folderPickQuery = "";
		this.pendingPickFolderId = null;
		this.render();
	}

	private focusDialogField(): void {
		const sel = this.namingOpen ? ".folder-new-name" : this.moveBookIds.length && !this.pendingPickFolderId ? ".folder-pick-q" : "";
		if (!sel) return;
		const el = this.contentEl.querySelector(sel) as HTMLInputElement | null;
		el?.focus();
		el?.select();
	}

	private refuseCrossSource(folder: ShelfFolder, book: Book): boolean {
		if (canAddBookToFolder(folder, book)) return false;
		new Notice(`${sourceOf(book.source).name} 和 ${sourceOf(folder.source ?? "").name} 的分组不是同一套`);
		return true;
	}

	private refuseArchived(folder: ShelfFolder, book: Book): boolean {
		if (!isArchivedBook(book.id, this.store().folders)) return false;
		if (isArchiveFolder(this.store().folders, folder)) return false;
		new Notice("已在「完本留存」里，不能再放到其他分组");
		return true;
	}

	private onNewFolder(): void {
		this.page = "shelf";
		this.openFolderId = null;
		this.namingParentId = null;
		this.namingSource = this.filter !== "all" ? this.filter : "";
		if (!this.namingSource) {
			const sources = [...new Set(this.store().books.map((b) => b.source))];
			if (sources.length === 1) this.namingSource = sources[0] ?? "";
		}
		this.namingOpen = true;
		this.render();
	}

	private onNewSubfolder(parentId: string): void {
		if (!canNestUnder(this.store().folders, parentId)) {
			new Notice("子分组不能再套一层");
			return;
		}
		this.page = "shelf";
		this.namingParentId = parentId;
		this.namingSource = this.store().folders.find((f) => f.id === parentId)?.source ?? "";
		this.namingOpen = true;
		this.render();
	}

	private askDissolve(folderIds: string[]): void {
		const ids = [...new Set(folderIds.filter(Boolean))];
		if (!ids.length) return;
		this.pendingDissolveIds = ids;
		this.render();
	}

	private async confirmDissolve(): Promise<void> {
		const folderIds = this.pendingDissolveIds;
		if (!folderIds.length) return;
		const before = this.store().folders.length;
		await this.store().dissolveFolders(folderIds);
		if (this.openFolderId && !this.store().folders.some((f) => f.id === this.openFolderId)) {
			this.openFolderId = null;
		}
		this.pendingDissolveIds = [];
		this.selectedFolderIds.clear();
		this.selecting = false;
		new Notice(`已打散 ${before - this.store().folders.length} 个分组，书还在书架上`);
		this.clearSearchAfterGroupChange();
		this.render();
	}

	private async moveBookToFolder(folderId: string, mode: "move" | "keep" = "keep"): Promise<void> {
		const bookIds = this.moveBookIds.filter(Boolean);
		if (!bookIds.length || !folderId) return;
		const folder = this.store().folders.find((f) => f.id === folderId);
		if (!folder) return;
		const books = bookIds.map((id) => this.store().get(id)).filter((b): b is Book => Boolean(b));
		if (books.some((book) => this.refuseCrossSource(folder, book))) return;
		let n = 0;
		for (const book of books) {
			if (this.store().foldersOf(book.id).some((f) => f.id === folderId)) continue;
			const current = this.store().foldersOf(book.id).map((f) => f.id);
			const leave = this.openFolderId && current.includes(this.openFolderId)
				? [this.openFolderId]
				: current;
			if (await this.store().placeInFolder(folderId, book.id, mode, mode === "move" ? leave : undefined)) n++;
		}
		const name = this.store().folders.find((f) => f.id === folderId)?.name ?? "分组";
		this.moveBookIds = [];
		this.pendingPickFolderId = null;
		this.pickSubfoldersOnly = false;
		this.selectedBookIds.clear();
		if (n) {
			new Notice(n === 1
				? (mode === "move" ? `已移入「${name}」` : `已加入「${name}」`)
				: (mode === "move" ? `已将 ${n} 本移入「${name}」` : `已将 ${n} 本加入「${name}」`));
		}
		this.clearSearchAfterGroupChange();
		this.render();
	}

	private async copyFolderInto(targetId: string, mode: "move" | "keep" = "keep"): Promise<void> {
		const sourceId = this.openFolderId;
		const source = this.store().folders.find((f) => f.id === sourceId);
		const target = this.store().folders.find((f) => f.id === targetId);
		if (!source || !target || targetId === sourceId) return;
		if (source.source && target.source && source.source !== target.source) {
			new Notice("不能把书拷到另一个来源的分组");
			return;
		}
		if (!source.bookIds.length) {
			new Notice("本组还没有书");
			return;
		}
		const ids = [...source.bookIds];
		let n = 0;
		let skipped = 0;
		for (const bookId of ids) {
			if (!isArchiveFolder(this.store().folders, target) && isArchivedBook(bookId, this.store().folders)) {
				skipped++;
				continue;
			}
			if (await this.store().placeInFolder(targetId, bookId, mode, mode === "move" ? [source.id] : undefined)) n++;
		}
		this.folderMoveQuery = "";
		this.pendingCopyFolderId = null;
		const skipHint = skipped ? `，${skipped} 本仍留在完本留存` : "";
		new Notice(mode === "move" ? `已将 ${n} 本移入「${target.name}」` : `已将 ${n} 本加入「${target.name}」${skipHint}`);
		this.clearSearchAfterGroupChange();
		this.render();
	}

	private async confirmNewFolder(): Promise<void> {
		if (!this.namingOpen) return;
		const parentId = this.namingParentId ?? undefined;
		const source = this.namingSource || this.store().folders.find((f) => f.id === parentId)?.source || "";
		if (!parentId && !source) {
			new Notice("请先选择来源：微信读书和番茄的分组不是同一套");
			return;
		}
		const typed = (this.contentEl.querySelector(".folder-new-name") as HTMLInputElement | null)?.value.trim();
		const name = typed || nextFolderName(this.store().folders, parentId, source || undefined);
		await this.store().createFolderFromBooks([], name, parentId, source || undefined);
		this.namingOpen = false;
		this.namingParentId = null;
		this.namingSource = "";
		this.lens = "groups";
		if (parentId) this.openFolderId = parentId;
		new Notice(parentId ? `已在「${this.store().folders.find((f) => f.id === parentId)?.name ?? "分组"}」下创建「${name}」` : `已创建「${name}」，把书拖进去即可`);
		this.clearSearchAfterGroupChange();
		this.render();
	}

	private applySetting(key: string, value: string): void {
		const s = this.store().settings;
		if (key === "notesFolder") s.notesFolder = value.trim() || s.notesFolder;
		if (key === "fileName") s.fileName = value.trim() || "{{title}}";
		if (key === "subfolder" && (value === "none" || value === "source" || value === "book")) s.subfolder = value;
		if (key === "dailyFolder") s.dailyFolder = value.trim() || s.dailyFolder;
		void this.store().persist();
		const preview = this.contentEl.querySelector("#path-preview");
		const sample = this.store().books[0];
		if (preview && sample) preview.textContent = vaultPath(sample, s);
	}

	private async bindPaste(): Promise<void> {
		const id = this.bindId;
		if (!id) return;
		const token = (this.contentEl.querySelector("#bind-token") as HTMLInputElement | null)?.value.trim() ?? "";
		const cookie = (this.contentEl.querySelector("#bind-cookie") as HTMLInputElement | null)?.value.trim() ?? "";
		if (id === "weread") {
			try {
				if (token && isApiKey(token)) {
					await this.applyWereadSession(await completeWereadSession([], token), "paste");
					return;
				}
				const cookies = parseCookieHeader(cookie || token);
				if (!cookies.length) { new Notice("请粘贴 API Key 或 Cookie"); return; }
				await this.applyWereadSession(await completeWereadSession(cookies, isApiKey(token) ? token : ""), "paste");
			} catch (err) {
				new Notice(`微信读书绑定失败：${err instanceof Error ? err.message : String(err)}`);
			}
			return;
		}
		if (id === "fanqie") {
			try {
				const cookies = normalizeFanqieCookie(cookie || token);
				if (!fanqieCookiesReady(cookies)) { new Notice("请粘贴 sessionid 或完整 Cookie"); return; }
				await this.applyFanqieSession(await completeFanqieSession(cookies), "paste");
			} catch (err) {
				new Notice(`番茄小说绑定失败：${err instanceof Error ? err.message : String(err)}`);
			}
			return;
		}
		const account = token || cookie;
		if (!account) { new Notice("先粘贴 API Key、用户 ID 或 Cookie"); return; }
		await this.store().bind(id, account, "paste");
		this.bindId = null;
		new Notice(`${sourceOf(id).name} 已绑定`);
		this.render();
	}

	private async startWereadScan(): Promise<void> {
		if (this.wereadBusy) return;
		this.wereadBusy = true;
		this.render();
		try {
			await this.applyWereadSession(await loginWeread(), "qr");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!/已关闭登录窗口/.test(msg)) new Notice(`微信读书登录失败：${msg}`);
		} finally {
			this.wereadBusy = false;
			this.render();
		}
	}

	private stopFanqieQr(clear = false): void {
		this.fanqieTick++;
		if (this.fanqiePoll != null) {
			window.clearInterval(this.fanqiePoll);
			this.fanqiePoll = null;
		}
		this.fanqieBusy = false;
		if (clear) {
			this.fanqieQr = null;
			this.fanqieQrHint = "";
		}
	}

	private async startFanqieScan(): Promise<void> {
		this.stopFanqieQr();
		const tick = ++this.fanqieTick;
		this.fanqieBusy = true;
		this.fanqieQrHint = "正在获取二维码…";
		this.render();
		try {
			const pending = await startFanqieQr();
			if (tick !== this.fanqieTick) return;
			this.fanqieQr = pending;
			this.fanqieQrHint = "等待扫码…";
			this.render();
			this.fanqiePoll = window.setInterval(() => void this.tickFanqieQr(tick), 2000);
		} catch (err) {
			if (tick !== this.fanqieTick) return;
			this.fanqieBusy = false;
			const msg = err instanceof Error ? err.message : String(err);
			this.fanqieQrHint = msg;
			new Notice(`番茄出码失败：${msg}`);
			this.render();
		}
	}

	private async tickFanqieQr(tick: number): Promise<void> {
		if (tick !== this.fanqieTick || !this.fanqieQr) return;
		try {
			const result = await pollFanqieQr(this.fanqieQr);
			if (tick !== this.fanqieTick) return;
			if (result.status === "waiting") return;
			if (result.status === "scanned") {
				if (this.fanqieQrHint !== "已扫码，等待确认…") {
					this.fanqieQrHint = "已扫码，等待确认…";
					this.render();
				}
				return;
			}
			if (result.status === "expired" || result.status === "failed") {
				this.fanqieQrHint = "二维码已过期，正在刷新…";
				this.render();
				await this.startFanqieScan();
				return;
			}
			if (result.status === "success" && result.cookies) {
				this.stopFanqieQr();
				await writeFanqiePartitionCookies(result.cookies);
				await this.applyFanqieSession(await completeFanqieSession(result.cookies), "qr");
			}
		} catch (err) {
			if (tick !== this.fanqieTick) return;
			this.stopFanqieQr();
			const msg = err instanceof Error ? err.message : String(err);
			this.fanqieQrHint = msg;
			new Notice(`番茄小说登录失败：${msg}`);
			this.render();
		}
	}

	private async refreshWereadShelf(): Promise<void> {
		const wr = this.store().channels.weread;
		if (!wr?.bound || !(wr.apiKey || wr.cookies?.length)) return;
		const stale = this.store().books.some((b) => b.source === "weread" && (!b.cover || !b.webUrl));
		if (stale) {
			try {
				const books = await fetchWereadNotebooks({
					cookies: wr.cookies ?? [],
					apiKey: wr.apiKey ?? "",
					account: wr.account,
				});
				await this.store().mergeSourceBooks("weread", books);
				this.render();
			} catch {
				/* 打开时静默，用户可再点同步 */
			}
		}
		await this.loadWereadCovers();
	}

	private async refreshFanqieShelf(): Promise<void> {
		const fq = this.store().channels.fanqie;
		if (!fq?.bound || !fq.cookies?.length) return;
		const stale = this.store().books.some((b) => b.source === "fanqie" && (!b.cover || !b.webUrl));
		const empty = !this.store().books.some((b) => b.source === "fanqie");
		if (stale || empty) {
			try {
				const books = await fetchFanqieBooks(fq.cookies ?? []);
				await this.store().mergeSourceBooks("fanqie", books);
				this.render();
			} catch {
				/* 打开时静默，用户可再点同步 */
			}
		}
		await this.loadWereadCovers();
	}

	private async loadWereadCovers(): Promise<void> {
		if (this.coverLoading) return;
		const pending = this.store().books.filter((b) => b.cover && !this.coverBytes.has(b.id));
		if (!pending.length) return;
		this.coverLoading = true;
		let got = 0;
		try {
			await Promise.all(pending.map(async (book) => {
				const data = await fetchCoverDataUrl(book.cover ?? "");
				if (data) {
					this.coverBytes.set(book.id, data);
					got++;
				}
			}));
		} finally {
			this.coverLoading = false;
		}
		if (got) this.render();
	}

	private async applyWereadSession(session: { cookies: { name: string; value: string }[]; apiKey: string; account: string }, method: BindMethod): Promise<void> {
		await this.store().bind("weread", session.account, method, { cookies: session.cookies, apiKey: session.apiKey });
		this.bindId = null;
		this.page = "shelf";
		this.filter = "weread";
		try {
			const books = await fetchWereadNotebooks(session);
			await this.store().mergeSourceBooks("weread", books);
			new Notice(books.length ? `微信读书已绑定，同步了 ${books.length} 本` : "微信读书已绑定，书架接口没有返回书目");
		} catch (err) {
			new Notice(`已登录，但拉书架失败：${err instanceof Error ? err.message : String(err)}。可点「同步已绑定渠道」重试。`);
		}
		this.render();
		void this.loadWereadCovers();
	}

	private async applyFanqieSession(session: { cookies: { name: string; value: string }[]; account: string }, method: BindMethod): Promise<void> {
		await this.store().bind("fanqie", session.account, method, { cookies: session.cookies });
		this.bindId = null;
		this.page = "shelf";
		this.filter = "fanqie";
		try {
			const books = await fetchFanqieBooks(session.cookies);
			await this.store().mergeSourceBooks("fanqie", books);
			new Notice(books.length ? `番茄小说已绑定，同步了 ${books.length} 本` : "番茄小说已绑定，书架接口没有返回书目");
		} catch (err) {
			new Notice(`已登录，但拉书架失败：${err instanceof Error ? err.message : String(err)}。可点「同步已绑定渠道」重试。`);
		}
		this.render();
		void this.loadWereadCovers();
	}

	private async syncAll(): Promise<void> {
		const bound = Object.entries(this.store().channels).filter(([, c]) => c.bound).map(([id]) => id);
		if (!bound.length) { new Notice("还没有绑定任何渠道"); return; }
		const wr = this.store().channels.weread;
		if (wr?.bound && (wr.apiKey || wr.cookies?.length)) {
			try {
				const books = await fetchWereadNotebooks({
					cookies: wr.cookies ?? [],
					apiKey: wr.apiKey ?? "",
					account: wr.account,
				});
				await this.store().mergeSourceBooks("weread", books);
				new Notice(`微信读书已同步 ${books.length} 本`);
			} catch (err) {
				new Notice(`微信读书同步失败：${err instanceof Error ? err.message : String(err)}`);
			}
		}
		const fq = this.store().channels.fanqie;
		if (fq?.bound && fq.cookies?.length) {
			try {
				const books = await fetchFanqieBooks(fq.cookies ?? []);
				await this.store().mergeSourceBooks("fanqie", books);
				new Notice(`番茄小说已同步 ${books.length} 本`);
			} catch (err) {
				new Notice(`番茄小说同步失败：${err instanceof Error ? err.message : String(err)}`);
			}
		}
		await this.store().touchSync(bound);
		this.page = "shelf";
		this.render();
		void this.loadWereadCovers();
	}

	private async importFiles(files: FileList): Promise<void> {
		for (const file of Array.from(files)) {
			const ext = (file.name.split(".").pop() || "").toLowerCase();
			if (ext === "txt" || ext === "md") {
				const text = await file.text();
				await this.store().importLocal({ name: file.name, text, ext });
				new Notice(`已导入 ${file.name}`);
			} else {
				await this.store().importLocal({
					name: file.name,
					text: "",
					ext,
				});
				new Notice(`已登记 ${file.name}（暂不解析正文）`);
			}
		}
		this.importOpen = false;
		this.filter = "local";
		this.page = "shelf";
		this.render();
	}

	private async hydrateNotes(book: Book): Promise<void> {
		try {
			const fromFile = await loadNotesFromVault(this.app, book, this.store().settings);
			if (fromFile?.length) {
				book.notes = fromFile;
				await this.store().persist();
			}
		} catch {
			/* 文件不存在或无法读取时沿用内存笔记 */
		}
	}

	private async addNote(): Promise<void> {
		const book = this.store().get(this.selectedId ?? "");
		const text = (this.contentEl.querySelector("#note-input") as HTMLTextAreaElement | null)?.value ?? "";
		if (!book) return;
		const chapter = book.chapters[this.chapter] || "";
		await this.saveNote(book, text, chapter, "手写");
	}

	private async saveNote(book: Book, text: string, chapter: string, from: string): Promise<void> {
		const body = text.trim();
		if (!body) { new Notice("先写一点笔记"); return; }
		const note: Note = { id: newId("n"), text: body, chapter, at: nowStr(), from };
		book.notes.unshift(note);
		book.lastRead = todayStr();
		await this.store().persist();
		try {
			const path = await writeNoteToVault(this.app, book, this.store().settings, note);
			new Notice(`已记入 ${path}`);
		} catch (err) {
			new Notice(`笔记已保存在插件数据，写入库失败：${String(err)}`);
		}
		this.refreshNotesPane(book, from === "手写");
	}

	private async openNoteFile(): Promise<void> {
		const book = this.store().get(this.selectedId ?? "");
		if (!book) return;
		const path = normalizePath(vaultPath(book, this.store().settings));
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) { new Notice("还没有笔记文件，先记一条"); return; }
		await this.app.workspace.getLeaf(true).openFile(file);
	}
}
