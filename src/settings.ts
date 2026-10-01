import { App, PluginSettingTab, Setting } from 'obsidian';
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
	/** How many columns the grid uses. */
	columns: number;
}

export const DEFAULT_SETTINGS: LatticeSettings = {
	columns: 3,
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
			.setName('Columns')
			.setDesc('How many columns the grid uses.')
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.columns))
					.setValue(String(this.plugin.settings.columns))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						// Reject rather than coerce: an empty box means "still typing",
						// not "zero columns".
						if (!Number.isFinite(parsed) || parsed < 1) {
							return;
						}
						this.plugin.settings.columns = parsed;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);
	}
}
