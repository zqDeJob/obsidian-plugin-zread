import { Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, FOLDER_PRESETS, VIEW_TYPE, vaultPath, type SubfolderMode } from "./model";
import { ReadStore } from "./store";
import { ZReadView } from "./view";

export default class ZReadPlugin extends Plugin {
	store!: ReadStore;

	async onload(): Promise<void> {
		this.store = new ReadStore(
			() => this.loadData(),
			(data) => this.saveData(data),
		);
		await this.store.loadAll();

		this.registerView(VIEW_TYPE, (leaf) => new ZReadView(leaf, this));

		this.addRibbonIcon("book-open", "打开 Z-Read 书架", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-z-read",
			name: "打开书架",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "import-local-book",
			name: "导入本地书籍",
			callback: () => {
				void this.activateView().then((view) => view?.openImport());
			},
		});

		this.addSettingTab(new ZReadSettingTab(this));
	}

	async activateView(): Promise<ZReadView | null> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (existing) {
			workspace.revealLeaf(existing);
			return existing.view instanceof ZReadView ? existing.view : null;
		}
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
		return leaf.view instanceof ZReadView ? leaf.view : null;
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ZReadView) void view.refresh();
		}
	}
}

class ZReadSettingTab extends PluginSettingTab {
	plugin: ZReadPlugin;

	constructor(plugin: ZReadPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.store.settings;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Z-Read" });
		containerEl.createEl("p", {
			text: "笔记落在 Vault 里，路径相对库根目录。书城与绑定在插件面板里操作。",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Vault 目录")
			.setDesc("所有渠道的统一笔记都写到这里。")
			.addText((text) => {
				text.setPlaceholder("Z-Read/笔记")
					.setValue(settings.notesFolder)
					.onChange((value) => {
						void this.saveKey("notesFolder", value.trim() || DEFAULT_SETTINGS.notesFolder);
					});
			})
			.addDropdown((drop) => {
				drop.addOption("", "常用目录…");
				for (const p of FOLDER_PRESETS) drop.addOption(p, p);
				drop.setValue(FOLDER_PRESETS.includes(settings.notesFolder) ? settings.notesFolder : "");
				drop.onChange((value) => {
					if (!value) return;
					void this.saveKey("notesFolder", value);
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("文件名模板")
			.setDesc("可用 {{title}}、{{author}}、{{source}}。")
			.addText((text) => {
				text.setPlaceholder("{{title}}")
					.setValue(settings.fileName)
					.onChange((value) => {
						void this.saveKey("fileName", value.trim() || "{{title}}");
					});
			});

		new Setting(containerEl)
			.setName("子文件夹")
			.setDesc("按来源或书名再分一层。")
			.addDropdown((drop) => {
				drop.addOption("none", "不分，全在笔记目录");
				drop.addOption("source", "按来源");
				drop.addOption("book", "按书名建子文件夹");
				drop.setValue(settings.subfolder);
				drop.onChange((value) => {
					void this.saveKey("subfolder", value as SubfolderMode);
				});
			});

		const sample = this.plugin.store.books[0] ?? {
			id: "demo", source: "weread", title: "置身事内", author: "兰小欢",
			progress: 0, lastRead: "", chapters: [], text: "", highlights: [], notes: [],
		};
		containerEl.createEl("p", { text: "当前会写成", cls: "setting-item-description" });
		containerEl.createEl("code", { text: vaultPath(sample, settings) });

		new Setting(containerEl)
			.setName("同步当日划线到日记")
			.setDesc("开关先记下；写入 Daily Notes 区间会在后续版本接上。")
			.addToggle((toggle) => {
				toggle.setValue(settings.dailyNotes).onChange((value) => {
					void this.saveKey("dailyNotes", value);
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("日记目录")
			.setDesc("相对 Vault 的 Daily Notes 路径。")
			.addText((text) => {
				text.setPlaceholder("07-日记")
					.setValue(settings.dailyFolder)
					.setDisabled(!settings.dailyNotes)
					.onChange((value) => {
						void this.saveKey("dailyFolder", value.trim() || DEFAULT_SETTINGS.dailyFolder);
					});
			});

		containerEl.createEl("p", {
			text: Platform.isDesktopApp
				? "桌面端可在阅读器里尝试内嵌原站；移动端请用系统浏览器打开书城入口。"
				: "当前不是桌面端，原站阅读会改为在浏览器打开。",
			cls: "setting-item-description",
		});
	}

	private async saveKey<K extends keyof typeof DEFAULT_SETTINGS>(
		key: K,
		value: (typeof DEFAULT_SETTINGS)[K],
	): Promise<void> {
		this.plugin.store.settings[key] = value;
		await this.plugin.store.persist();
		this.plugin.refreshViews();
	}
}
