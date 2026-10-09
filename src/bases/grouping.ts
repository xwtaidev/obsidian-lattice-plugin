import type { BasesEntry, BasesPropertyId, Value } from 'obsidian';

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
	/**
	 * Columns added by hand, which are drawn while they are empty.
	 *
	 * A column normally exists because a note carries its value, which leaves no
	 * way to set a board up: the value nobody has typed yet has nowhere to put
	 * the first card. A key listed here is a column in its own right; once notes
	 * carry the value it is indistinguishable from any other, and the entry then
	 * only keeps it from vanishing when the last card leaves.
	 */
	added: string[];
}

export const EMPTY_COLUMN_STATE: ColumnState = { order: [], removed: [], added: [] };

/**
 * Whether a value counts as no value at all.
 *
 * `BasesEntry.getValue` does not answer `null` for a property a note does not
 * carry. It answers with a `NullValue` — a real object, whose `toString()` is
 * the text "null" — and that text read at face value is wrong in three ways at
 * once: the notes without the property get a column named `null`, that column
 * claims to be a value someone typed (so it gets a colour and a place in the
 * order), and it never merges with the column the board keeps for entries with
 * no value at all. Only a property the query cannot resolve gives a `null`.
 *
 * The app is the only thing that can recognise the class, and this module is
 * kept free of the app so it can be exercised without one, so the test is
 * passed in. `PLAINLY_MISSING` below is the reading with no app to ask.
 */
export type MissingValue = (value: Value | null) => boolean;

/** The plain reading: nothing but `null` is missing. */
const PLAINLY_MISSING: MissingValue = (value) => value === null;

/**
 * What the two columns that stand for absence are called.
 *
 * Neither is a value any note carries, so neither can be read off the data, and
 * both are the user's language — which this module has none of.
 */
export interface ColumnNaming {
	/** Collects entries with no value for the grouped property. */
	noValue: string;
	/** The single column of a board that groups on nothing at all. */
	allNotes: string;
}

/** The names a caller with no language to ask about gets. */
const PLAINLY_NAMED: ColumnNaming = { noValue: 'No value', allNotes: 'All notes' };

/**
 * When the note behind an entry was created, in milliseconds.
 *
 * Only the view has a file to read this off, and this module is kept free of
 * the app so it can be exercised without one, so it is handed in — and handed
 * in as `null` by a caller that has no business reordering anything, which is
 * what "the board has a sort of its own" means.
 */
export type CreationTime = (entry: BasesEntry) => number;

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
	isMissing: MissingValue = PLAINLY_MISSING,
	naming: ColumnNaming = PLAINLY_NAMED,
	createdAt: CreationTime | null = null,
): LatticeColumn[] {
	const source = createdAt === null ? entries : orderByCreation(entries, createdAt);
	const derived = deriveColumns(source, propertyId, isMissing, naming);
	const removed = new Set(state.removed);
	const kept = derived.filter((column) => !removed.has(columnKey(column.value)));
	return withNoValueLast(
		applyOrder([...kept, ...addedColumns(kept, state.added, removed)], state.order),
	);
}

/**
 * The cards in the order their notes were created, oldest first.
 *
 * A board the user has not sorted hands the entries over in whatever order the
 * query settled on, which is the notes' names. A note added to that board
 * therefore lands wherever its name falls — `未命名` is drawn above `写一个很长
 * 的标题` because of how the two read — and the `+` that made it looks broken:
 * it says "a new card goes here" and the card turns up somewhere else.
 * Creation order is the one reading that makes adding a card append it, and it
 * is the reading a column already has when you pile cards onto it by hand.
 *
 * Ties keep the order they arrived in, which is why this sorts a copy with a
 * plain `sort` rather than building a key that decides them: the timestamps
 * have second resolution, so a batch import or a run of `+` clicks all share
 * one, and within a second the name order the query gave is as good an answer
 * as any. It also means the notes that were already there keep the order they
 * were in, and only what is newer than them moves.
 *
 * An explicit `sort` in the `.base` is the user's own answer to this question,
 * so the view passes `null` for `createdAt` and none of this runs.
 */
function orderByCreation(entries: BasesEntry[], createdAt: CreationTime): BasesEntry[] {
	return [...entries].sort((a, b) => createdAt(a) - createdAt(b));
}

