import { Notice, Plugin, TFile } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { PropertyMenuHider } from './bases/property-menu';
import { registerLatticeBasesView } from './bases/register';
import { BoardViewAdder } from './bases/view-menu';
import { BoardFileHider } from './board-file';
import { registerCommands } from './commands';
import { LATTICE_ICON } from './constants';
import { DEFAULT_SETTINGS, LatticeSettingTab, type LatticeSettings } from './settings';

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

	/**
	 * Makes core's "Add view" add a board, as long as a board is on screen.
	 *
	 * Also on the plugin, and for the same reason: the view list belongs to the
	 * `.base` file rather than to any one view of it, and the board that hands
	 * over its config is only the one that happens to be open.
	 */
	readonly viewMenu = new BoardViewAdder();

	/**
	 * Keeps the board's own `.base` file out of the file explorer.
	 *
	 * The board is a file Obsidian has to be able to open, but it is not a
	 * document to browse for — the icon opens it, whatever it is called. On the
	 * plugin because it follows a setting, not a view, and outlives every one
	 * of them.
	 */
	readonly boardFile = new BoardFileHider();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.propertyMenu.start();
		this.register(() => this.propertyMenu.stop());

		this.viewMenu.start();
		this.register(() => this.viewMenu.stop());

		this.boardFile.start();
		this.register(() => this.boardFile.stop());

		registerLatticeBasesView(this);

		this.applyBoardFileVisibility();

		this.addRibbonIcon(LATTICE_ICON, 'Open board', () => {
			void this.openBoard();
		});

		registerCommands(this);
		this.addSettingTab(new LatticeSettingTab(this.app, this));
	}

	/** Match the file explorer to the board file the settings name. */
	applyBoardFileVisibility(): void {
		this.boardFile.hide(this.settings.boardFile.trim());
	}

	/**
	 * Open the board: the `.base` file the settings name.
	 *
	 * The icon stands in for that file, so this is the whole of how a board is
	 * reached — it is why the file is kept out of the file explorer, and why
	 * this says so plainly when the setting points at nothing.
	 *
	 * A leaf already showing the file is revealed instead of a second one being
	 * opened: the icon means "show me the board", and the board already being
	 * on screen is the app answering that.
	 */
	async openBoard(): Promise<void> {
		const path = this.settings.boardFile.trim();
		if (path.length === 0) {
			new Notice('Lattice: no board file is set. Name one in the plugin settings.');
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`Lattice: no file at "${path}" to open as a board.`);
			return;
		}

		const open = this.leafShowing(path);
		if (open !== null) {
			await this.app.workspace.revealLeaf(open);
			return;
		}

		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file);
	}

	/**
	 * The leaf already showing a file, if one is.
	 *
	 * Asked of what each leaf is displaying rather than looked up by view type:
	 * a `.base` file is only ever shown by core's Bases view, so the path is
	 * enough, and this does not depend on the name core registered it under.
	 */
	private leafShowing(path: string): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found === null && (leaf.view as { file?: TFile | null }).file?.path === path) {
				found = leaf;
			}
		});

		return found;
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<LatticeSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
