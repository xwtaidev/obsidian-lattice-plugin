/**
 * A colour per value, taken from Obsidian's own palette.
 *
 * A board is a wall of short strings, and the same string means the same thing
 * everywhere it appears — `High`, a tag, a column name. Assigning each one a
 * colour is what lets the board be scanned instead of read: without it the eye
 * has to walk every card to find the two that say `High`.
 *
 * The colours are the eight Obsidian already defines (`--color-red-rgb` and
 * friends), so they follow the theme in light and dark rather than being picked
 * for one of them, and they are the same eight the user sees in callouts and
 * error text.
 */

/** The palette is the length of Obsidian's colour list, not an arbitrary number. */
const HUE_COUNT = 8;

/**
 * FNV-1a, 32-bit.
 *
 * Any stable hash would do; this one is a few lines, has no state, and spreads
 * short similar strings — `High` / `Low` — far enough apart to be useful.
 */
function hash(text: string): number {
	let value = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 16777619);
	}
	return value >>> 0;
}

/**
 * Assigns one colour per distinct value, for the duration of one render.
 *
 * A fresh instance per render is deliberate. Colours have to be stable while
 * the board is on screen — the same value must not change colour between two
 * cards in the same column — but nothing is gained by remembering them across
 * renders, and something is lost: a value that has left the data would keep
 * holding a colour that a value still on the board could have used.
 *
 * Two values that hash to the same colour are separated by probing for the next
 * free one, which is what keeps `High` and `Low` from coming out identical.
 */
export class ValuePalette {
	private readonly assigned = new Map<string, number>();

	/** The class carrying this value's colour, e.g. `lattice-hue-3`. */
	classFor(text: string): string {
		const existing = this.assigned.get(text);
		if (existing !== undefined) {
			return `lattice-hue-${String(existing)}`;
		}

		const taken = new Set(this.assigned.values());
		let index = hash(text) % HUE_COUNT;
		// Stop once every colour is spoken for: past that point the probe would
		// never find a free slot and would spin.
		while (taken.has(index) && taken.size < HUE_COUNT) {
			index = (index + 1) % HUE_COUNT;
		}

		this.assigned.set(text, index);
		return `lattice-hue-${String(index)}`;
	}
}
