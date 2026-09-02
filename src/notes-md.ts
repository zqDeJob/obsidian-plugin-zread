import type { Book, Note } from "./model";

export function noteBlock(note: Note): string {
	const meta = [note.at, note.chapter, note.from].filter(Boolean).join(" · ");
	return `### ${meta}\n\n${note.text.trim()}\n`;
}

export function bookHeader(book: Book): string {
	return `---
zread: true
title: ${yamlStr(book.title)}
author: ${yamlStr(book.author)}
source: ${yamlStr(book.source)}
bookId: ${yamlStr(book.id)}
---

# ${book.title}

> 来源：${book.source} · 作者：${book.author}

## 笔记

`;
}

function yamlStr(s: string): string {
	return JSON.stringify(s ?? "");
}

export function parseNotes(markdown: string): Note[] {
	const section = markdown.split(/^## 笔记\s*$/m)[1] ?? markdown;
	const chunks = section.split(/^### /m).slice(1);
	const notes: Note[] = [];
	for (const chunk of chunks) {
		const nl = chunk.indexOf("\n");
		const head = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
		const body = (nl === -1 ? "" : chunk.slice(nl)).trim();
		if (!body) continue;
		const parts = head.split(" · ").map((p) => p.trim());
		const at = parts.find((p) => /^\d{4}-\d{2}-\d{2}/.test(p)) ?? "";
		const from = parts.find((p) => p === "手写" || p === "划线") ?? "手写";
		const chapter = parts.find((p) => p !== at && p !== from) ?? "";
		notes.push({
			id: `n-file-${notes.length}-${head.slice(0, 12)}`,
			text: body,
			chapter,
			at,
			from,
		});
	}
	return notes;
}
