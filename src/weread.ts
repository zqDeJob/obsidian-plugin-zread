import { Notice, Platform, arrayBufferToBase64, requestUrl } from "obsidian";
import type { Book } from "./model";
import { cookieHeader, notebooksToBooks, parseCookieHeader, type NamedCookie } from "./weread-map";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";
const LOGIN_URL = "https://weread.qq.com/#login";
const NOTEBOOK_URL = "https://weread.qq.com/api/user/notebook";
const APIKEY_URL = "https://weread.qq.com/api/skills/apikeyGet";
const GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";

export interface WereadSession {
	cookies: NamedCookie[];
	apiKey: string;
	account: string;
}

function jsonHeaders(cookies: NamedCookie[]): Record<string, string> {
	const headers: Record<string, string> = {
		"User-Agent": UA,
		Accept: "application/json, text/plain, */*",
		"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
	};
	const cookie = cookieHeader(cookies);
	if (cookie) headers.Cookie = cookie;
	return headers;
}

export async function fetchCoverDataUrl(url: string): Promise<string> {
	const candidates = [url];
	if (url.includes("/t7_")) candidates.push(url.replace("/t7_", "/s_"));
	for (const candidate of candidates) {
		try {
			const resp = await requestUrl({
				url: candidate,
				throw: false,
				headers: {
					"User-Agent": UA,
					Referer: /byteimg\.com|fanqienovel\.com/i.test(candidate) ? "https://fanqienovel.com/" : "https://weread.qq.com/",
					Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
				},
			});
			if (resp.status !== 200 || !resp.arrayBuffer?.byteLength) continue;
			const mime = String(resp.headers["content-type"] ?? "image/jpeg").split(";")[0] || "image/jpeg";
			if (!mime.startsWith("image/")) continue;
			return `data:${mime};base64,${arrayBufferToBase64(resp.arrayBuffer)}`;
		} catch {
			/* 下一张候选 */
		}
	}
	return "";
}

function accountOf(cookies: NamedCookie[], apiKey: string): string {
	const name = cookies.find((c) => c.name === "wr_name")?.value;
	const vid = cookies.find((c) => c.name === "wr_vid")?.value;
	if (name) return name;
	if (vid) return `vid ${vid}`;
	if (apiKey) return apiKey.slice(0, 12) + "…";
	return "微信读书";
}

function cookiesReady(cookies: NamedCookie[]): boolean {
	const vid = cookies.find((c) => c.name === "wr_vid")?.value;
	const skey = cookies.find((c) => c.name === "wr_skey")?.value;
	const name = cookies.find((c) => c.name === "wr_name")?.value;
	return Boolean(vid && (skey || name));
}

function getRemote(): {
	BrowserWindow: new (opts: Record<string, unknown>) => ElectronLoginWin;
	getCurrentWindow: () => unknown;
} | null {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	if (!req) return null;
	try {
		const electron = req("electron") as { remote?: { BrowserWindow: new (opts: Record<string, unknown>) => ElectronLoginWin; getCurrentWindow: () => unknown }; BrowserWindow?: new (opts: Record<string, unknown>) => ElectronLoginWin };
		const remote = electron.remote;
		if (remote?.BrowserWindow) return remote;
	} catch {
		/* Obsidian 未暴露 electron */
	}
	return null;
}

interface ElectronLoginWin {
	once: (ev: string, fn: () => void) => void;
	on: (ev: string, fn: () => void) => void;
	show: () => void;
	close: () => void;
	setTitle: (t: string) => void;
	loadURL: (url: string) => Promise<void>;
	reload: () => void;
	isDestroyed: () => boolean;
	webContents: {
		session: {
			cookies: { get: (filter: { domain: string }) => Promise<{ name: string; value: string }[]> };
			webRequest: {
				onCompleted: (filter: { urls: string[] }, cb: (details: { statusCode: number }) => void) => void;
				onSendHeaders: (filter: { urls: string[] }, cb: (details: { requestHeaders: Record<string, string> }) => void) => void;
			};
		};
		on: (ev: string, fn: () => void) => void;
	};
}

async function readSessionCookies(win: ElectronLoginWin): Promise<NamedCookie[]> {
	const store = win.webContents.session.cookies;
	const rows = [
		...(await store.get({ domain: ".weread.qq.com" })),
		...(await store.get({ domain: "weread.qq.com" })),
	];
	const unique = new Map<string, NamedCookie>();
	for (const row of rows) {
		let name = row.name;
		let value = row.value;
		try { name = decodeURIComponent(name); } catch { /* keep */ }
		try { value = decodeURIComponent(value); } catch { /* keep */ }
		if (!unique.has(name)) unique.set(name, { name, value });
	}
	return Array.from(unique.values());
}

