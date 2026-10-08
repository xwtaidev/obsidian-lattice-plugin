import { App, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_BOARD_FILE } from './constants';
import type LatticePlugin from './main';

/**
 * Everything the plugin persists, in one place.
 *
 * Settings written by `saveData` are plain JSON, so keep this interface to
 * primitives and arrays, and give every field a default in `DEFAULT_SETTINGS` —
 * a vault upgrading from an older version only has the fields it saved, and
 * `Object.assign` against the defaults is what fills the rest in.
 */
export interface LatticeSettings {
	/**
	 * The `.base` file the plugin's icon opens, as a path from the vault root.
	 *
	 * A board is a Bases view and a Bases view lives in a `.base` file, so
	 * there is no board to open without one. Which file is a choice — a vault
	 * can hold several `.base` files, and this picks the one the icon is for.
	 */
	boardFile: string;
}

export const DEFAULT_SETTINGS: LatticeSettings = {
	boardFile: DEFAULT_BOARD_FILE,
};

/**
 * The settings tab, written with the imperative API so the plugin keeps loading
 * on older versions.
 *
 * Obsidian 1.13 added a declarative API (`getSettingDefinitions`) that also
 * surfaces settings in Obsidian's own settings search. Adopting it would raise
 * `minAppVersion` to 1.13.0, which is a high price for a search entry — revisit
 * once the plugin has a settings surface worth searching (eslint will keep
 * warning until then).
 */
export class LatticeSettingTab extends PluginSettingTab {
	private readonly plugin: LatticePlugin;

	constructor(app: App, plugin: LatticePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Board file')
			.setDesc(
				'The .base file the Lattice icon opens. It is kept out of the file explorer. A path with no file yet gets a blank board the next time the plugin loads.',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.boardFile)
					.setValue(this.plugin.settings.boardFile)
					.onChange(async (value) => {
						const path = value.trim();
						// An empty box means "still typing", not "no board": the
						// placeholder names the file the plugin ships with.
						this.plugin.settings.boardFile =
							path.length > 0 ? path : DEFAULT_SETTINGS.boardFile;
						await this.plugin.saveSettings();
						// Which file is kept out of the file explorer is part of
						// this setting, so it is re-applied with it.
						this.plugin.applyBoardFileVisibility();
					}),
			);
	}
}
