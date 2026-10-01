import type { BasesAllOptions } from 'obsidian';
import {
	LATTICE_BASES_VIEW_TYPE,
	LATTICE_ICON,
	OPTION_GROUP_BY,
	OPTION_SHOW_DESCRIPTION,
	OPTION_SHOW_PROPERTY_NAMES,
} from '../constants';
import type LatticePlugin from '../main';
import { LatticeBasesView } from './lattice-bases-view';

/**
 * Register the board as a Bases view.
 *
 * `registerBasesView` arrived in Obsidian 1.10.0, but `BasesView.createFileForView`
 * — what the column's `+` button uses to add a note — is 1.10.2, and that is
 * what `minAppVersion` now tracks. There is nothing to guard against at runtime:
 * on anything older the plugin cannot be installed in the first place.
 */
export function registerLatticeBasesView(plugin: LatticePlugin): boolean {
	return plugin.registerBasesView(LATTICE_BASES_VIEW_TYPE, {
		name: 'Lattice board',
		icon: LATTICE_ICON,
		factory: (controller, containerEl) => new LatticeBasesView(controller, containerEl),
		options: (): BasesAllOptions[] => [
			{
				type: 'property',
				key: OPTION_GROUP_BY,
				displayName: 'Group by',
				placeholder: 'Choose a property',
			},
			{
				type: 'toggle',
				key: OPTION_SHOW_PROPERTY_NAMES,
				displayName: 'Show property names',
				default: true,
			},
			{
				type: 'toggle',
				key: OPTION_SHOW_DESCRIPTION,
				displayName: 'Show note description',
				default: true,
			},
		],
	});
}
