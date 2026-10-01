/**
 * Stable identifiers.
 *
 * `PLUGIN_ID` and `VIEW_TYPE_LATTICE` are API once the plugin is released:
 * saved workspace layouts and user hotkeys refer to them by name, so renaming
 * either one silently breaks those for everyone who already installed it.
 */

/** Matches `id` in manifest.json and the folder name under `.obsidian/plugins/`. */
export const PLUGIN_ID = 'lattice';

/** The view type Obsidian registers for the grid. */
export const VIEW_TYPE_LATTICE = 'lattice-view';

/** Obsidian's built-in icon name, used for the ribbon button and the tab. */
export const LATTICE_ICON = 'layout-grid';
