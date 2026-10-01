import type { BasesEntry, BasesPropertyId } from 'obsidian';

/**
 * Turning a flat list of entries into board columns.
 *
 * This is deliberately free of any DOM or Obsidian side effects: everything the
 * view needs to decide about columns is decided here, so the rules can be
 * exercised without a running app.
 */

/**
 * Key for entries that have no value for the grouping property. A NUL prefix
 * keeps it out of the way of any real value a user might type.
 */
const NO_VALUE_KEY = '\u0000no-value';

export interface LatticeColumn {
	/**
	 * The grouping value as text, used when a card is dropped on this column.
	 * `null` means the column collects entries with no value, and dropping here
	 * removes the property instead of setting it.
	 */
	value: string | null;
	/** What the column header shows. */
	label: string;
	entries: BasesEntry[];
}

/**
 * The identity a column is stored under in the view config.
 *
 * `null` is the column that collects entries without a value. It has no text of
 * its own, so it is stored as the empty string. A property whose value really
 * is an empty string would share that identity — harmless, since the two are
 * indistinguishable to the user anyway.
 */
export function columnKey(value: string | null): string {
	return value ?? '';
}

/**
 * Column state the user has applied to this view.
 *
 * Both lists hold `columnKey` values. Nothing is written until the user
 * actually moves or deletes a column, so an untouched board keeps deriving its
 * columns purely from the data and never needs an order list to be kept in
 * sync.
 */
export interface ColumnState {
	/** Explicit left-to-right order. Values it does not mention come after. */
	order: string[];
	/** Columns taken off this board. Their notes are untouched. */
	removed: string[];
}

export const EMPTY_COLUMN_STATE: ColumnState = { order: [], removed: [] };

/**
 * Group entries by a property, then apply the user's column state.
 *
 * A multi-value property (tags, for instance) stringifies to a joined list, so
 * it lands in one column rather than one column per value. Splitting those is a
 * real design question and the spike has not answered it yet.
 */
export function buildColumns(
	entries: BasesEntry[],
	propertyId: BasesPropertyId | null,
	state: ColumnState = EMPTY_COLUMN_STATE,
): LatticeColumn[] {
	const derived = deriveColumns(entries, propertyId);
	const removed = new Set(state.removed);
	const kept = derived.filter((column) => !removed.has(columnKey(column.value)));
	return applyOrder(kept, state.order);
}

/**
 * Columns in the order values first appear, which inherits the sort the user
 * configured in Bases — the query result arrives presorted.
 */
function deriveColumns(
	entries: BasesEntry[],
	propertyId: BasesPropertyId | null,
): LatticeColumn[] {
	if (propertyId === null) {
		return [{ value: null, label: 'All notes', entries: [...entries] }];
	}

	const columns = new Map<string, LatticeColumn>();
	for (const entry of entries) {
		const value = entry.getValue(propertyId);
		const text = value === null ? null : value.toString();
		const key = text === null ? NO_VALUE_KEY : `value:${text}`;

		let column = columns.get(key);
		if (column === undefined) {
			column = { value: text, label: text ?? 'No value', entries: [] };
			columns.set(key, column);
		}
		column.entries.push(entry);
	}

	return [...columns.values()];
}

/**
 * Put the columns in the user's order, then append whatever the data produced
 * that the order does not mention yet. A value typed into a note for the first
 * time therefore appears at the right edge instead of being hidden by an order
 * that predates it.
 */
function applyOrder(columns: LatticeColumn[], order: string[]): LatticeColumn[] {
	if (order.length === 0) {
		return columns;
	}

	const byKey = new Map(columns.map((column) => [columnKey(column.value), column]));
	const ordered: LatticeColumn[] = [];
	for (const key of order) {
		const column = byKey.get(key);
		if (column !== undefined) {
			ordered.push(column);
			byKey.delete(key);
		}
	}

	// Map iteration is insertion order, so the leftovers keep the data's order.
	ordered.push(...byKey.values());
	return ordered;
}

/**
 * Move one entry of an order list.
 *
 * The target is clamped, so callers can pass a raw `index + 1` or `index - 1`
 * without bounds-checking first — the menu items that call this are disabled at
 * the ends anyway, and a clamped move is a no-op rather than a bug.
 */
export function moveColumn(keys: string[], from: number, to: number): string[] {
	const next = [...keys];
	if (from < 0 || from >= next.length) {
		return next;
	}

	const clamped = Math.min(Math.max(to, 0), next.length - 1);
	const [moved] = next.splice(from, 1);
	if (moved === undefined) {
		return next;
	}

	next.splice(clamped, 0, moved);
	return next;
}

/**
 * Where a dragged column lands when it is dropped on another one.
 *
 * This looks like arithmetic for arithmetic's sake, and it is not: `moveColumn`
 * removes before it inserts, so an index taken from the pre-removal array is
 * off by one whenever the column travels to the right. Dragging A onto C's
 * right edge has to produce `[B, C, A, D]`, and getting that wrong is invisible
 * until a column lands one slot away from where it was dropped.
 */
export function reorderByDrop(
	keys: string[],
	from: number,
	hovered: number,
	after: boolean,
): string[] {
	if (from < 0 || from >= keys.length || hovered < 0 || hovered >= keys.length) {
		return [...keys];
	}

	// The slot the column is dropped into, counted in the array as it will be
	// once the moved column is out of the way.
	const rawTarget = hovered + (after ? 1 : 0);
	return moveColumn(keys, from, from < rawTarget ? rawTarget - 1 : rawTarget);
}

/**
 * The frontmatter key a grouping property writes back to, or `null` when the
 * property cannot be written at all.
 *
 * A property id is `<source>.<name>`: `note.status` lives in the frontmatter,
 * while `file.name` and `formula.x` are derived and dragging onto those columns
 * must not pretend to change anything.
 */
export function writablePropertyKey(propertyId: BasesPropertyId): string | null {
	const separator = propertyId.indexOf('.');
	if (separator === -1) {
		return null;
	}

	const source = propertyId.slice(0, separator);
	const name = propertyId.slice(separator + 1);
	return source === 'note' && name.length > 0 ? name : null;
}
