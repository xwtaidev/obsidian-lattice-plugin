import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BLANK_BOARD, foldersToCreate } from './board-seed';

/**
 * The board a fresh install gets.
 *
 * What can be checked from outside the app is the shape of the file and the
 * list of folders that has to exist before it can be written — the writing
 * itself needs a vault, and a vault needs the app.
 */

describe('foldersToCreate', () => {
	it('needs none for a board at the root', () => {
		assert.deepEqual(foldersToCreate('lattice-board.base'), []);
	});

	it('lists the chain of one folder, outermost first', () => {
		assert.deepEqual(foldersToCreate('boards/work.base'), ['boards']);
	});

	it('lists every level of a nested path', () => {
		assert.deepEqual(foldersToCreate('a/b/c.base'), ['a', 'a/b']);
	});

	it('ignores the slashes a hand-typed path may carry', () => {
		assert.deepEqual(foldersToCreate('/boards//work.base/'), ['boards']);
	});

	it('needs none for a path that names no file at all', () => {
		assert.deepEqual(foldersToCreate(''), []);
	});
});

describe('the blank board', () => {
	it('asks for the view type the plugin registers', () => {
		assert.match(BLANK_BOARD, /^\s*- type: lattice-board$/m);
	});

	it('groups on a property', () => {
		// Not decoration: with no group-by there is no property to write, and
		// the board withholds both its "Add column" button and the `+` on a
		// column header — a board that can only be looked at.
		assert.match(BLANK_BOARD, /^\s*latticeGroupBy: note\.\S+$/m);
	});

	it('filters nothing', () => {
		assert.doesNotMatch(BLANK_BOARD, /^filters:/m);
	});
});