export function loginWereadWindow(): Promise<NamedCookie[]> {
	const remote = getRemote();
	if (!remote) return Promise.reject(new Error("当前不是桌面端，无法弹出微信读书登录窗"));

	return new Promise((resolve, reject) => {
		const modal = new remote.BrowserWindow({
			parent: remote.getCurrentWindow(),
			width: 960,
			height: 540,
			show: false,
			webPreferences: {
				partition: "persist:zread",
				nodeIntegration: false,
				contextIsolation: true,
			},
		});

		let settled = false;
		const succeed = (cookies: NamedCookie[]) => {
			if (settled) return;
			settled = true;
			try {
				if (!modal.isDestroyed()) modal.close();
			} catch { /* 窗口已关 */ }
			resolve(cookies);
		};
		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			try {
				if (!modal.isDestroyed()) modal.close();
			} catch { /* 窗口已关 */ }
			reject(err);
		};

		const mergeCookies = (base: NamedCookie[], extra?: string): NamedCookie[] => {
			if (!extra) return base;
			const map = new Map(base.map((c) => [c.name, c]));
			for (const c of parseCookieHeader(extra)) map.set(c.name, c);
			return Array.from(map.values());
		};

		const trySync = async (headerCookie?: string) => {
			if (settled || modal.isDestroyed()) return;
			try {
				const cookies = mergeCookies(await readSessionCookies(modal), headerCookie);
				if (!cookiesReady(cookies)) return;
				succeed(cookies);
			} catch {
				/* 窗口可能已销毁，等 closed 收尾 */
			}
		};

		modal.once("ready-to-show", () => {
			modal.setTitle("登录微信读书");
			modal.show();
		});
		modal.on("closed", () => {
			fail(new Error("已关闭登录窗口"));
		});

		const session = modal.webContents.session;
		session.webRequest.onCompleted({ urls: ["https://weread.qq.com/api/auth/getLoginInfo?uid=*"] }, (details) => {
			if (details.statusCode === 200) {
				void modal.loadURL("https://weread.qq.com/web/shelf").then(() => void trySync());
			}
		});
		session.webRequest.onSendHeaders({ urls: ["https://weread.qq.com/web/user?userVid=*"] }, (details) => {
			const headers = details.requestHeaders || {};
			const cookie = headers.Cookie || headers.cookie;
			void trySync(cookie);
		});
		modal.webContents.on("did-navigate", () => { void trySync(); });
		modal.webContents.on("did-navigate-in-page", () => { void trySync(); });
		modal.webContents.on("did-finish-load", () => { void trySync(); });

		void modal.loadURL(LOGIN_URL).catch((e: unknown) => {
			fail(e instanceof Error ? e : new Error("加载登录页失败"));
		});
	});
}

export async function fetchApiKey(cookies: NamedCookie[]): Promise<string> {
	try {
		const resp = await requestUrl({
			url: APIKEY_URL,
			method: "GET",
			headers: jsonHeaders(cookies),
		});
		const key = (resp.json as { apikey?: string } | undefined)?.apikey;
		return key ?? "";
	} catch {
		return "";
	}
}

export async function fetchWereadNotebooks(session: WereadSession): Promise<Book[]> {
	if (session.apiKey) {
		try {
			const resp = await requestUrl({
				url: GATEWAY_URL,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${session.apiKey}`,
				},
				body: JSON.stringify({ api_name: "/user/notebooks", skill_version: "1.0.3", count: 300 }),
			});
			const json = resp.json as { books?: unknown; errcode?: number } | undefined;
			if (json && (json.errcode === undefined || json.errcode === 0) && json.books) {
				const mapped = notebooksToBooks(json);
				if (mapped.length) return mapped;
			}
		} catch {
			/* 回退 Cookie */
		}
		try {
			const shelf = await requestUrl({
				url: GATEWAY_URL,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${session.apiKey}`,
				},
				body: JSON.stringify({ api_name: "/_list", skill_version: "1.0.3" }),
			});
			const mapped = notebooksToBooks(shelf.json);
			if (mapped.length) return mapped;
		} catch {
			/* 回退 Cookie */
		}
	}
	if (!session.cookies.length) return [];
	const resp = await requestUrl({
		url: NOTEBOOK_URL,
		method: "GET",
		headers: jsonHeaders(session.cookies),
	});
	if (resp.status === 401) throw new Error("微信读书登录已失效，请重新扫码");
	return notebooksToBooks(resp.json);
}

export async function completeWereadSession(cookies: NamedCookie[], apiKey = ""): Promise<WereadSession> {
	const fromCookies = cookies.find((c) => c.name === "apikey")?.value ?? "";
	const rest = cookies.filter((c) => c.name !== "apikey");
	const key = apiKey || fromCookies || (rest.length ? await fetchApiKey(rest) : "");
	return {
		cookies: rest,
		apiKey: key,
		account: accountOf(rest, key),
	};
}

export async function loginWeread(): Promise<WereadSession> {
	if (!Platform.isDesktopApp) throw new Error("扫码登录只支持桌面端，请改用粘贴 API Key / Cookie");
	new Notice("请在弹出窗口里用微信扫码登录微信读书");
	const cookies = await loginWereadWindow();
	if (!cookiesReady(cookies)) throw new Error("未拿到登录 Cookie");
	return completeWereadSession(cookies);
}
