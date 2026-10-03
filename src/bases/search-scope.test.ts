import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BasesPropertyId } from 'obsidian';
import { searchedProperties } from './search-scope';

/**
 * What a search on a board looks at.
 *
 * `getOrder` is how core asks a view what to search, and a board answers with
 * the fields it puts on a card. A title is not one of those fields, so unless it
 * is named here, searching for a card by the words on it finds nothing at all.
 */

describe('searchedProperties', () => {
	it('adds the title after the fields the board shows', () => {
		assert.deepEqual(searchedProperties(['note.等级', 'note.priority']), [
			'note.等级',
			'note.priority',
			'file.name',
		]);
	});

	it('names the title once, even when the board already lists it', () => {
		assert.deepEqual(searchedProperties(['file.name', 'note.tags']), ['file.name', 'note.tags']);
	});

	it('hands back a copy, so the list the config owns is left as it was', () => {
		const order: BasesPropertyId[] = ['note.tags'];
		const widened = searchedProperties(order);
		assert.notEqual(widened, order);
		assert.deepEqual(widened, ['note.tags', 'file.name']);
		assert.deepEqual(order, ['note.tags']);
	});

	it('has the title to search before a single field is configured', () => {
		assert.deepEqual(searchedProperties([]), ['file.name']);
	});
});
