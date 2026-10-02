import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { uniqueViewName } from './view-menu';

/**
 * Naming a view that was just added.
 *
 * A name is the only handle the view list has on a view, and two views cannot
 * share one — core refuses a duplicate and the `.base` file would be read back
 * with the wrong one selected. Nothing on screen shows the choice being made,
 * so the counting-up rule is worth pinning down on its own.
 */

describe('uniqueViewName', () => {
	it('uses the wanted name when nothing has it', () => {
		assert.equal(uniqueViewName([], 'Board'), 'Board');
		assert.equal(uniqueViewName(['Table', 'Cards'], 'Board'), 'Board');
	});

	it('counts up from the first name already taken', () => {
		assert.equal(uniqueViewName(['Board'], 'Board'), 'Board 2');
		assert.equal(uniqueViewName(['Board', 'Board 2'], 'Board'), 'Board 3');
		assert.equal(
			uniqueViewName(['Board', 'Board 2', 'Board 3'], 'Board'),
			'Board 4',
		);
	});

	it('fills the lowest gap rather than appending past the end', () => {
		assert.equal(uniqueViewName(['Board', 'Board 3'], 'Board'), 'Board 2');
	});

	it('compares the whole name, not a prefix of it', () => {
		assert.equal(uniqueViewName(['Boardroom'], 'Board'), 'Board');
		assert.equal(uniqueViewName(['Board 2'], 'Board'), 'Board');
	});

	it('counts as case-sensitive, the way core does', () => {
		assert.equal(uniqueViewName(['board'], 'Board'), 'Board');
		assert.equal(uniqueViewName(['BOARD'], 'Board'), 'Board');
	});
});
