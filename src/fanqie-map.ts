import type { Book } from "./model";
import { parseCookieHeader, type NamedCookie } from "./weread-map.ts";

export function fanqiePageUrl(bookId: string): string {
	return `https://fanqienovel.com/page/${bookId}`;
}

export function fanqieReaderUrl(itemId: string): string {
	return `https://fanqienovel.com/reader/${itemId}?enter_from=page`;
}

const PASSPORT_NEXT = "https://fanqienovel.com/";
const PASSPORT_QUERY: Record<string, string> = {
	aid: "2503",
	app_name: "novelapp",
	version_code: "57700",
	device_platform: "web",
	channel: "novel",
	sdk_version: "1.6.1",
	passport_sdk_version: "2.0.0",
	new_user: "0",
	next: PASSPORT_NEXT,
};

function passportQs(extra: Record<string, string> = {}): string {
	return new URLSearchParams({ ...PASSPORT_QUERY, ...extra }).toString();
}

export function fanqieQrcodeUrl(): string {
	return `https://fanqienovel.com/passport/web/get_qrcode/?${passportQs()}`;
}

export function fanqieQrPollUrl(token: string): string {
	return `https://fanqienovel.com/passport/web/check_qrconnect/?${passportQs({ token })}`;
}

export type FanqieQrStart =
	| { ok: true; token: string; qrDataUrl: string; qrIndexUrl: string; expireTime: number }
	| { ok: false; reason: "captcha" | "error"; message: string };

export function parseFanqieQrStart(raw: unknown): FanqieQrStart {
	const root = asRecord(raw);
	const data = asRecord(root.data);
	if (data.captcha) {
		return { ok: false, reason: "captcha", message: "番茄要求人机校验，请改用粘贴 Cookie" };
	}
	const err = data.error_code;
	if (err !== undefined && err !== 0 && err !== "0") {
		return { ok: false, reason: "error", message: String(data.description ?? root.message ?? "出码失败") };
	}
	const token = String(data.token ?? data.qr_token ?? "").trim();
	if (!token) return { ok: false, reason: "error", message: "未拿到二维码 token" };
	const qr = String(data.qrcode ?? "").trim();
	const qrDataUrl = !qr ? "" : qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
	return {
		ok: true,
		token,
		qrDataUrl,
		qrIndexUrl: String(data.qrcode_index_url ?? ""),
		expireTime: Number(data.expire_time ?? 0) || 0,
	};
}

export interface FanqieQrPoll {
	status: "waiting" | "scanned" | "success" | "expired" | "failed" | "captcha";
	redirectUrl?: string;
	message?: string;
}

export function parseFanqieQrPoll(raw: unknown): FanqieQrPoll {
	const data = asRecord(asRecord(raw).data);
	if (data.captcha) return { status: "captcha", message: "番茄要求人机校验，请改用粘贴 Cookie" };
	const redirectUrl = String(data.redirect_url ?? data.redirectUrl ?? data.url ?? data.next_url ?? "").trim();
	const status = String(data.status ?? "").toLowerCase();
	const err = data.error_code;
	if (redirectUrl || status === "confirmed" || status === "success" || status === "done" || status === "ok") {
		return { status: "success", redirectUrl };
	}
	if (err !== undefined && err !== 0 && err !== "0") {
		return { status: "expired", message: String(data.description ?? "二维码已过期，请刷新") };
	}
	if (status && status !== "new" && status !== "init" && status !== "waiting") return { status: "scanned" };
	return { status: "waiting" };
}

export function mergeSetCookie(cookies: NamedCookie[], raw: unknown): NamedCookie[] {
	const text = Array.isArray(raw) ? raw.map(String).join(", ") : raw == null ? "" : String(raw);
	const map = new Map(cookies.map((c) => [c.name, c]));
	if (!text) return Array.from(map.values());
	for (const chunk of text.split(/,(?=\s*[^=,;\s]+=)/)) {
		const first = chunk.split(";")[0] ?? "";
		const i = first.indexOf("=");
		if (i < 0) continue;
		const name = first.slice(0, i).trim();
		const value = first.slice(i + 1).trim();
		if (name && value) map.set(name, { name, value });
	}
	return Array.from(map.values());
}

export function normalizeFanqieCookie(raw: string): NamedCookie[] {
	const text = raw.trim();
	if (!text) return [];
	if (!text.includes("=")) return [{ name: "sessionid", value: text }];
	return parseCookieHeader(text);
}

export function fanqieCookiesReady(cookies: NamedCookie[]): boolean {
	return cookies.some((c) => (c.name === "sessionid" || c.name === "sessionid_ss") && Boolean(c.value));
}

