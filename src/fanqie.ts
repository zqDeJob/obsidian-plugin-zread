import { requestUrl } from "obsidian";
import type { Book } from "./model";
import { cookieHeader, type NamedCookie } from "./weread-map.ts";
import {
	fanqieCookiesReady,
	fanqieCsrf,
	fanqieQrPollUrl,
	fanqieQrcodeUrl,
	fanqieShelfIds,
	fanqieToBooks,
	mergeSetCookie,
	normalizeFanqieCookie,
	parseFanqieQrPoll,
	parseFanqieQrStart,
} from "./fanqie-map.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
const HOME_URL = "https://fanqienovel.com/";
const SHELF_URL = "https://fanqienovel.com/reading/bookapi/bookshelf/info/v:version/?aid=1967&iid=0&version_code=57700&update_version_code=57700";
const DETAIL_URL = "https://fanqienovel.com/api/bookshelf/multidetail";
const PROGRESS_URL = "https://fanqienovel.com/api/reader/book/progress";
const USER_URL = "https://fanqienovel.com/api/user/info/v2";
const DETAIL_BATCH = 40;

export interface FanqieSession {
	cookies: NamedCookie[];
	account: string;
}

export interface FanqieQrPending {
	token: string;
	qrDataUrl: string;
	cookies: NamedCookie[];
}

function jsonHeaders(cookies: NamedCookie[], extra?: Record<string, string>): Record<string, string> {
	const headers: Record<string, string> = {
		"User-Agent": UA,
		Accept: "application/json, text/plain, */*",
		"Accept-Language": "zh-CN,zh;q=0.9",
		Referer: HOME_URL,
		Origin: "https://fanqienovel.com",
		...extra,
	};
	const cookie = cookieHeader(cookies);
	if (cookie) headers.Cookie = cookie;
	return headers;
}

function setCookieOf(headers: Record<string, unknown>): unknown {
	return headers["set-cookie"] ?? headers["Set-Cookie"] ?? "";
}

async function fetchJson(url: string, opts: { method?: string; headers: Record<string, string>; body?: string }): Promise<unknown> {
	const resp = await requestUrl({
		url,
		method: opts.method ?? "GET",
		headers: opts.headers,
		body: opts.body,
		throw: false,
	});
	if (resp.status === 401 || resp.status === 403) throw new Error("番茄登录已失效，请重新扫码");
	let json = resp.json as unknown;
	if (json == null && resp.text) {
		try { json = JSON.parse(resp.text); } catch {
			throw new Error("番茄接口返回了非 JSON，可能被拦截");
		}
	}
	const code = json && typeof json === "object" ? (json as { code?: number | string }).code : undefined;
	if (code !== undefined && code !== 0 && code !== "0") {
		const msg = json && typeof json === "object" ? String((json as { message?: string }).message ?? "番茄接口失败") : "番茄接口失败";
		throw new Error(msg);
	}
	return json;
}

function asRecord(raw: unknown): Record<string, unknown> {
	return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
}

export async function startFanqieQr(): Promise<FanqieQrPending> {
	const resp = await requestUrl({
		url: fanqieQrcodeUrl(),
		throw: false,
		headers: jsonHeaders([]),
	});
	const cookies = mergeSetCookie([], setCookieOf(resp.headers as Record<string, unknown>));
	let json = resp.json as unknown;
	if (json == null && resp.text) {
		try { json = JSON.parse(resp.text); } catch {
			throw new Error("出码接口返回了非 JSON");
		}
	}
	const parsed = parseFanqieQrStart(json);
	if (!parsed.ok) throw new Error(parsed.message);
	if (!parsed.qrDataUrl) throw new Error("未拿到二维码图片，请改用粘贴 Cookie");
	return { token: parsed.token, qrDataUrl: parsed.qrDataUrl, cookies };
}

export async function pollFanqieQr(pending: FanqieQrPending): Promise<{
	status: ReturnType<typeof parseFanqieQrPoll>["status"];
	cookies?: NamedCookie[];
}> {
	const resp = await requestUrl({
		url: fanqieQrPollUrl(pending.token),
		throw: false,
		headers: jsonHeaders(pending.cookies),
	});
	pending.cookies = mergeSetCookie(pending.cookies, setCookieOf(resp.headers as Record<string, unknown>));
	let json = resp.json as unknown;
	if (json == null && resp.text) {
		try { json = JSON.parse(resp.text); } catch { return { status: "waiting" }; }
	}
	const parsed = parseFanqieQrPoll(json);
	if (parsed.status === "captcha") throw new Error(parsed.message ?? "番茄要求人机校验，请改用粘贴 Cookie");
	if (parsed.status !== "success") return { status: parsed.status };
	const cookies = await followFanqieRedirect(pending.cookies, parsed.redirectUrl || HOME_URL);
	return { status: "success", cookies };
}

