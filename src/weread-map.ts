import { createHash } from "crypto";
import type { Book } from "./model";

export interface NamedCookie {
	name: string;
	value: string;
}

export function parseCookieHeader(raw: string): NamedCookie[] {
	const text = raw.trim();
	if (!text) return [];
	if (!text.includes("=")) {
		const key = text.startsWith("wrk-") || text.startsWith("wr_key") ? "apikey" : "wr_skey";
		return [{ name: key, value: text }];
	}
	const out: NamedCookie[] = [];
	for (const part of text.split(";")) {
		const i = part.indexOf("=");
		if (i < 0) continue;
		const name = part.slice(0, i).trim();
		const value = part.slice(i + 1).trim();
		if (!name) continue;
		out.push({ name, value });
	}
	return out;
}

export function cookieHeader(cookies: NamedCookie[]): string {
	return cookies
		.filter((c) => c.name && c.value && c.name !== "apikey")
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");
}

export function isApiKey(token: string): boolean {
	const t = token.trim();
	return t.startsWith("wrk-") || t.startsWith("wr_key") || t.startsWith("weread_");
}

function unixDay(sec: number): string {
	if (!sec || !Number.isFinite(sec)) return "";
	const d = new Date(sec * 1000);
	if (Number.isNaN(d.getTime())) return "";
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

function md5hex(text: string): string {
	return createHash("md5").update(text).digest("hex");
}

function idChunks(bookId: string): [string, string[]] {
	if (/^\d+$/.test(bookId)) {
		const parts: string[] = [];
		for (let i = 0; i < bookId.length; i += 9) {
			parts.push(parseInt(bookId.slice(i, i + 9), 10).toString(16));
		}
		return ["3", parts];
	}
	let hex = "";
	for (let i = 0; i < bookId.length; i++) hex += bookId.charCodeAt(i).toString(16);
	return ["4", [hex]];
}

/** 微信读书网页阅读器地址。原始 bookId 直接拼 /web/reader/ 会 404。 */
export function wereadReaderUrl(bookId: string): string {
	const hash = md5hex(bookId);
	const [kind, parts] = idChunks(bookId);
	let out = hash.slice(0, 3) + kind + "2" + hash.slice(-2);
	for (let i = 0; i < parts.length; i++) {
		const len = parts[i]!.length.toString(16);
		out += (len.length === 1 ? "0" + len : len) + parts[i];
		if (i < parts.length - 1) out += "g";
	}
	if (out.length < 20) out += hash.slice(0, 20 - out.length);
	out += md5hex(out).slice(0, 3);
	return `https://weread.qq.com/web/reader/${out}`;
}

export function wereadCoverUrl(raw: string): string {
	const text = raw.trim();
	if (!text) return "";
	return text.replace("/s_", "/t7_");
}

export function wereadWebUrl(raw: string, bookId: string): string {
	const text = raw.trim();
	if (text.startsWith("http://") || text.startsWith("https://")) return text;
	if (text.startsWith("/")) return `https://weread.qq.com${text}`;
	if (text.startsWith("web/reader/")) return `https://weread.qq.com/${text}`;
	return bookId ? wereadReaderUrl(bookId) : "";
}

export function notebooksToBooks(raw: unknown): Book[] {
	const list = Array.isArray(raw)
		? raw
		: (raw && typeof raw === "object" && Array.isArray((raw as { books?: unknown }).books)
			? (raw as { books: unknown[] }).books
			: []);
	const books: Book[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		const inner = (row.book && typeof row.book === "object" ? row.book : row) as Record<string, unknown>;
		const bookId = String(inner.bookId ?? row.bookId ?? "");
		const title = String(inner.title ?? row.title ?? "").trim();
		if (!bookId || !title) continue;
		const sort = Number(row.sort ?? inner.sort ?? 0);
		const url = String(inner.url ?? row.url ?? "");
		const coverRaw = String(inner.cover ?? row.cover ?? "");
		const finished = Number(row.finishReading ?? inner.finishReading ?? 0) === 1;
		const bookType = Number(inner.type ?? inner.bookType ?? row.bookType ?? 0);
		const chapterTotal = Number(inner.chapterCount ?? row.chapterCount ?? 0) || 0;
		const rawAt = Number(inner.chapterIdx ?? row.chapterIdx);
		const chapterAt = Number.isFinite(rawAt) && rawAt >= 0
			? rawAt
			: (finished && chapterTotal ? chapterTotal : undefined);
		books.push({
			id: `weread:${bookId}`,
			source: "weread",
			title,
			author: String(inner.author ?? row.author ?? "佚名"),
			progress: finished ? 100 : (Number(inner.progress ?? row.progress ?? row.readingProgress ?? 0) || 0),
			lastRead: unixDay(sort),
			remoteId: bookId,
			webUrl: wereadWebUrl(url, bookId),
			cover: wereadCoverUrl(coverRaw),
			kind: bookType === 3 ? "article" : "book",
			markCount: Number(row.noteCount ?? inner.noteCount ?? 0) || 0,
			reviewCount: Number(row.reviewCount ?? inner.reviewCount ?? 0) || 0,
			chapters: ["在线阅读"],
			...(chapterTotal > 0 && chapterAt != null ? { chapterAt, chapterTotal } : {}),
			text: "",
			highlights: [],
			notes: [],
		});
	}
	return books;
}
