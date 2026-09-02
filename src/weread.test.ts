import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cookieHeader, isApiKey, notebooksToBooks, parseCookieHeader, wereadReaderUrl } from "./weread-map.ts";

describe("weread mapping", () => {
	it("parses cookie header and API key tokens", () => {
		const cookies = parseCookieHeader("wr_skey=abc; wr_vid=123");
		assert.equal(cookieHeader(cookies), "wr_skey=abc; wr_vid=123");
		assert.equal(isApiKey("wrk-xxxx"), true);
		assert.equal(parseCookieHeader("dTKWBcGl")[0]?.name, "wr_skey");
	});

	it("maps notebook list to shelf books without body text", () => {
		const books = notebooksToBooks({
			books: [{
				sort: 1756627200,
				noteCount: 4,
				reviewCount: 2,
				book: {
					bookId: "3300022341",
					title: "置身事内",
					author: "兰小欢",
					url: "https://weread.qq.com/web/reader/abc",
					cover: "https://cdn.weread.qq.com/cover/s_abc.jpg",
				},
			}],
		});
		assert.equal(books.length, 1);
		assert.equal(books[0]?.id, "weread:3300022341");
		assert.equal(books[0]?.source, "weread");
		assert.equal(books[0]?.title, "置身事内");
		assert.equal(books[0]?.text, "");
		assert.equal(books[0]?.webUrl, "https://weread.qq.com/web/reader/abc");
		assert.equal(books[0]?.lastRead, "2025-08-31");
		assert.equal(books[0]?.cover, "https://cdn.weread.qq.com/cover/t7_abc.jpg");
		assert.equal(books[0]?.kind, "book");
		assert.equal(books[0]?.markCount, 4);
		assert.equal(books[0]?.reviewCount, 2);
	});

	it("encodes weread reader urls instead of raw bookId", () => {
		assert.equal(wereadReaderUrl("651358"), "https://weread.qq.com/web/reader/9f832d8059f05e9f8657f05");
		assert.match(wereadReaderUrl("37335991"), /^https:\/\/weread\.qq\.com\/web\/reader\//);
		assert.equal(wereadReaderUrl("37335991").endsWith("/37335991"), false);
		const noUrl = notebooksToBooks({
			books: [{ book: { bookId: "651358", title: "中国哲学简史", author: "冯友兰", cover: "https://cdn.weread.qq.com/weread/cover/24/YueWen_651358/s_YueWen_651358.jpg" } }],
		})[0];
		assert.equal(noUrl?.webUrl, "https://weread.qq.com/web/reader/9f832d8059f05e9f8657f05");
		assert.equal(noUrl?.cover, "https://cdn.weread.qq.com/weread/cover/24/YueWen_651358/t7_YueWen_651358.jpg");
	});
});
