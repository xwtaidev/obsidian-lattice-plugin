import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractDescription } from './description';

/**
 * The markdown a card's description is read out of.
 *
 * Every case here is a note someone could plausibly write, because the rules
 * being pinned down are all about what the first paragraph of a real note
 * looks like — not about how a Markdown parser is specified. When a rule has
 * to fail one way or the other, it fails towards showing the source text: a
 * description that reads a little off is better than a blank card.
 */
describe('extractDescription', () => {
	it('skips the frontmatter and takes the paragraph under it', () => {
		const markdown = ['---', 'tags: task', 'priority: High', '---', '', 'Ship the board view.'].join(
			'\n',
		);
		assert.equal(extractDescription(markdown), 'Ship the board view.');
	});

	it('works on a note with no frontmatter at all', () => {
		assert.equal(extractDescription('Just a sentence.'), 'Just a sentence.');
	});

	it('takes the first paragraph and stops at the blank line', () => {
		const markdown = 'The opening line.\n\nA second paragraph that is not the summary.';
		assert.equal(extractDescription(markdown), 'The opening line.');
	});

	it('joins the lines of one paragraph with a space', () => {
		// A soft break renders as a space everywhere else in Obsidian, so the
		// summary has to read the way the note reads.
		assert.equal(extractDescription('One sentence\nwrapped over two lines.'), 'One sentence wrapped over two lines.');
	});

	it('skips a heading, which is the note title rather than the note', () => {
		assert.equal(extractDescription('# Board spike\n\nWhat the spike is for.'), 'What the spike is for.');
	});

	it('skips a heading that sits between the frontmatter and the text', () => {
		const markdown = ['---', 'tags: task', '---', '## Summary', '', 'The actual text.'].join('\n');
		assert.equal(extractDescription(markdown), 'The actual text.');
	});

	it('skips a fenced code block, contents and all', () => {
		const markdown = ['```ts', 'const leak = true;', '```', '', 'The prose after the code.'].join('\n');
		assert.equal(extractDescription(markdown), 'The prose after the code.');
	});

	it('skips a horizontal rule and a note that opens with one', () => {
		assert.equal(extractDescription('---\n\nAfter the rule.'), 'After the rule.');
	});

	it('skips a comment line', () => {
		assert.equal(extractDescription('%%do not ship this%%\n\nReadable text.'), 'Readable text.');
	});

	it('skips a table, whose rows are fragments', () => {
		assert.equal(extractDescription('| a | b |\n| --- | --- |\n'), null);
	});

	it('skips a callout marker but keeps the callout text', () => {
		assert.equal(extractDescription('> [!note] Heads up\n> The note body.'), 'The note body.');
	});

	it('drops a bullet marker from a note that is a list', () => {
		assert.equal(extractDescription('- First item\n- Second item'), 'First item Second item');
	});

	it('drops a task checkbox', () => {
		assert.equal(extractDescription('- [ ] Ship it\n- [x] Write it down'), 'Ship it Write it down');
	});

	it('drops a blockquote marker', () => {
		assert.equal(extractDescription('> Quoted opening.'), 'Quoted opening.');
	});

	it('takes the alias of a wikilink with one', () => {
		assert.equal(extractDescription('See [[board-spike|the spike]].'), 'See the spike.');
	});

	it('takes the target of a wikilink without one', () => {
		assert.equal(extractDescription('See [[board-spike]].'), 'See board-spike.');
	});

	it('takes the text of a markdown link', () => {
		assert.equal(
			extractDescription('Read [the docs](https://example.com/docs).'),
			'Read the docs.',
		);
	});

	it('removes emphasis and inline code rather than showing their markers', () => {
		assert.equal(extractDescription('**Bold** and *italic* and `code`.'), 'Bold and italic and code.');
	});

	it('removes an embed and an image, which are references rather than sentences', () => {
		assert.equal(extractDescription('![[a-canvas.canvas]]\n![](pic.png)\nReal text.'), 'Real text.');
	});

	it('keeps a lone asterisk, which is not emphasis', () => {
		assert.equal(extractDescription('Two * three is six.'), 'Two * three is six.');
	});

	it('keeps a tag, which is part of the sentence', () => {
		assert.equal(extractDescription('Filed under #project.'), 'Filed under #project.');
	});

	it('handles CRLF line endings', () => {
		assert.equal(extractDescription('---\r\na: 1\r\n---\r\n\r\nText.\r\n'), 'Text.');
	});

	it('handles a byte order mark before the frontmatter', () => {
		assert.equal(extractDescription('\uFEFF---\na: 1\n---\n\nText after a BOM.'), 'Text after a BOM.');
	});

	it('drops only the opener of a frontmatter block that is never closed', () => {
		assert.equal(extractDescription('---\nstill being typed'), 'still being typed');
	});

	it('returns null for an empty note', () => {
		assert.equal(extractDescription(''), null);
	});

	it('returns null for a note that is frontmatter only', () => {
		assert.equal(extractDescription('---\ntags: task\n---\n'), null);
	});

	it('returns null for a note that is a heading only', () => {
		assert.equal(extractDescription('# Untitled\n\n'), null);
	});

	it('returns null for whitespace, so a blank card line is never rendered', () => {
		assert.equal(extractDescription('   \n\t\n  '), null);
	});

	it('caps how much of a wall of text it takes', () => {
		const text = extractDescription('x'.repeat(2000));
		assert.equal(text?.length, 400);
	});

	it('collapses the whitespace it kept, so the summary is one line of text', () => {
		assert.equal(extractDescription('S p a c e d\t\tout   text.'), 'S p a c e d out text.');
	});
});
