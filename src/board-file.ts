/**
 * The board's own `.base` file, kept out of the file explorer.
 *
 * A board is a Bases view, and a Bases view lives in a `.base` file — there is
 * no way to register a view that has no file behind it. So the file exists, the
 * file explorer lists it, and there it is wrong: it reads as a document to open
 * when it is really the app's own screen, and the app already has a door for
 * that — the ribbon icon, which opens it whatever it is called and wherever it
 * lives.
 *
 * Nothing core offers hides one file from the tree. Obsidian's "excluded files"
 * do not: they keep a file out of search, the quick switcher, the graph and the
 * backlinks, and the file explorer is not on that list. A stylesheet cannot
 * name the row on its own either, because the rule would need the path and only
 * the row knows it. So a stylesheet holds the hiding and this decides which row
 * wears the class — which is the shape `property-menu.ts` uses, for the same
 * reason, and fails the same quiet way: if Obsidian renames the class, the file
 * simply shows up again. Nothing errors, and the icon still opens it.
 */

/** Where the file explorer keeps its rows. */
const TREE_CONTAINER = '.nav-files-container';

/** A note's row, and the title inside it that carries the path. */
const TREE_ROW = '.nav-file';
const TREE_TITLE = '.nav-file-title';

/**
 * Every note row under the tree. Scoped to the container because `.nav-file`
 * and `.nav-file-title` are core's names for a note in any tree, and the file
 * explorer's is the only one listing this plugin's file.
 */
const TREE_TITLES = `${TREE_CONTAINER} ${TREE_TITLE}`;

/** Marks the row of the board's file; styles.css takes it out of the list. */
export const HIDDEN_FILE_CLASS = 'lattice-hidden-file';

/**
 * Whether a batch of mutations could have added a row to the tree.
 *
 * The body this watches changes for a living — a card being drawn, a
 * description arriving, a keystroke in another pane — and the file explorer
 * rebuilds its rows on every change to the vault. Only a new row is worth a
 * pass over the tree, so the rest is dropped here rather than one frame later.
 */
function addsTreeRow(records: readonly MutationRecord[]): boolean {
	for (const record of records) {
		for (const node of Array.from(record.addedNodes)) {
			if (!node.instanceOf(Element)) {
				continue;
			}

			if (node.matches(TREE_TITLE) || node.querySelector(TREE_TITLE) !== null) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Keeps one file out of the file explorer's tree.
 *
 * One path at a time: a board is the plugin's idea of the file it belongs to,
 * and the plugin has exactly one.
 */
export class BoardFileHider {
	private observer: MutationObserver | null = null;
	private queued = false;
	private path = '';

	/**
	 * Watch the tree, and mark what is in it now.
	 *
	 * The pass on start is not optional. A plugin is loaded into an app that is
	 * already running, so the file explorer is usually drawn before this ever
	 * sees a mutation, and waiting for one means the row is wrong until the
	 * next change to the vault.
	 */
	start(): void {
		if (this.observer !== null) {
			return;
		}

		this.observer = new MutationObserver((records) => {
			if (addsTreeRow(records)) {
				this.schedule();
			}
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
		this.apply();
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;

		for (const row of Array.from(document.querySelectorAll(`.${HIDDEN_FILE_CLASS}`))) {
			row.classList.remove(HIDDEN_FILE_CLASS);
		}
	}

	/** Keep this path out of the tree. An empty path keeps every file in it. */
	hide(path: string): void {
		this.path = path;
		this.apply();
	}

	/**
	 * At most one pass per frame.
	 *
	 * The tree is rebuilt in a burst when a folder is opened, and each of those
	 * batches would otherwise be a pass of its own over every row on screen.
	 */
	private schedule(): void {
		if (this.queued) {
			return;
		}

		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			this.apply();
		});
	}

	/**
	 * Mark the row for the path, and unmark every other.
	 *
	 * Unmarking is not tidiness. The tree reuses its rows, so the element that
	 * stood for this file can be put back into service for another one, and a
	 * class left on it would hide a note the user did not ask to lose.
	 */
	private apply(): void {
		const path = this.path;
		for (const title of Array.from(document.querySelectorAll<HTMLElement>(TREE_TITLES))) {
			const row = title.closest(TREE_ROW);
			row?.classList.toggle(
				HIDDEN_FILE_CLASS,
				path.length > 0 && title.dataset['path'] === path,
			);
		}
	}
}
