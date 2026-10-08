/**
 * The board a vault with no board file gets.
 *
 * A board is a Bases view, and a Bases view lives in a `.base` file — there is
 * no way to register a view that has no file behind it. So a vault that has
 * just installed the plugin has an icon that opens nothing: the file the
 * settings name does not exist yet, and nothing else in the plugin would ever
 * make one. This is what makes one, once, at load.
 *
 * Only missing files: a file already at the path is left exactly as it is, so
 * a board the user wrote is never overwritten by a default. Creation is also
 * the only thing that can fail here without a symptom later — the file could
 * not be written in a read-only vault — and it reports that by returning
 * false rather than by throwing into the plugin's load.
 */

import type { Vault } from 'obsidian';

/**
 * The board file's contents.
 *
 * Blank on purpose: nothing is filtered, so every note in the vault is a card.
 * `latticeGroupBy` is what makes the board usable rather than a dead end —
 * without it there are no columns, and the two buttons that would make one
 * ("Add column", and the `+` on a column header) are both withheld, because
 * neither can write a value to a note when no property is being grouped on.
 */
export const BLANK_BOARD = `# The board Lattice Board opens from its icon.
#
# A board is a Bases view, so it lives in a file like this one. The plugin
# writes this file the first time it loads into a vault that has no board, and
# keeps it out of the file explorer afterwards.
#
# Nothing is filtered, so every note in the vault is a card. \`latticeGroupBy\`
# names the property the columns are: every value of it that some note carries
# becomes a column, and a note that carries none lands in "No value". \`status\`
# is a starting name, not a requirement — change it here and the columns change
# with it, or point the setting at a board of your own instead.

views:
  - type: lattice-board
    name: Board
    latticeGroupBy: note.status
    latticeShowPropertyNames: true
    # The card shows the note's opening paragraph under its title, clamped to
    # two lines. Bases has no property for a note body, so Lattice reads it
    # itself; set this to false on a board where that line is just noise.
    latticeShowDescription: true
    # What a card carries under its title: the properties listed here, in this
    # order. The file basename is always the title, so it is not listed. The
    # board draws the properties it deals in — the ones the user wrote, plus
    # the two timestamps — and leaves the rest of what a file carries out.
    order:
      - note.tags
      - file.ctime
      - file.mtime

# Where a column's \`+\` puts the note it makes is core Bases' own top level key.
# Without it the note goes to the vault's "default location for new notes".
#
# newItemFolder: lattice-cards
`;

/**
 * The folders that have to exist before a file can be written, outermost first.
 *
 * `Vault.create` does not make parents, and `createFolder` makes one at a time,
 * so a board at `boards/work.base` needs `boards` before it can exist. A path
 * with no folder in it — the default one — needs none of this.
 */
export function foldersToCreate(path: string): string[] {
	const parts = path.split('/').filter((part) => part.length > 0);
	const folders: string[] = [];
	for (let depth = 1; depth < parts.length; depth += 1) {
		folders.push(parts.slice(0, depth).join('/'));
	}

	return folders;
}

/** A path as the vault spells one: no leading, trailing or repeated slashes. */
function normalize(path: string): string {
	return path
		.split('/')
		.filter((part) => part.length > 0)
		.join('/');
}

/**
 * Write the blank board at `path` if nothing is there yet.
 *
 * Returns whether a file was written, which is also whether the caller has
 * anything to say about it — a board that was already there is the ordinary
 * case and not worth a word.
 */
export async function seedBoardFile(vault: Vault, path: string): Promise<boolean> {
	const target = normalize(path.trim());
	if (target.length === 0 || vault.getAbstractFileByPath(target) !== null) {
		return false;
	}

	try {
		for (const folder of foldersToCreate(target)) {
			if (vault.getAbstractFileByPath(folder) === null) {
				await vault.createFolder(folder);
			}
		}

		await vault.create(target, BLANK_BOARD);
		return true;
	} catch {
		// Whatever is wrong with the path is the user's to see, and pressing the
		// icon says so far better than a console line would.
		return false;
	}
}
