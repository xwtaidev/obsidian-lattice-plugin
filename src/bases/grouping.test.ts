import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BasesEntry, BasesPropertyId } from 'obsidian';
import {
	buildColumns,
	cardDropIndex,
	columnKey,
	moveColumn,
	reorderByDrop,
	restorableColumns,
	writablePropertyKey,
	type ColumnNaming,
	type ColumnState,
	type CreationTime,
	type LatticeColumn,
} from './grouping';

/**
 * The column rules.
 *
 * These are the decisions the board makes about what a column is, where it
 * goes, and what a drag means — none of which can be watched happening from
 * outside the app, and all of which are arithmetic that fails quietly. `from`
 * and `hovered` being off by one moves a column one place away from where it
 * was dropped, and nothing on screen says so.
 */

/**
 * A stand-in for `BasesEntry`.
 *
 * The board reads exactly one thing off an entry while it groups — `getValue`
 * — and everything else on the type describes a note that has nothing to do
 * with which column it lands in. The cast is the point: a fake complete enough
 * to satisfy `BasesEntry` would be a second implementation to keep in step.
 */
function entry(value: string | null): BasesEntry {
	return {
		getValue: () => (value === null ? null : { toString: () => value }),
	} as unknown as BasesEntry;
}

const entries: BasesEntry[] = [
	entry('Backlog'),
	entry('Doing'),
	entry('Backlog'),
	entry('Done'),
	entry(null),
];

const none: ColumnState = { order: [], removed: [], added: [] };

function values(columns: LatticeColumn[]): (string | null)[] {
	return columns.map((column) => column.value);
}

function labels(columns: LatticeColumn[]): string[] {
	return columns.map((column) => column.label);
}

describe('buildColumns', () => {
	it('keeps the columns in the order their first entry appears', () => {
		assert.deepEqual(values(buildColumns(entries, 'note.status', none)), [
			'Backlog',
			'Doing',
			'Done',
			null,
		]);
	});

	it('puts every entry in the column of its value', () => {
		const columns = buildColumns(entries, 'note.status', none);
		assert.deepEqual(
			columns.map((column) => column.entries.length),
			[2, 1, 1, 1],
		);
	});

	it('names the column that collects entries with no value', () => {
		assert.deepEqual(labels(buildColumns(entries, 'note.status', none)), [
			'Backlog',
			'Doing',
			'Done',
			'No value',
		]);
	});

	it('puts everything in one column when no property is grouped on', () => {
		const columns = buildColumns(entries, null, none);
		assert.deepEqual(values(columns), [null]);
		assert.deepEqual(labels(columns), ['All notes']);
		assert.equal(columns[0]?.entries.length, entries.length);
	});
});

describe('removed columns', () => {
	it('hides exactly the column that was removed', () => {
		assert.deepEqual(values(buildColumns(entries, 'note.status', { ...none, removed: ['Doing'] })), [
			'Backlog',
			'Done',
			null,
		]);
	});

	it('names the no-value column by the empty key', () => {
		assert.deepEqual(values(buildColumns(entries, 'note.status', { ...none, removed: [''] })), [
			'Backlog',
			'Doing',
			'Done',
		]);
	});
});

describe('columns added by hand', () => {
	it('draws a column for a value no note carries yet', () => {
		const columns = buildColumns(entries, 'note.status', { ...none, added: ['Blocked'] });
		// Before the ungrouped column: that one is drawn last, so a column added
		// by hand — and the button that adds it — belong on this side of it.
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', 'Blocked', null]);
		assert.equal(columns.at(-2)?.entries.length, 0);
	});

	it('calls that column by the value itself, since that is what it holds', () => {
		assert.equal(buildColumns(entries, 'note.status', { ...none, added: ['Blocked'] }).at(-2)?.label, 'Blocked');
	});

	it('does not draw a second column for a value the data already produces', () => {
		const columns = buildColumns(entries, 'note.status', { ...none, added: ['Doing'] });
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', null]);
		assert.equal(columns.filter((column) => column.value === 'Doing').length, 1);
	});

	it('does not add the same value twice', () => {
		const columns = buildColumns(entries, 'note.status', { ...none, added: ['Blocked', 'Blocked'] });
		assert.equal(columns.filter((column) => column.value === 'Blocked').length, 1);
	});

	it('lets removal win over an added column', () => {
		// Both lists hold it: it was added, and then it was deleted, and the
		// later wish is the one that counts.
		const columns = buildColumns(entries, 'note.status', {
			order: [],
			removed: ['Blocked'],
			added: ['Blocked'],
		});
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', null]);
	});

	it('keeps an added column where the order list puts it', () => {
		const columns = buildColumns(entries, 'note.status', {
			order: ['Blocked', 'Doing'],
			removed: [],
			added: ['Blocked'],
		});
		assert.deepEqual(values(columns), ['Blocked', 'Doing', 'Backlog', 'Done', null]);
	});

	it('ignores the empty key, which the data owns', () => {
		// The no-value column exists while some entry has no value. "Adding" it
		// by hand would name a column after nothing at all.
		const columns = buildColumns(entries, 'note.status', { ...none, added: [''] });
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', null]);
	});
});

