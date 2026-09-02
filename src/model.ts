import { wereadReaderUrl } from "./weread-map.ts";

export const VIEW_TYPE = "z-read-view";

export type SubfolderMode = "none" | "source" | "book";
export type BindMethod = "qr" | "paste" | "web";
export type MainView = "shelf" | "store" | "channels" | "reader" | "settings";
export type ReaderTab = "native" | "embed" | "highlights";
export type ShelfMode = "split" | "mix";
export type SortKey = "recent" | "progress" | "title";

export interface SourceInfo {
	id: string;
	name: string;
	url: string;
	color: string;
	bind: string;
	qrApp: string;
	qrHint: string;
	pasteLabel: string;
	pastePh: string;
	pasteHint: string;
	cookieLabel: string;
	cookiePh: string;
	webLogin: string;
	qrPayload: string;
}

export interface Highlight {
	text: string;
	chapter: string;
}

export interface Note {
	id: string;
	text: string;
	chapter: string;
	at: string;
	from: string;
}

export interface Book {
	id: string;
	source: string;
	title: string;
	author: string;
	progress: number;
	lastRead: string;
	remoteId?: string;
	format?: string;
	chapters: string[];
	text: string;
	highlights: Highlight[];
	notes: Note[];
	webUrl?: string;
	cover?: string;
	kind?: "book" | "article" | "file";
	markCount?: number;
	reviewCount?: number;
	group?: string;
}

export interface ShelfFolder {
	id: string;
	name: string;
	bookIds: string[];
	parentId?: string;
	source?: string;
}

export interface ChannelState {
	bound: boolean;
	account: string;
	method?: BindMethod;
	lastSync: string;
	cookies?: { name: string; value: string }[];
	apiKey?: string;
}

export interface Platform {
	id: string;
	name: string;
	url: string;
	desc: string;
}

export interface ZReadSettings {
	notesFolder: string;
	fileName: string;
	subfolder: SubfolderMode;
	dailyNotes: boolean;
	dailyFolder: string;
}

export interface Persisted {
	settings: ZReadSettings;
	books: Book[];
	channels: Record<string, ChannelState>;
	customPlatforms: Platform[];
	folders?: ShelfFolder[];
	folderSeeded?: boolean;
}

export const DEFAULT_SETTINGS: ZReadSettings = {
	notesFolder: "Z-Read/笔记",
	fileName: "{{title}}",
	subfolder: "none",
	dailyNotes: false,
	dailyFolder: "07-日记",
};

export const FOLDER_PRESETS = ["Z-Read/笔记", "Weread", "02-麒麟信安/读书", "Books"];

export const SOURCES: Record<string, SourceInfo> = {
	weread: {
		id: "weread",
		name: "微信读书",
		url: "https://weread.qq.com",
		color: "var(--zread-weread)",
		bind: "弹出官方登录窗，微信扫码后同步书架书目",
		qrApp: "微信",
		qrHint: "会弹出微信读书登录窗口，扫窗里的码；不要扫静态图。",
		pasteLabel: "API Key",
		pastePh: "wrk-… 或 wr_key_…",
		pasteHint: "可粘贴 API Key，或 Cookie：wr_skey=…; wr_vid=…",
		cookieLabel: "Cookie（备选）",
		cookiePh: "wr_skey=…; wr_vid=…",
		webLogin: "https://weread.qq.com/#login",
		qrPayload: "https://weread.qq.com/#login",
	},
	fanqie: {
		id: "fanqie",
		name: "番茄小说",
		url: "https://fanqienovel.com",
		color: "var(--zread-fanqie)",
		bind: "弹出登录码，扫码后同步书架书目",
		qrApp: "番茄小说",
		qrHint: "用番茄小说 App 扫绑定页里的码。",
		pasteLabel: "sessionid",
		pastePh: "sessionid 或完整 Cookie",
		pasteHint: "可粘贴 sessionid，或 Cookie：sessionid=…; passport_csrf_token=…",
		cookieLabel: "Cookie（备选）",
		cookiePh: "sessionid=…",
		webLogin: "https://fanqienovel.com",
		qrPayload: "https://fanqienovel.com",
	},
	qidian: {
		id: "qidian",
		name: "起点中文网",
		url: "https://www.qidian.com",
		color: "var(--zread-qidian)",
		bind: "QQ / 微信扫码",
		qrApp: "QQ 或微信",
		qrHint: "扫码打开起点登录页，登录后把账号 ID 或 Cookie 贴回来。",
		pasteLabel: "用户 ID",
		pastePh: "填写账号 ID",
		pasteHint: "也可粘贴账号 ID，或从浏览器复制登录 Cookie。",
		cookieLabel: "Cookie（备选）",
		cookiePh: "ywguid=…",
		webLogin: "https://passport.yuewen.com",
		qrPayload: "https://passport.yuewen.com",
	},
	jjwxc: {
		id: "jjwxc",
		name: "晋江文学城",
		url: "https://www.jjwxc.net",
		color: "var(--zread-jjwxc)",
		bind: "网页登录 / 粘贴 Cookie",
		qrApp: "晋江",
		qrHint: "晋江以网页登录为主。扫码打开站点后，把 Cookie 贴回来。",
		pasteLabel: "用户 ID",
		pastePh: "填写账号 ID",
		pasteHint: "推荐打开登录页，登录后粘贴 Cookie。",
		cookieLabel: "Cookie（备选）",
		cookiePh: "token=…",
		webLogin: "https://www.jjwxc.net",
		qrPayload: "https://www.jjwxc.net",
	},
	local: {
		id: "local",
		name: "本地导入",
		url: "",
		color: "var(--zread-local)",
		bind: "",
		qrApp: "",
		qrHint: "",
		pasteLabel: "",
		pastePh: "",
		pasteHint: "",
		cookieLabel: "",
		cookiePh: "",
		webLogin: "",
		qrPayload: "",
	},
};

