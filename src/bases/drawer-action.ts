/**
 * The button a preview in the sidebar offers: open the note it is showing as a
 * page of its own.
 *
 * A card click opens the note in the right sidebar, which is where a board's
 * rows are meant to be read from — the board stays put and the drawer collapses
 * — but a note in the sidebar has no way out of it: it is shown with its header
 * hidden, so Obsidian draws no title bar there and neither the bookmark nor the
 * reading-mode toggle is on screen, let alone anything that moves the note into
 * the main area. Dragging the tab out works, and is not something anyone finds.
 *
 * So the drawer carries a button of its own. It cannot go through the view's
 * `addAction`, which writes into that hidden header; it is placed over the
 * corner of the view's content instead, wearing Obsidian's own class for a
 * header button so it looks and behaves like one.
 */

/**
 * The icon, out of the set Obsidian draws its own buttons with. Two arrows
 * pulling apart, which is what the maximize button on a window wears.
 */
export const NEW_TAB_ICON = 'maximize-2';

/** The button itself, which styles.css holds against the top corner. */
export const NEW_TAB_CLASS = 'lattice-new-tab';

/**
 * Marks the view's content as the one holding the button, so the positioning
 * context comes from a class this plugin owns rather than from a guess at
 * Obsidian's own `position` there.
 */
export const DRAWER_CONTAINER_CLASS = 'lattice-with-new-tab';

/**
 * What the button says it does, in the language the app is set to.
 *
 * Not `Open in a new tab` in every language: the app's own view menu says it in
 * the user's, and a hover label that contradicts the menu next to it is worse
 * than a translated one. The board itself stays English, as it does everywhere
 * else; only the strings Obsidian would have written are written here.
 */
export function newTabLabel(language: string): string {
	if (language === 'zh-TW') {
		return '在新分頁中開啟';
	}

	return language.startsWith('zh') ? '在新标签页中打开' : 'Open in a new tab';
}
