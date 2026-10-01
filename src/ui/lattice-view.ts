import { ItemView, WorkspaceLeaf } from 'obsidian';
import { LATTICE_ICON, VIEW_TYPE_LATTICE } from '../constants';
import type LatticePlugin from '../main';

/**
 * The grid itself.
 *
 * The rendering here is deliberately a stub — it draws one empty cell per
 * configured column so the settings round-trip is visible on screen. Feature
 * work starts in `render()`.
 */
export class LatticeView extends ItemView {
	private readonly plugin: LatticePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: LatticePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LATTICE;
	}

	getDisplayText(): string {
		return 'Lattice';
	}

	getIcon(): string {
		return LATTICE_ICON;
	}

	async onOpen(): Promise<void> {
		this.contentEl.classList.add('lattice-view');
		this.render();
	}

	async onClose(): Promise<void> {
		// Obsidian detaches the leaf; this only clears what the view put in it.
		this.contentEl.empty();
	}

	/** Public so the plugin can re-render every open leaf after a settings change. */
	render(): void {
		const { contentEl } = this;
		contentEl.empty();

		// This view owns no data, so a bare grid of empty cells reads as
		// "broken" rather than "not built yet". Say which one it is — the board
		// lives in Bases, and nothing on screen would otherwise say so.
		contentEl.createEl('p', {
			cls: 'lattice-view-hint',
			text: 'Placeholder view. Lattice renders boards as a Bases view — open a .base file and choose Lattice from its view menu.',
		});

		const grid = contentEl.createDiv({ cls: 'lattice-grid' });
		grid.style.setProperty('--lattice-columns', String(this.plugin.settings.columns));

		for (let column = 0; column < this.plugin.settings.columns; column++) {
			grid.createDiv({ cls: 'lattice-cell' });
		}
	}
}