describe('explicit order', () => {
	it('applies the order verbatim', () => {
		const columns = buildColumns(entries, 'note.status', {
			order: ['Done', 'Backlog', 'Doing', ''],
			removed: [],
			added: [],
		});
		assert.deepEqual(values(columns), ['Done', 'Backlog', 'Doing', null]);
	});

	it('appends values the order does not mention, in data order', () => {
		// A value typed into a note for the first time shows up at the right
		// edge rather than being hidden by an order that predates it.
		const columns = buildColumns(entries, 'note.status', {
			order: ['Backlog'],
			removed: [],
			added: [],
		});
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', null]);
	});

	it('ignores order entries that are not on screen', () => {
		const columns = buildColumns(entries, 'note.status', {
			order: ['Nope', 'Done'],
			removed: [],
			added: [],
		});
		assert.deepEqual(values(columns), ['Done', 'Backlog', 'Doing', null]);
	});

	it('survives the round trip a column drag makes', () => {
		// What the board does on a drop: read the keys off the screen, move one,
		// store the result, and rebuild from it.
		const before = buildColumns(entries, 'note.status', none);
		const keys = before.map((column) => columnKey(column.value));
		const after = buildColumns(entries, 'note.status', {
			order: moveColumn(keys, 0, 2),
			removed: [],
			added: [],
		});
		assert.deepEqual(values(after), ['Doing', 'Done', 'Backlog', null]);
	});
});

describe('the ungrouped column', () => {
	/** No value first, so the data alone would put the column at the front. */
	const noValueFirst: BasesEntry[] = [entry(null), entry('Backlog'), entry('Doing')];

	it('is drawn last even when the order list names it first', () => {
		// Files written before the column was pinned hold the empty key in the
		// order, and a drag of another column can still leave it there. The
		// rule outranks it: what the board draws is not up for the file to say.
		const columns = buildColumns(entries, 'note.status', {
			order: ['', 'Done', 'Backlog'],
			removed: [],
			added: [],
		});
		assert.deepEqual(values(columns), ['Done', 'Backlog', 'Doing', null]);
	});

	it('is drawn last when the data alone would put it in the middle', () => {
		// Where it used to land: wherever the first entry without a value fell.
		const columns = buildColumns(noValueFirst, 'note.status', none);
		assert.deepEqual(values(columns), ['Backlog', 'Doing', null]);
	});

	it('is drawn last however many columns follow it', () => {
		const columns = buildColumns(noValueFirst, 'note.status', {
			order: ['Doing'],
			removed: [],
			added: ['Blocked'],
		});
		assert.deepEqual(values(columns), ['Doing', 'Backlog', 'Blocked', null]);
	});

	it('stays deleted when it is deleted', () => {
		// Removal is the user's wish and the pin is the board's default: the
		// default must not overrule the wish by putting the column back.
		const columns = buildColumns(entries, 'note.status', { ...none, removed: [''] });
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done']);
	});

	it('is the only column of a board that groups on nothing, so the rule is a no-op', () => {
		const columns = buildColumns(entries, null, none);
		assert.deepEqual(values(columns), [null]);
		assert.deepEqual(labels(columns), ['All notes']);
	});
});

