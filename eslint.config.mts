import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		// Dev tooling: a Node deploy helper and a snippet the user pastes into
		// Obsidian's console. Neither ships, so the rules that guard plugin
		// source (no Node built-ins, no console) do not apply to them.
		'scripts',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Tests run under Node, never inside Obsidian, so the rules that keep
		// the plugin bundle free of Node built-ins describe nothing they do.
		// The floating-promise rule goes with them: `it(...)` returns a promise
		// that belongs to the test runner, which is the one thing supposed to
		// await it.
		files: ['**/*.test.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
);
