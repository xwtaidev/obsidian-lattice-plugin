import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBoardProperty } from './board-properties';

/**
 * The line between the properties a board uses and the ones it leaves alone.
 *
 * Both ends are decisions nobody can watch happening. Get the keep list wrong
 * and the fields a user configured quietly stop appearing on their cards; get
 * the type check wrong and `file.name` puts a row of noise on every card.
 */

const kept = [
	'note.tags',
	'note.status',
	'note.priority',
	'note.等级',
	'note.a.b',
	'formula.未命名',
	'formula.Total',
	'file.ctime',
	'file.mtime',
];

const dropped = [
	'',
	'note',
	'note.',
	'formula.',
	'file.',
	'tags',
	'ctime',
	'notes.tags',
	'file.name',
	'file.basename',
	'file.fullname',
	'file.path',
	'file.folder',
	'file.ext',
	'file.size',
	'file.tags',
	'file.links',
	'file.backlinks',
	'file.embeds',
];

describe('isBoardProperty', () => {
	it('keeps what the user wrote and the two timestamps they asked to see', () => {
		for (const propertyId of kept) {
			assert.equal(isBoardProperty(propertyId), true, propertyId);
		}
	});

	it('drops what describes the file rather than the work', () => {
		for (const propertyId of dropped) {
			assert.equal(isBoardProperty(propertyId), false, propertyId);
		}
	});

	it('matches the type in lower case only', () => {
		assert.equal(isBoardProperty('File.ctime'), false);
		assert.equal(isBoardProperty('file.Ctime'), false);
		assert.equal(isBoardProperty('FILE.ctime'), false);
	});
});