async function followFanqieRedirect(cookies: NamedCookie[], url: string): Promise<NamedCookie[]> {
	let jar = cookies;
	const seen = new Set<string>();
	for (const next of [url, HOME_URL]) {
		if (!next || seen.has(next)) continue;
		seen.add(next);
		try {
			const resp = await requestUrl({
				url: next,
				throw: false,
				headers: { ...jsonHeaders(jar), Accept: "text/html,application/json" },
			});
			jar = mergeSetCookie(jar, setCookieOf(resp.headers as Record<string, unknown>));
		} catch {
			/* 跟随跳转失败时仍用已有 cookie */
		}
	}
	if (!fanqieCookiesReady(jar)) throw new Error("扫码已确认，但未能建立会话，请改用粘贴 Cookie");
	return jar;
}

export async function writeFanqiePartitionCookies(cookies: NamedCookie[]): Promise<void> {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	if (!req) return;
	try {
		const electron = req("electron") as {
			remote?: {
				session: {
					fromPartition: (p: string) => {
						cookies: { set: (details: Record<string, unknown>) => Promise<void> };
					};
				};
			};
		};
		const ses = electron.remote?.session.fromPartition("persist:zread");
		if (!ses) return;
		for (const c of cookies) {
			await ses.cookies.set({
				url: HOME_URL,
				name: c.name,
				value: c.value,
				domain: ".fanqienovel.com",
				path: "/",
			});
		}
	} catch {
		/* 非桌面端或未暴露 electron */
	}
}

export async function fetchFanqieAccount(cookies: NamedCookie[]): Promise<string> {
	try {
		const json = asRecord(await fetchJson(USER_URL, { headers: jsonHeaders(cookies) }));
		const user = asRecord(json.data);
		const name = String(user.name ?? user.user_name ?? "").trim();
		if (name) return name;
	} catch {
		/* 用 cookie 兜底 */
	}
	const sid = cookies.find((c) => c.name === "sessionid")?.value ?? "";
	return sid ? `sid ${sid.slice(0, 8)}…` : "番茄小说";
}

async function fetchDetails(cookies: NamedCookie[], ids: string[]): Promise<unknown> {
	const csrf = fanqieCsrf(cookies);
	const headers = jsonHeaders(cookies, {
		"Content-Type": "application/json",
		...(csrf ? { "x-secsdk-csrf-token": csrf } : {}),
	});
	const detailList: unknown[] = [];
	for (let i = 0; i < ids.length; i += DETAIL_BATCH) {
		const chunk = ids.slice(i, i + DETAIL_BATCH);
		try {
			const json = asRecord(await fetchJson(DETAIL_URL, {
				method: "POST",
				headers,
				body: JSON.stringify({ books: chunk.map((book_id) => ({ book_id, item_id: "0" })) }),
			}));
			const data = asRecord(json.data);
			const rows = Array.isArray(data.detail_list) ? data.detail_list
				: Array.isArray(json.data) ? json.data as unknown[]
				: [];
			detailList.push(...rows);
		} catch {
			/* 详情失败时仍用书架 id 占位 */
		}
	}
	return { code: 0, data: { detail_list: detailList } };
}

async function fetchProgress(cookies: NamedCookie[]): Promise<unknown> {
	try {
		return await fetchJson(PROGRESS_URL, { headers: jsonHeaders(cookies) });
	} catch {
		return { code: 0, data: [] };
	}
}

export async function fetchFanqieBooks(cookies: NamedCookie[]): Promise<Book[]> {
	if (!fanqieCookiesReady(cookies)) return [];
	const shelf = await fetchJson(SHELF_URL, { headers: jsonHeaders(cookies) });
	const ids = fanqieShelfIds(shelf);
	if (!ids.length) return [];
	const details = await fetchDetails(cookies, ids);
	const progress = await fetchProgress(cookies);
	return fanqieToBooks({ shelf, details, progress });
}

export async function completeFanqieSession(cookies: NamedCookie[]): Promise<FanqieSession> {
	return { cookies, account: await fetchFanqieAccount(cookies) };
}

export { normalizeFanqieCookie, fanqieCookiesReady };
export type { NamedCookie };
