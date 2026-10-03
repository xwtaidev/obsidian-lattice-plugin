/**
 * Stable identifiers.
 *
 * `PLUGIN_ID` is API once the plugin is released: saved workspace layouts and
 * user hotkeys refer to it by name, so renaming it silently breaks those for
 * everyone who already installed it.
 */

/** Matches `id` in manifest.json and the folder name under `.obsidian/plugins/`. */
export const PLUGIN_ID = 'lattice-board';

/**
 * The icon on the ribbon button, and the one the board's Bases view type is
 * registered under, out of the set Obsidian draws its own buttons with.
 *
 * Three columns of different heights inside a rounded frame. The frame is what
 * makes it read as a panel rather than a bare glyph, which keeps it apart from
 * the four equal squares (`layout-grid`) that half the plugin ecosystem wears;
 * the columns are the board itself.
 *
 * The names are Lucide's, as of whatever version Obsidian bundles, and they are
 * not stable between versions — this same icon is `square-kanban` in current
 * Lucide and `kanban-square` here. A name Obsidian does not know is not an
 * error: `setIcon` empties the element and draws nothing at all. `getIconIds()`
 * is what to check a new name against.
 */
export const LATTICE_ICON = 'kanban-square';

/**
 * The `.base` file the ribbon icon opens, until the user names another one.
 *
 * A board is a Bases view, and a Bases view lives in a `.base` file, so the
 * plugin has to have one to open. `examples/lattice-board.base` is the file
 * that ships with it, and the name a vault that followed the readme has.
 */
export const DEFAULT_BOARD_FILE = 'lattice-board.base';

/** The Bases view type, registered with `registerBasesView`. */
export const LATTICE_BASES_VIEW_TYPE = 'lattice-board';

/**
 * Keys for `BasesViewConfig`. These end up as keys in the view entry of the
 * `.base` file, so they are as much a part of the saved format as a command id
 * is.
 *
 * The `lattice` prefix is not decoration. `groupBy`, `order`, `filters`,
 * `summaries` and `limit` all belong to the core Bases plugin, and the Bases
 * syntax reference asks plugin views not to collide with core keys — a bare
 * `groupBy` would sit next to the core one and mean something different.
 */
export const OPTION_GROUP_BY = 'latticeGroupBy';
export const OPTION_SHOW_PROPERTY_NAMES = 'latticeShowPropertyNames';

/**
 * Whether a card carries the note's opening paragraph under its title.
 *
 * Bases has no property that holds a note's body, so this is the one thing on
 * a card that Lattice reads for itself rather than asking the query for. It is
 * a view option like the other two so a board full of notes that open with a
 * heading and nothing else can turn the blank line off.
 */
export const OPTION_SHOW_DESCRIPTION = 'latticeShowDescription';

/**
 * Column state, written by `BasesViewConfig.set` after the user moves or
 * deletes a column rather than declared in `BasesViewRegistration.options`.
 *
 * They are not options: nothing in the view-options menu should ever offer
 * "column order" as a field to type into. They are state the board records
 * about itself, and they live in the `.base` file because that is where the
 * view's own configuration belongs — next to the data it applies to.
 */
export const OPTION_COLUMN_ORDER = 'latticeColumnOrder';
export const OPTION_REMOVED_COLUMNS = 'latticeRemovedColumns';

/**
 * Columns added by hand, which are drawn while they are empty.
 *
 * A board's columns come from the data, so this is what makes a column exist
 * for a value no note carries yet — the value the first card of that column is
 * about to be given. Like the two above it is state rather than an option, and
 * for the same reason: it is a list of values, not a field to type into.
 */
export const OPTION_ADDED_COLUMNS = 'latticeAddedColumns';

/**
 * Drag payload types, one per thing that can be dragged.
 *
 * Two drags share the same board and the same drop zones, so neither may be
 * inferred from where the drag happens: the payload says what is being moved,
 * and every handler only reacts to the type it owns. `text/plain` is
 * deliberately not set — a card dropped on a note should not paste a path, and
 * Obsidian's own drag sessions should not pick one of these up as a file.
 */
export const LATTICE_CARD_DRAG_TYPE = 'application/x-lattice-card';
export const LATTICE_COLUMN_DRAG_TYPE = 'application/x-lattice-column';
