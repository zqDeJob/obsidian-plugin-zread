import { App, TFile, normalizePath } from "obsidian";
import type { Book, Note, ZReadSettings } from "./model";
import { vaultPath } from "./model";
import { bookHeader, noteBlock, parseNotes } from "./notes-md";

export { bookHeader, noteBlock, parseNotes };

async function ensureFolder(app: App, folder: string): Promise<void> {
	const norm = normalizePath(folder);
	if (!norm) return;
	const parts = norm.split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) {
			await app.vault.createFolder(acc);
		}
	}
}

export async function writeNoteToVault(app: App, book: Book, settings: ZReadSettings, note: Note): Promise<string> {
	const path = normalizePath(vaultPath(book, settings));
	const folder = path.split("/").slice(0, -1).join("/");
	if (folder) await ensureFolder(app, folder);
	const existing = app.vault.getAbstractFileByPath(path);
	const block = noteBlock(note);
	if (existing instanceof TFile) {
		const cur = await app.vault.read(existing);
		const next = cur.includes("## 笔记")
			? `${cur.trimEnd()}\n\n${block}`
			: `${cur.trimEnd()}\n\n## 笔记\n\n${block}`;
		await app.vault.modify(existing, next);
	} else {
		await app.vault.create(path, `${bookHeader(book)}${block}`);
	}
	return path;
}

export async function loadNotesFromVault(app: App, book: Book, settings: ZReadSettings): Promise<Note[] | null> {
	const path = normalizePath(vaultPath(book, settings));
	const existing = app.vault.getAbstractFileByPath(path);
	if (!(existing instanceof TFile)) return null;
	const md = await app.vault.read(existing);
	return parseNotes(md);
}
