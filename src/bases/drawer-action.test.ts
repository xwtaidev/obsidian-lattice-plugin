import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newTabLabel } from './drawer-action';

test('the new-tab button speaks the app language', () => {
	assert.equal(newTabLabel('zh'), '在新标签页中打开');
	assert.equal(newTabLabel('zh-TW'), '在新分頁中開啟');
	assert.equal(newTabLabel('en'), 'Open in a new tab');
});

test('a regional variant is still that language', () => {
	assert.equal(newTabLabel('zh-CN'), '在新标签页中打开');
	assert.equal(newTabLabel('zh-Hans'), '在新标签页中打开');
});

test('anything else gets English rather than nothing', () => {
	assert.equal(newTabLabel('de'), 'Open in a new tab');
	assert.equal(newTabLabel(''), 'Open in a new tab');
});