export const PLATFORMS: Platform[] = [
	{ id: "weread", name: "微信读书", url: "https://weread.qq.com", desc: "划线、想法、书评、阅读进度。API Key 见 weread.qq.com/api/skills/apikeyGet。" },
	{ id: "fanqie", name: "番茄小说", url: "https://fanqienovel.com", desc: "扫码同步书架书目与进度。正文在原站阅读，笔记写在 Vault。" },
	{ id: "qidian", name: "起点中文网", url: "https://www.qidian.com", desc: "书架与进度。付费章节只在原站阅读。" },
	{ id: "jjwxc", name: "晋江文学城", url: "https://www.jjwxc.net", desc: "预置入口。" },
	{ id: "qimao", name: "七猫免费小说", url: "https://www.qimao.com", desc: "预置入口。" },
];

export const BIND_IDS = ["weread", "fanqie", "qidian", "jjwxc"] as const;

export const EMPTY_CHANNEL: ChannelState = { bound: false, account: "", lastSync: "" };

export function sourceOf(id: string): SourceInfo {
	return SOURCES[id] ?? { ...SOURCES.local!, id, name: id };
}

export function newId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function todayStr(d = new Date()): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowStr(d = new Date()): string {
	return `${todayStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function esc(s: string): string {
	return String(s).replace(/[&<>"']/g, (c) => (
		{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
	));
}

export function sanitizeSeg(seg: string): string {
	return String(seg || "").replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "").trim();
}

export function vaultPath(book: Book, settings: ZReadSettings): string {
	const src = sourceOf(book.source);
	let name = (settings.fileName || "{{title}}")
		.replaceAll("{{title}}", book.title || "未命名")
		.replaceAll("{{author}}", book.author || "佚名")
		.replaceAll("{{source}}", src.name || "");
	name = sanitizeSeg(name) || "未命名";
	if (!name.toLowerCase().endsWith(".md")) name += ".md";
	const parts = [settings.notesFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")];
	if (settings.subfolder === "source") parts.push(sanitizeSeg(src.name));
	if (settings.subfolder === "book") parts.push(sanitizeSeg(book.title || "未命名"));
	parts.push(name);
	return parts.filter(Boolean).join("/");
}

export function openUrl(source: string, book?: Book): string {
	if (book?.webUrl) return book.webUrl;
	const src = sourceOf(source);
	if (source === "weread" && book?.remoteId) return wereadReaderUrl(book.remoteId);
	if (source === "fanqie" && book?.remoteId) return `https://fanqienovel.com/page/${book.remoteId}`;
	if (source === "qidian" && book?.remoteId) return `https://www.qidian.com/book/${book.remoteId}/`;
	return src.url;
}

export function hasNativeText(book: Book): boolean {
	const t = book.text || "";
	return Boolean(t) && !t.includes("【原型占位】") && !t.startsWith("【");
}

/** 原型演示书 id。真实插件不再注入，加载时也会清掉已写入的这些记录。 */
export const SEED_BOOK_IDS = ["wr-1", "wr-2", "fq-1", "qd-1", "loc-1"] as const;

export function dropSeedBooks(books: Book[]): Book[] {
	const seeds = new Set<string>(SEED_BOOK_IDS);
	return books.filter((b) => !seeds.has(b.id));
}

export function defaultChannels(): Record<string, ChannelState> {
	return {
		weread: { ...EMPTY_CHANNEL },
		fanqie: { ...EMPTY_CHANNEL },
		qidian: { ...EMPTY_CHANNEL },
		jjwxc: { ...EMPTY_CHANNEL },
	};
}
