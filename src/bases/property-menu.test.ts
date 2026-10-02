import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { labelsToHide } from './property-menu';

/**
 * Which names the property menu loses.
 *
 * This is the one decision in the hider that can be wrong without breaking
 * anything visible: drop the guard below and a base that renamed its
 * timestamps loses those too — and the timestamps are the only file properties
 * a board keeps.
 */

const kept = new Set(['创建时间', '修改时间']);

describe('labelsToHide', () => {
	it('hides every file property except the kept ones', () => {
		const labels = [
			'文件反向链接',
			'文件名',
			'创建时间',
			'扩展名',
			'修改时间',
			'路径',
		];

		assert.deepEqual(
			labelsToHide(labels, kept),
			new Set(['文件反向链接', '文件名', '扩展名', '路径']),
		);
	});

	it('hides nothing when the list holds only what is kept', () => {
		assert.deepEqual(labelsToHide(['创建时间', '修改时间'], kept), new Set());
	});

	it('leaves the menu alone when a kept name is not in it', () => {
		assert.equal(labelsToHide(['文件反向链接', '文件名', '创建时间'], kept), null);
		assert.equal(labelsToHide([], kept), null);
	});

	it('leaves the menu alone until a board has said what to keep', () => {
		assert.equal(labelsToHide(['文件名', '路径'], new Set()), null);
	});
});
