/**
 * Which properties a board deals in.
 *
 * A board is about where a note stands, so the properties that carry that are
 * the ones the user wrote themselves — `note.*` frontmatter, and `formula.*`
 * fields defined in the base file — plus the two timestamps that say when a
 * note arrived and when it last moved.
 *
 * Everything else a file carries describes the file rather than the work:
 * name, path, folder, extension, size, backlinks, embeds, links, file tags.
 * The toolbar's property menu offers all of it, to every Bases view including
 * plugin ones, and no API can trim that list — a view is handed the full set
 * and decides for itself what to use. This is that decision, in one place:
 * `BasesPropertyOption.filter` applies it to the property picker, and the card
 * renderer applies it to the order the user configured.
 */

/**
 * `note.tags` and `formula.Total` name a property; a bare `note.` names
 * nothing. The length check is what separates them — the prefix alone cannot.
 */
function isNamed(propertyId: string, type: string): boolean {
	return propertyId.startsWith(`${type}.`) && propertyId.length > type.length + 1;
}

export function isBoardProperty(propertyId: string): boolean {
	return (
		isNamed(propertyId, 'note') ||
		isNamed(propertyId, 'formula') ||
		propertyId === 'file.ctime' ||
		propertyId === 'file.mtime'
	);
}
