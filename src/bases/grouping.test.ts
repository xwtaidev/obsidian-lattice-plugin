import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BasesEntry, BasesPropertyId } from 'obsidian';
import {
	buildColumns,
	columnKey,
	moveColumn,
	reorderByDrop,
	restorableColumns,
	writablePropertyKey,
	type ColumnNaming,
	type ColumnState,
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
		assert.deepEqual(values(columns), ['Backlog', 'Doing', 'Done', null, 'Blocked']);
		assert.equal(columns.at(-1)?.entries.length, 0);
	});

	it('calls that column by the value itself, since that is what it holds', () => {
		assert.equal(buildColumns(entries, 'note.status', { ...none, added: ['Blocked'] }).at(-1)?.label, 'Blocked');
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