describe('moveColumn', () => {
	const keys = ['a', 'b', 'c'];

	it('moves a column one place to the right', () => {
		assert.deepEqual(moveColumn(keys, 0, 1), ['b', 'a', 'c']);
	});

	it('moves a column one place to the left', () => {
		assert.deepEqual(moveColumn(keys, 2, 1), ['a', 'c', 'b']);
	});

	it('moves a column to the start', () => {
		assert.deepEqual(moveColumn(keys, 2, 0), ['c', 'a', 'b']);
	});

	it('clamps a target past the end rather than dropping the column', () => {
		assert.deepEqual(moveColumn(keys, 0, 9), ['b', 'c', 'a']);
	});

	it('clamps a target before the start', () => {
		assert.deepEqual(moveColumn(keys, 1, -5), ['b', 'a', 'c']);
	});

	it('does nothing when the source is out of range', () => {
		assert.deepEqual(moveColumn(['a', 'b'], 5, 0), ['a', 'b']);
	});

	it('leaves a single column alone', () => {
		assert.deepEqual(moveColumn(['a'], 0, 1), ['a']);
	});

	it('returns a new array, so a caller cannot shorten the stored order', () => {
		const order = ['a', 'b'];
		assert.notEqual(moveColumn(order, 0, 1), order);
	});
});

describe('reorderByDrop', () => {
	const keys = ['a', 'b', 'c', 'd'];

	it('lands after the column it was dropped on when the pointer was on its right half', () => {
		assert.deepEqual(reorderByDrop(keys, 0, 2, true), ['b', 'c', 'a', 'd']);
	});

	it('lands before the column it was dropped on when the pointer was on its left half', () => {
		assert.deepEqual(reorderByDrop(keys, 3, 0, false), ['d', 'a', 'b', 'c']);
	});

	it('travels left over more than one column', () => {
		assert.deepEqual(reorderByDrop(keys, 3, 2, false), ['a', 'b', 'd', 'c']);
	});

	it('travels right over more than one column', () => {
		assert.deepEqual(reorderByDrop(keys, 1, 2, true), ['a', 'c', 'b', 'd']);
	});

	it('does nothing when a column is dropped on itself', () => {
		assert.deepEqual(reorderByDrop(keys, 1, 1, false), keys);
		assert.deepEqual(reorderByDrop(keys, 1, 1, true), keys);
	});

	it('ignores an out-of-range hovered column', () => {
		assert.deepEqual(reorderByDrop(['a', 'b'], 0, 5, true), ['a', 'b']);
	});

	it('ignores an out-of-range dragged column', () => {
		assert.deepEqual(reorderByDrop(['a', 'b'], 5, 0, false), ['a', 'b']);
	});

	it('behaves at every drop position on a four-column board', () => {
		let swept = 0;
		for (let from = 0; from < keys.length; from += 1) {
			for (let hovered = 0; hovered < keys.length; hovered += 1) {
				for (const after of [false, true]) {
					const label = `from=${String(from)} hovered=${String(hovered)} after=${String(after)}`;
					const next = reorderByDrop(keys, from, hovered, after);
					const dragged = keys[from] ?? '';
					const target = keys[hovered] ?? '';
					const rest = (list: string[]): string => list.filter((key) => key !== dragged).join('');
					swept += 1;

					// A rearrangement: never a drop, never a duplicate.
					assert.deepEqual([...next].sort(), [...keys].sort(), label);
					if (from === hovered) {
						assert.deepEqual(next, keys, label);
						continue;
					}

					// It lands beside the column it was dropped on, on the side
					// the pointer was in. This is where an off-by-one shows up.
					assert.equal(next.indexOf(dragged) - next.indexOf(target), after ? 1 : -1, label);
					// Nothing else changes places.
					assert.equal(rest(next), rest(keys), label);
				}
			}
		}

		assert.equal(swept, keys.length * keys.length * 2);
	});
});

describe('cardDropIndex', () => {
	// Three cards 100px tall, one under the next: centres at 50, 150, 250.
	const midpoints = [50, 150, 250];

	it('puts a card above the first one the pointer has not reached', () => {
		assert.equal(cardDropIndex(midpoints, 0), 0);
		assert.equal(cardDropIndex(midpoints, 49), 0);
		assert.equal(cardDropIndex(midpoints, 51), 1);
		assert.equal(cardDropIndex(midpoints, 149), 1);
		assert.equal(cardDropIndex(midpoints, 151), 2);
	});

	it('puts a card at the end once the pointer is past every card', () => {
		assert.equal(cardDropIndex(midpoints, 251), 3);
		assert.equal(cardDropIndex(midpoints, 5000), 3);
	});

	it('opens the one slot an empty column has', () => {
		assert.equal(cardDropIndex([], 0), 0);
		assert.equal(cardDropIndex([], 400), 0);
	});

	it('treats a pointer exactly on a centre as past it', () => {
		// The boundary is not a tie to be broken carefully, it is where the
		// card under the pointer starts being the one above it.
		assert.equal(cardDropIndex([50], 50), 1);
	});

	it('never answers with a slot outside the list', () => {
		for (const pointerY of [-100, 0, 50, 150, 250, 900]) {
			const index = cardDropIndex(midpoints, pointerY);
			assert.ok(index >= 0 && index <= midpoints.length);
		}
	});
});