export function fanqieCsrf(cookies: NamedCookie[]): string {
	return cookies.find((c) => c.name === "passport_csrf_token")?.value ?? "";
}

export function fanqieShelfIds(shelf: unknown): string[] {
	const ids: string[] = [];
	for (const item of listOf(shelf, ["book_shelf_info"])) {
		const id = String(asRecord(item).book_id ?? "").trim();
		if (id) ids.push(id);
	}
	return ids;
}

function unixDay(sec: number): string {
	if (!sec || !Number.isFinite(sec)) return "";
	const d = new Date(sec * 1000);
	if (Number.isNaN(d.getTime())) return "";
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

function asRecord(raw: unknown): Record<string, unknown> {
	return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
}

function dataOf(raw: unknown): Record<string, unknown> {
	const root = asRecord(raw);
	return asRecord(root.data);
}

function listOf(raw: unknown, keys: string[]): unknown[] {
	if (Array.isArray(raw)) return raw;
	const data = dataOf(raw);
	for (const key of keys) {
		const value = data[key];
		if (Array.isArray(value)) return value;
	}
	if (Array.isArray((raw as { data?: unknown })?.data)) return (raw as { data: unknown[] }).data;
	return [];
}

/** 官网进度接口里 index 经常是字符串 "0"，真实章节在 read_progress。 */
export function fanqieReadChapter(prog: Record<string, unknown>): number {
	const fromRead = Number(prog.read_progress);
	if (Number.isFinite(fromRead) && fromRead > 0) return fromRead;
	const fromIndex = Number(prog.index);
	if (Number.isFinite(fromIndex) && fromIndex > 0) return fromIndex;
	return 0;
}

function coverOf(row: Record<string, unknown>): string {
	const url = String(row.thumb_url ?? row.cover ?? "").trim();
	if (/^https?:\/\//i.test(url)) return url;
	const uri = String(row.thumb_uri ?? "").trim();
	if (!uri) return "";
	if (/^https?:\/\//i.test(uri)) return uri;
	return `https://p6-novel.byteimg.com/${uri}~tplv-shrink:320:0.image`;
}

export interface FanqieInputs {
	shelf: unknown;
	details: unknown;
	progress: unknown;
}

export function fanqieToBooks(input: FanqieInputs): Book[] {
	const shelf = listOf(input.shelf, ["book_shelf_info"]);
	const details = listOf(input.details, ["detail_list"]);
	const progress = listOf(input.progress, ["data"]);
	const detailById = new Map<string, Record<string, unknown>>();
	for (const item of details) {
		const row = asRecord(item);
		const id = String(row.book_id ?? "");
		if (id) detailById.set(id, row);
	}
	const progressById = new Map<string, Record<string, unknown>>();
	for (const item of progress) {
		const row = asRecord(item);
		const id = String(row.book_id ?? "");
		if (id) progressById.set(id, row);
	}
	const books: Book[] = [];
	for (const item of shelf) {
		const row = asRecord(item);
		const bookId = String(row.book_id ?? "").trim();
		if (!bookId) continue;
		const detail = detailById.get(bookId) ?? {};
		const prog = progressById.get(bookId) ?? {};
		const serial = Number(detail.serial_count ?? 0) || 0;
		const index = fanqieReadChapter(prog);
		const progressPct = serial > 0 && index > 0 ? Math.min(100, Math.round((index / serial) * 100)) : 0;
		const lastSec = Number(prog.read_timestamp ?? row.last_operate_time ?? 0) || 0;
		const title = String(detail.book_name ?? detail.title ?? "").trim() || `番茄书 ${bookId}`;
		const group = String(row.group_name ?? "").trim();
		const itemId = String(prog.item_id ?? prog.itemId ?? row.item_id ?? "").trim();
		books.push({
			id: `fanqie:${bookId}`,
			source: "fanqie",
			title,
			author: String(detail.author ?? detail.author_name ?? "佚名"),
			progress: progressPct,
			lastRead: unixDay(lastSec),
			remoteId: bookId,
			webUrl: itemId ? fanqieReaderUrl(itemId) : fanqiePageUrl(bookId),
			cover: coverOf(detail),
			kind: "book",
			chapters: ["在线阅读"],
			...(serial > 0 || index > 0 ? { chapterAt: index, ...(serial > 0 ? { chapterTotal: serial } : {}) } : {}),
			text: "",
			highlights: [],
			notes: [],
			...(group ? { group } : {}),
		});
	}
	return books;
}
