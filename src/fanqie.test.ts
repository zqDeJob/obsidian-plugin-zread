import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	fanqieCookiesReady,
	fanqiePageUrl,
	fanqieQrPollUrl,
	fanqieQrcodeUrl,
	fanqieReaderUrl,
	fanqieToBooks,
	mergeSetCookie,
	normalizeFanqieCookie,
	parseFanqieQrPoll,
	parseFanqieQrStart,
} from "./fanqie-map.ts";

describe("fanqie mapping", () => {
	it("treats a bare token as sessionid", () => {
		const cookies = normalizeFanqieCookie("abc123session");
		assert.equal(cookies[0]?.name, "sessionid");
		assert.equal(cookies[0]?.value, "abc123session");
		assert.equal(fanqieCookiesReady(cookies), true);
		assert.equal(fanqieCookiesReady([]), false);
	});

	it("builds the official book page url", () => {
		assert.equal(fanqiePageUrl("69833615430"), "https://fanqienovel.com/page/69833615430");
		assert.equal(fanqieReaderUrl("7386518026868228670"), "https://fanqienovel.com/reader/7386518026868228670?enter_from=page");
	});

	it("maps shelf + detail to books without body text", () => {
		const books = fanqieToBooks({
			shelf: {
				code: 0,
				data: {
					book_shelf_info: [{
						book_id: "69833615430",
						last_operate_time: 1756627200,
						add_shelf_time: 1711197150,
						group_name: "在读",
					}],
				},
			},
			details: {
				code: 0,
				data: {
					detail_list: [{
						book_id: "69833615430",
						book_name: "大奉打更人",
						author: "卖报小郎君",
						thumb_url: "https://p6-novel.byteimg.com/cover.jpg",
						serial_count: 1200,
						creation_status: "1",
					}],
				},
			},
			progress: {
				code: 0,
				data: [{ book_id: "69833615430", index: 120, read_timestamp: 1756627200 }],
			},
		});
		assert.equal(books.length, 1);
		assert.equal(books[0]?.id, "fanqie:69833615430");
		assert.equal(books[0]?.source, "fanqie");
		assert.equal(books[0]?.title, "大奉打更人");
		assert.equal(books[0]?.author, "卖报小郎君");
		assert.equal(books[0]?.text, "");
		assert.equal(books[0]?.webUrl, "https://fanqienovel.com/page/69833615430");
		assert.equal(books[0]?.cover, "https://p6-novel.byteimg.com/cover.jpg");
		assert.equal(books[0]?.lastRead, "2025-08-31");
		assert.equal(books[0]?.progress, 10);
		assert.equal(books[0]?.kind, "book");
		assert.equal(books[0]?.group, "在读");
	});

	it("skips shelf rows without book_id and still emits a stub title when detail is missing", () => {
		const books = fanqieToBooks({
			shelf: {
				data: {
					book_shelf_info: [
						{ book_id: "" },
						{ book_id: "111" },
					],
				},
			},
			details: { data: { detail_list: [] } },
			progress: { data: [] },
		});
		assert.equal(books.length, 1);
		assert.equal(books[0]?.id, "fanqie:111");
		assert.equal(books[0]?.title, "番茄书 111");
		assert.equal(books[0]?.text, "");
		assert.equal(books[0]?.group, undefined);
	});

	it("opens the web reader when progress has an item id", () => {
		const books = fanqieToBooks({
			shelf: { data: { book_shelf_info: [{ book_id: "111" }] } },
			details: { data: { detail_list: [{ book_id: "111", book_name: "甲" }] } },
			progress: { data: [{ book_id: "111", item_id: "222", index: 0 }] },
		});
		assert.equal(books[0]?.webUrl, "https://fanqienovel.com/reader/222?enter_from=page");
	});
});

describe("fanqie passport qr", () => {
	it("asks passport for a QR with aid 2503, not the bookshelf aid 1967", () => {
		const url = fanqieQrcodeUrl();
		assert.match(url, /^https:\/\/fanqienovel\.com\/passport\/web\/get_qrcode\//);
		assert.match(url, /[?&]aid=2503(?:&|$)/);
		assert.equal(/[?&]aid=1967(?:&|$)/.test(url), false);
		assert.match(url, /[?&]next=https%3A%2F%2Ffanqienovel\.com%2F/);
		assert.match(fanqieQrPollUrl("tok_abc"), /[?&]token=tok_abc/);
		assert.match(fanqieQrPollUrl("tok_abc"), /\/passport\/web\/check_qrconnect\//);
	});

	it("parses the QR image and token from a successful passport response", () => {
		const parsed = parseFanqieQrStart({
			data: {
				error_code: 0,
				token: "qr-token",
				qrcode: "iVBOR",
				qrcode_index_url: "https://reading.snssdk.com/scan",
				expire_time: 1788232731,
			},
			message: "success",
		});
		assert.equal(parsed.ok, true);
		if (!parsed.ok) return;
		assert.equal(parsed.token, "qr-token");
		assert.equal(parsed.qrDataUrl, "data:image/png;base64,iVBOR");
	});

	it("tells the UI to fall back to cookie paste when passport asks for captcha", () => {
		const parsed = parseFanqieQrStart({
			data: { captcha: "1", error_code: 0 },
		});
		assert.equal(parsed.ok, false);
		if (parsed.ok) return;
		assert.equal(parsed.reason, "captcha");
	});

	it("maps poll status from waiting to confirmed redirect", () => {
		assert.equal(parseFanqieQrPoll({ data: { status: "new" } }).status, "waiting");
		assert.equal(parseFanqieQrPoll({ data: { status: "scanned" } }).status, "scanned");
		const done = parseFanqieQrPoll({
			data: { status: "confirmed", redirect_url: "https://fanqienovel.com/?ticket=1" },
		});
		assert.equal(done.status, "success");
		assert.equal(done.redirectUrl, "https://fanqienovel.com/?ticket=1");
	});

	it("keeps sessionid from Set-Cookie headers", () => {
		const cookies = mergeSetCookie([], "sessionid=abc123; Path=/; Domain=.fanqienovel.com, passport_csrf_token=tok; Path=/");
		assert.equal(fanqieCookiesReady(cookies), true);
		assert.equal(cookies.find((c) => c.name === "sessionid")?.value, "abc123");
		assert.equal(cookies.find((c) => c.name === "passport_csrf_token")?.value, "tok");
	});

	it("accepts Set-Cookie as an array from requestUrl headers", () => {
		const cookies = mergeSetCookie([], [
			"sessionid=abc123; Path=/; Domain=.fanqienovel.com",
			"passport_csrf_token=tok; Path=/",
		]);
		assert.equal(fanqieCookiesReady(cookies), true);
		assert.equal(cookies.find((c) => c.name === "sessionid")?.value, "abc123");
		assert.equal(cookies.find((c) => c.name === "passport_csrf_token")?.value, "tok");
	});
});