describe('columnKey', () => {
	it('stores the no-value column under the empty key', () => {
		assert.equal(columnKey(null), '');
	});

	it('stores a value as itself', () => {
		assert.equal(columnKey('Doing'), 'Doing');
	});
});

describe('writablePropertyKey', () => {
	it('writes a note property to its own name', () => {
		assert.equal(writablePropertyKey('note.status'), 'status');
	});

	it('refuses a property that is computed rather than stored', () => {
		assert.equal(writablePropertyKey('file.name'), null);
		assert.equal(writablePropertyKey('formula.total'), null);
	});

	it('refuses a property id with no source in it', () => {
		// The type says this cannot happen; a `.base` file typed by hand says
		// otherwise, which is the whole reason the guard is there.
		assert.equal(writablePropertyKey('status' as BasesPropertyId), null);
	});

	it('refuses an empty property name', () => {
		assert.equal(writablePropertyKey('note.'), null);
	});
});

describe('restorableColumns', () => {
	it('names a removed column the way its notes spell the value', () => {
		const refs = restorableColumns(entries, 'note.status', { ...none, removed: ['Doing'] });
		assert.deepEqual(refs, [{ key: 'Doing', label: 'Doing' }]);
	});

	it('names the removed no-value column rather than an empty string', () => {
		assert.deepEqual(restorableColumns(entries, 'note.status', { ...none, removed: [''] }), [
			{ key: '', label: 'No value' },
		]);
	});

	it('offers a column that only the added list still knows about', () => {
		// No note carries it any more, so its name is the one it was added
		// under — otherwise adding and then deleting a column would lose it.
		const refs = restorableColumns(entries, 'note.status', {
			order: [],
			removed: ['Blocked'],
			added: ['Blocked'],
		});
		assert.deepEqual(refs, [{ key: 'Blocked', label: 'Blocked' }]);
	});

	it('mentions a column once when both the data and the added list know it', () => {
		const refs = restorableColumns(entries, 'note.status', {
			order: [],
			removed: ['Doing'],
			added: ['Doing'],
		});
		assert.deepEqual(refs, [{ key: 'Doing', label: 'Doing' }]);
	});

	it('says nothing about columns that are still on the board', () => {
		assert.deepEqual(restorableColumns(entries, 'note.status', { ...none, added: ['Blocked'] }), []);
	});

	it('has nothing to offer when nothing was removed', () => {
		assert.deepEqual(restorableColumns(entries, 'note.status', none), []);
	});
});

/**
 * The reading and the words the board passes in.
 *
 * `BasesEntry.getValue` answers with a `NullValue` — a real object — for a
 * property a note does not carry, and its `toString()` is the text "null". Both
 * of the first two tests fail against the version of `deriveColumns` that took
 * that text at face value: the entry below gets a column of its own, named
 * `null`, coloured like a value and written back as one.
 */
describe('the reading the board passes in', () => {
	const stringifiesToNull = {
		getValue: () => ({ toString: () => 'null' }),
	} as unknown as BasesEntry;

	it('lets the caller decide what counts as no value', () => {
		const columns = buildColumns(
			[...entries, stringifiesToNull],
			'note.status',
			none,
			(value) => value !== null && value.toString() === 'null',
		);

		// It joins the column that already stands for absent values rather than
		// opening one of its own called `null`.
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', null]);
		assert.equal(columns[3]?.entries.length, 2);
	});

	it('takes both of the names it is handed', () => {
		const naming: ColumnNaming = { noValue: '未分组', allNotes: '全部笔记' };
		assert.deepEqual(labels(buildColumns(entries, 'note.status', none, undefined, naming)), [
			'Backlog',
			'Doing',
			'Done',
			'未分组',
		]);
		assert.deepEqual(labels(buildColumns(entries, null, none, undefined, naming)), ['全部笔记']);
	});

	it('names a restorable no value column the same way', () => {
		const naming: ColumnNaming = { noValue: '未分组', allNotes: 'All notes' };
		assert.deepEqual(
			restorableColumns(entries, 'note.status', { ...none, removed: [''] }, undefined, naming),
			[{ key: '', label: '未分组' }],
		);
	});
});

