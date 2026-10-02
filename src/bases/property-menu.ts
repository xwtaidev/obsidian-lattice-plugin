/**
 * Keeps the built-in file properties out of the Bases property menu.
 *
 * The menu is core Bases' own. It lists every property the vault has — name,
 * path, folder, extension, size, backlinks, embeds, links, file tags — and no
 * API can trim that list; a view is handed the full set and can only decide
 * what it draws. Nothing about a note's own content changes that, which is why
 * the only way to keep them off the list is to act on the list itself.
 *
 * Two things make that possible without hard-coding a single translation: core
 * marks every item it built for a file property with `mod-implicit`, and the
 * label on each item is core's own `getDisplayName`. So the items to keep — the
 * two timestamps a board still wants — are identified by the name core gives
 * them, in whatever language the app is in, and everything else marked implicit
 * goes.
 *
 * Which menu an item belongs to is read off the item, not off the menu: the
 * class that names this menu is added to both the toolbar button and the menu
 * it opens, and the button comes first in the document, so looking the menu up
 * from the document either lands on the button (which holds no items) or has to
 * guess. Grouping the marked items by the popover they sit in has neither
 * problem. A menu without both timestamps in it is left alone, which is also
 * what keeps this off the sort and filter lists — they are built from different
 * items entirely.
 *
 * This is a patch over core UI, and it fails quietly by design: if a future
 * Obsidian renames the marker or the label, the menu simply goes back to
 * listing everything. Nothing errors, and nothing else breaks.
 */

const FILE_ITEM = '.bases-toolbar-menu-item.mod-implicit';
const ITEM_NAME = '.bases-toolbar-menu-item-name';
const MENU_ROOT = '.menu';
const HIDDEN_CLASS = 'lattice-hidden-property';

/**
 * Which of the names on screen to hide, or `null` for "leave it all alone".
 *
 * Every file property goes except the kept ones — but only once all of the
 * kept ones are actually there to be seen. A `.base` file may rename any
 * property through its `properties:` section, so a menu from a base that
 * renamed a timestamp would not contain that name at all, and hiding by name
 * would take the timestamps down with the path and the size. Redrawing that
 * line is the one outcome worse than the long list the user started with, so
 * when the names do not line up this reports nothing to hide.
 *
 * It doubles as the identity check on the menu: the menu that lists both
 * timestamps as file properties is the property menu, and no other list does.
 * That is why it is not enough to filter on a timestamp turning up somewhere —
 * a search that matches one of the two must not be taken for the whole list.
 */
export function labelsToHide(
	labels: readonly string[],
	kept: ReadonlySet<string>,
): Set<string> | null {
	if (kept.size === 0) {
		return null;
	}

	for (const label of kept) {
		if (!labels.includes(label)) {
			return null;
		}
	}

	return new Set(labels.filter((label) => !kept.has(label)));
}

export class PropertyMenuHider {
	private observer: MutationObserver | null = null;
	private queued = false;

	/** Names of the file properties to leave in the list. */
	private readonly kept = new Set<string>();

	/**
	 * The two timestamps, by the names core shows them under.
	 *
	 * A board has no use for a file's path or size, but it has one for when a
	 * note was created and when it last moved, so those two stay. The caller
	 * asks core for their labels rather than spelling them out — they follow
	 * the app's language, and a `.base` file can rename them.
	 */
	setKeptLabels(labels: readonly string[]): void {
		this.kept.clear();
		for (const label of labels) {
			this.kept.add(label);
		}
	}

	start(): void {
		if (this.observer !== null) {
			return;
		}

		this.observer = new MutationObserver(() => {
			this.schedule();
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;

		for (const item of Array.from(document.querySelectorAll(`.${HIDDEN_CLASS}`))) {
			item.classList.remove(HIDDEN_CLASS);
		}
	}

	/**
	 * At most one pass per frame.
	 *
	 * The menu is rebuilt from scratch on every keystroke in its search box,
	 * and the body this watches changes for a living. Neither is expensive on
	 * its own; together, without a brake, they are.
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

	private apply(): void {
		for (const items of this.groupItemsByMenu().values()) {
			const labels = items.map(
				(item) => item.querySelector(ITEM_NAME)?.textContent ?? '',
			);
			const hide = labelsToHide(labels, this.kept);
			if (hide === null) {
				continue;
			}

			items.forEach((item, index) => {
				item.classList.toggle(HIDDEN_CLASS, hide.has(labels[index] ?? ''));
			});
		}
	}

	/** The marked items, gathered under the popover each one sits in. */
	private groupItemsByMenu(): Map<Element, HTMLElement[]> {
		const groups = new Map<Element, HTMLElement[]>();

		for (const item of Array.from(
			document.querySelectorAll<HTMLElement>(FILE_ITEM),
		)) {
			const menu = item.closest(MENU_ROOT);
			if (menu === null) {
				continue;
			}

			const group = groups.get(menu);
			if (group === undefined) {
				groups.set(menu, [item]);
			} else {
				group.push(item);
			}
		}

		return groups;
	}
}
