import type LatticePlugin from './main';

/**
 * Commands are registered once, from `onload`.
 *
 * Command IDs are stable API: a user's hotkey is stored against the ID, so an
 * ID that gets renamed loses the hotkey. Keep them lower case and hyphenated.
 */
export function registerCommands(plugin: LatticePlugin): void {
	plugin.addCommand({
		id: 'open-board',
		name: 'Open board',
		callback: () => {
			void plugin.openBoard();
		},
	});
}