/**
 * A stand-in that also knows what its note is called and when it was made.
 *
 * `entry` above carries the one thing grouping reads. A card's place in a
 * column is read off two more, and a test about places has to be able to say
 * where a card ended up — two notes share a status, so the status cannot be the
 * name of a card.
 */
function timed(name: string, value: string | null, ctime: number): BasesEntry {
	return {
		getValue: () => (value === null ? null : { toString: () => value }),
		file: { basename: name, stat: { ctime } },
	} as unknown as BasesEntry;
}

/** The reading the view hands in: when the note behind the entry was made. */
const CREATED: CreationTime = (entry) => entry.file.stat.ctime;

/** The cards of one column, as the names on them, in the order they are drawn. */
function cardOrder(columns: LatticeColumn[], value: string | null): string[] {
	const column = columns.find((candidate) => candidate.value === value);
	return (column?.entries ?? []).map((entry) => entry.file.basename);
}

/** `buildColumns` as the view calls it: grouping on status, ordered by creation. */
function boardOf(cards: BasesEntry[], createdAt: CreationTime | null = CREATED): LatticeColumn[] {
	return buildColumns(cards, 'note.status', none, undefined, undefined, createdAt);
}

/**
 * The question a board with no sort of its own cannot answer for itself.
 *
 * The entries arrive in the order the query settled on, which is the notes'
 * names, so a note added to the board lands wherever its name falls and the `+`
 * that made it looks broken. Nothing about the rule can be watched from outside
 * the app — it is a comparison, and comparing the wrong pair puts a card one
 * place away from where it was expected with nothing on screen to say so.
 */
describe('the order cards are drawn in', () => {
	it('draws the newest card last, so one just made is appended', () => {
		const columns = boardOf([
			timed('old', 'Doing', 1000),
			timed('new', 'Doing', 3000),
			timed('middle', 'Doing', 2000),
		]);
		assert.deepEqual(cardOrder(columns, 'Doing'), ['old', 'middle', 'new']);
	});

	it('orders every column, not the board as a whole', () => {
		// Nothing about the order within one column may depend on another: the
		// entries are grouped first and each group is compared among itself.
		const columns = boardOf([
			timed('doing-late', 'Doing', 2000),
			timed('backlog-late', 'Backlog', 4000),
			timed('doing-early', 'Doing', 1000),
			timed('backlog-early', 'Backlog', 3000),
		]);
		assert.deepEqual(cardOrder(columns, 'Doing'), ['doing-early', 'doing-late']);
		assert.deepEqual(cardOrder(columns, 'Backlog'), ['backlog-early', 'backlog-late']);
	});

	it('orders the column that collects entries with no value too', () => {
		const columns = boardOf([
			timed('unfiled-late', null, 3000),
			timed('unfiled-early', null, 1000),
		]);
		assert.deepEqual(cardOrder(columns, null), ['unfiled-early', 'unfiled-late']);
	});

	it('leaves notes made in the same second where the query put them', () => {
		// The timestamps have second resolution, so a batch import or a run of
		// `+` clicks all share one. Breaking the tie on anything else would
		// invent a place for a card that nothing explains.
		const asGiven = boardOf([timed('first', 'Doing', 1000), timed('second', 'Doing', 1000)]);
		const reversed = boardOf([timed('second', 'Doing', 1000), timed('first', 'Doing', 1000)]);
		assert.deepEqual(cardOrder(asGiven, 'Doing'), ['first', 'second']);
		assert.deepEqual(cardOrder(reversed, 'Doing'), ['second', 'first']);
	});

	it('leaves the order alone when the board has a sort of its own', () => {
		// What a `.base` with an explicit `sort` gets: the user has answered
		// this question already, and their answer is not creation order.
		const columns = boardOf([timed('late', 'Doing', 2000), timed('early', 'Doing', 1000)], null);
		assert.deepEqual(cardOrder(columns, 'Doing'), ['late', 'early']);
	});

	it('does not disturb the array the view hands in', () => {
		// The view passes the query's own array, which it goes on using.
		const cards = [timed('late', 'Doing', 2000), timed('early', 'Doing', 1000)];
		boardOf(cards);
		assert.deepEqual(
			cards.map((card) => card.file.basename),
			['late', 'early'],
		);
	});
});