/**
 * The column that collects entries without a value is drawn last, whatever the
 * data and the order list would otherwise make of it.
 *
 * Nobody chose its place: it is not a value anyone typed into a note, so it
 * has no place in the order the values appear in — it used to land wherever
 * the first entry without a value happened to fall, which is a position that
 * moves as notes change and, in the middle of the values, reads as one of
 * them. The end of the board is the one spot that reads as a decision, and it
 * keeps the column where it can be ignored: it is the single column a board
 * fills by itself.
 *
 * A board that groups on nothing has only this column, so there is nothing to
 * move.
 */
function withNoValueLast(columns: LatticeColumn[]): LatticeColumn[] {
	const pinned = columns.find((column) => column.value === null);
	if (pinned === undefined || columns.at(-1) === pinned) {
		return columns;
	}

	return [...columns.filter((column) => column !== pinned), pinned];
}

/**
 * The columns the user added that the data does not produce.
 *
 * Removal wins: a column added and then deleted is in both lists, and it is the
 * delete that was the later wish. The empty key is skipped rather than
 * materialised — it belongs to the column that collects entries with no value,
 * which exists exactly while some entry has none, and it is not text anyone
 * could have typed into the first place.
 */
function addedColumns(
	kept: LatticeColumn[],
	added: string[],
	removed: Set<string>,
): LatticeColumn[] {
	const present = new Set(kept.map((column) => columnKey(column.value)));
	const columns: LatticeColumn[] = [];
	for (const key of added) {
		if (key.length === 0 || present.has(key) || removed.has(key)) {
			continue;
		}

		present.add(key);
		// The key is the value, so it is also what the column is called.
		columns.push({ value: key, label: key, entries: [] });
	}

	return columns;
}

/**
 * Columns in the order values first appear, which inherits the sort the user
 * configured in Bases — the query result arrives presorted.
 */
function deriveColumns(
	entries: BasesEntry[],
	propertyId: BasesPropertyId | null,
	isMissing: MissingValue,
	naming: ColumnNaming,
): LatticeColumn[] {
	if (propertyId === null) {
		return [{ value: null, label: naming.allNotes, entries: [...entries] }];
	}

	const columns = new Map<string, LatticeColumn>();
	for (const entry of entries) {
		const value = entry.getValue(propertyId);
		const text = value === null || isMissing(value) ? null : value.toString();
		const key = text === null ? NO_VALUE_KEY : `value:${text}`;

		let column = columns.get(key);
		if (column === undefined) {
			column = { value: text, label: text ?? naming.noValue, entries: [] };
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
 * Which slot of a column a dragged card is dropped into.
 *
 * `midpoints` are the vertical centres of the cards a column is showing, in
 * draw order. The card goes in front of the first one the pointer has not yet
 * reached, and at the end when it has passed them all — `columnAt`'s rule,
 * turned through ninety degrees, so the two drags answer to the same hand.
 *
 * What this decides is the slot the drop is drawn in, not where the note ends
 * up: a column's order comes from the base's sort, and nothing on the board
 * writes it. The slot is how a drag says *which card* is going where, which
 * the lit-up column alone cannot.
 */
export function cardDropIndex(midpoints: number[], pointerY: number): number {
	let index = 0;
	for (const midpoint of midpoints) {
		if (pointerY < midpoint) {
			return index;
		}
		index += 1;
	}

	return midpoints.length;
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

/** A column the board can put back, named the way its header would read. */
export interface ColumnRef {
	/** `columnKey` of the column. */
	key: string;
	label: string;
}

/**
 * The columns the user took off this board, ready to be offered back.
 *
 * The label normally comes from the data: a removed column's notes are still
 * there, spelling the value the way they spell it. A column no note carries any
 * more can only be known by its key, which for a column the user added by hand
 * is the name they typed — so the added list is consulted too, and adding then
 * deleting a column is not a way to lose it.
 */
export function restorableColumns(
	entries: BasesEntry[],
	propertyId: BasesPropertyId | null,
	state: ColumnState,
	isMissing: MissingValue = PLAINLY_MISSING,
	naming: ColumnNaming = PLAINLY_NAMED,
): ColumnRef[] {
	const hidden = new Set(state.removed);
	const refs: ColumnRef[] = [];
	for (const column of deriveColumns(entries, propertyId, isMissing, naming)) {
		const key = columnKey(column.value);
		if (hidden.has(key)) {
			refs.push({ key, label: column.label });
		}
	}

	for (const key of state.added) {
		if (key.length > 0 && hidden.has(key) && !refs.some((ref) => ref.key === key)) {
			refs.push({ key, label: key });
		}
	}

	return refs;
}
