/**
 * The text a card shows under its title.
 *
 * Bases has no concept of a description. Properties come from frontmatter and
 * from the file itself (`note.*`, `file.*`, `formula.*`), and the note body is
 * not something a view can ask it for — so a card that wants the blurb a
 * wolai card carries has to go to the markdown.
 *
 * What it reads is the note's opening paragraph. A note almost always opens
 * with the sentence that says what it is, which is exactly what a summary
 * wants, and it needs no agreement from the user about where to keep it.
 *
 * Everything here is a pure function of the markdown. That is deliberate: the
 * markdown a real vault holds is the part of this feature with edge cases, and
 * it can be exercised without a running app — see `description.test.ts`.
 */

/**
 * Lines that are structure rather than prose.
 *
 * A heading is usually the note's title, a table row is a fragment, a comment
 * is not meant to be read. None of them belong in a two-line summary, and one
 * in the middle of a note ends the paragraph before it.
 */
const STRUCTURAL = /^(?:#{1,6}\s|\||%%|<!--)/;

/** A horizontal rule, or the underline of a Setext heading. */
const RULE = /^(?:[-*_]\s*){3,}$|^=+\s*$/;

/** A callout's opening line: `> [!note] Title`. The marker is not prose. */
const CALLOUT = /^>\s*\[!/;

/** Fenced code, either flavour. The fence line both opens and closes a block. */
const FENCE = /^(?:```|~~~)/;

/**
 * How much text is taken at most.
 *
 * Not the truncation mechanism — the card clamps to two lines in CSS. This is
 * here so a note that opens with a wall of text cannot push a novel into the
 * DOM, and it is set far above what two lines can show.
 */
const MAX_LENGTH = 400;

/**
 * Drop the frontmatter block.
 *
 * `---` only opens frontmatter on the first line of a file; anywhere else it
 * is a horizontal rule. A block that is never closed is a note being typed
 * right now, and the opener is the only part that can be identified, so the
 * opener is all that is dropped.
 */
function stripFrontmatter(markdown: string): string {
	const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
	if (lines[0]?.trim() !== '---') {
		return markdown;
	}

	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index]?.trim();
		if (line === '---' || line === '...') {
			return lines.slice(index + 1).join('\n');
		}
	}

	return lines.slice(1).join('\n');
}

/**
 * Markers that say how a line is written rather than what it says: a bullet, a
 * quote, a task box. The words after them are the sentence.
 */
function stripBlockMarkers(line: string): string {
	return line
		.replace(/^>+\s*/, '')
		.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
		.replace(/^\[[ xX]\]\s*/, '')
		.trim();
}

/**
 * Inline syntax, taken out of the words it wraps.
 *
 * This is not a parser, and it does not try to be one: it knows the constructs
 * that turn up in the first paragraph of a note and leaves everything else
 * alone. Failing that way is the safe direction — an unknown construct shows
 * up as its own source text, which still reads, rather than as nothing.
 */
function stripInline(text: string): string {
	return (
		text
			// Escapes first, so that what they protect is not read as syntax.
			.replace(/\\([\\`*_[\]{}()#+.!>~|-])/g, '$1')
			// An image or an embed is a reference, not a sentence. Its alt text
			// is not the note either.
			.replace(/!\[\[[^\]]*\]\]/g, '')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
			// `[[target|alias]]` reads as its alias, `[[target]]` as its target.
			.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
			.replace(/\[\[([^\]]*)\]\]/g, '$1')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/`([^`]*)`/g, '$1')
			.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
			.replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2')
			.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
			.replace(/==(?=\S)([\s\S]*?\S)==/g, '$1')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/**
 * The opening paragraph of a note, as one plain line.
 *
 * `null` means the note has nothing to summarise — an empty note, or one that
 * is frontmatter and a heading and no more. The card shows nothing in that
 * case rather than an empty line.
 */
export function extractDescription(markdown: string): string | null {
	const lines = stripFrontmatter(markdown).split(/\r?\n/);
	const paragraph: string[] = [];
	let inFence = false;

	for (const raw of lines) {
		const line = raw.trim();

		if (inFence) {
			if (FENCE.test(line)) {
				inFence = false;
			}
			continue;
		}

		if (FENCE.test(line)) {
			inFence = true;
			continue;
		}

		if (line.length === 0) {
			// A blank line ends the paragraph, and before one has started it is
			// just the space between the frontmatter and the first sentence.
			if (paragraph.length > 0) {
				break;
			}
			continue;
		}

		if (STRUCTURAL.test(line) || RULE.test(line) || CALLOUT.test(line)) {
			if (paragraph.length > 0) {
				break;
			}
			continue;
		}

		paragraph.push(stripBlockMarkers(line));
	}

	// Lines are joined with a space because that is what a Markdown renderer
	// does with a line break inside a paragraph: the summary reads the way the
	// note reads.
	const text = stripInline(paragraph.join(' ')).slice(0, MAX_LENGTH).trim();
	return text.length > 0 ? text : null;
}
