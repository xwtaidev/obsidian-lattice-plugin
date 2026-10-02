import { Plugin, WorkspaceLeaf } from 'obsidian';
import { PropertyMenuHider } from './bases/property-menu';
import { registerLatticeBasesView } from './bases/register';
import { registerCommands } from './commands';
import { LATTICE_ICON, VIEW_TYPE_LATTICE } from './constants';
import { DEFAULT_SETTINGS, LatticeSettingTab, type LatticeSettings } from './settings';
import { LatticeView } from './ui/lattice-view';

/**
 * Plugin lifecycle only.
 *
 * Anything that is not "register this with Obsidian, or tear it down" belongs
 * in its own module. `main.ts` staying short is the point — it is the file
 * every future change has to read.
 */
export default class LatticePlugin extends Plugin {
	settings: LatticeSettings = { ...DEFAULT_SETTINGS };

	/**
	 * Keeps core's property menu down to the properties a board deals in.
	 *
	 * It lives on the plugin rather than on a view because the menu belongs to
	 * the Bases toolbar, not to any one board: a view borrows it to say which
	 * properties to keep, and the same filter serves whichever board is open.
	 */
	readonly propertyMenu = new PropertyMenuHider();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.propertyMenu.start();
		this.register(() => this.propertyMenu.stop());

		this.registerView(VIEW_TYPE_LATTICE, (leaf: WorkspaceLeaf) => new LatticeView(leaf, this));

		registerLatticeBasesView(this);

		this.addRibbonIcon(LATTICE_ICON, 'Open lattice view', () => {
			void this.activateView();
		});

		registerCommands(this);
		this.addSettingTab(new LatticeSettingTab(this.app, this));
	}

	/**
	 * Reveal the grid, reusing an open leaf instead of stacking duplicates.
	 * Registered views are detached by Obsidian on unload, so there is nothing
	 * to do in `onunload`.
	 */
	async activateView(): Promise<void> {
		const [existing] = this.app.workspace.getLeavesOfType(VIEW_TYPE_LATTICE);
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_LATTICE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Re-render every open grid. Call after anything that changes settings. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LATTICE)) {
			const { view } = leaf;
			if (view instanceof LatticeView) {
				view.render();
			}
		}
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<LatticeSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
