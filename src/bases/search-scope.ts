/**
 * What a board's search box searches.
 *
 * Core's search is not a filter a view applies — it is done to the data before
 * the view is given any. The controller ends its update with
 *
 *     controller.applySearchQuery([...results.values()], viewConfig.getOrder())
 *
 * and hands the view what came back as `data.data`, so the scope of a search is
 * the view's own order: in a table, the visible columns. A board's order is the
 * fields a card shows, which leaves the one thing a card leads with — its title
 * — unsearchable, and a search for a word in a title empties the board with the
 * count beside the box reading zero. That is not what a user means by search.
 *
 * Core takes no argument for the scope and gives a view no hook to supply one,
 * so the title is added where the scope is read. `getOrder` is inherited from
 * the prototype, so an own property shadows it for this view alone, and
 * `file.name` is a property like any other to the filter that runs next.
 *
 * What this leaves alone:
 *
 * - The count. Core counts what it filtered, so the number beside the box stays
 *   the number of cards on the board.
 * - The card. A board drops file properties before it draws a field, so the
 *   title never turns into a chip.
 * - The file. `getOrder` is only read; nothing is written to the `.base`.
 * - Other views. Every view in a `.base` holds a config of its own, and a table
 *   goes on searching the columns it shows.
 */

import type { BasesPropertyId, BasesViewConfig } from 'obsidian';

/** A card's title, spelled the way core spells a property. */
const TITLE = 'file.name' as BasesPropertyId;

/**
 * The properties a search looks at: what the board shows, and the title of the
 * card it shows it on.
 *
 * The title goes on the end rather than the front, so the order the user
 * arranged their fields in is handed back exactly as it came.
 */
export function searchedProperties(order: readonly BasesPropertyId[]): BasesPropertyId[] {
	return order.includes(TITLE) ? [...order] : [...order, TITLE];
}

/**
 * Widen one board's search to include card titles.
 *
 * Once per config: the board is handed a config on every render, and wrapping
 * the same one twice would only name the title again.
 */
const widened = new WeakSet<BasesViewConfig>();

export function searchCardTitles(config: BasesViewConfig): void {
	if (widened.has(config)) return;
	const order = config.getOrder.bind(config);
	config.getOrder = () => searchedProperties(order());
	widened.add(config);
}
