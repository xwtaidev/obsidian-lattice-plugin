#!/usr/bin/env node
/**
 * Runs the unit tests.
 *
 * There is no test framework here on purpose: `node:test` ships with Node, and
 * esbuild is already a dependency, so the whole runner is a bundle and a spawn.
 * That keeps a second toolchain out of a plugin whose build is one esbuild
 * call.
 *
 * Tests live next to the source they cover as `*.test.ts` and are never part
 * of the plugin bundle — `main.js` is built from `src/main.ts`, and nothing
 * there imports a test file.
 *
 * Usage: npm test
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Every `*.test.ts` under a directory, at any depth. */
function findTests(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...findTests(path));
		} else if (entry.name.endsWith('.test.ts')) {
			found.push(path);
		}
	}
	return found;
}

const tests = findTests(SRC);
if (tests.length === 0) {
	console.error('No *.test.ts files found under src/.');
	process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), 'lattice-tests-'));

try {
	await build({
		entryPoints: tests,
		outdir: out,
		// A test file names the module it covers, so `description.test.js`
		// comes out of the box; the tree under src/ is flat enough that two
		// files cannot collide on one output name without colliding on input.
		outbase: SRC,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node20',
		// The tests exercise pure modules. `obsidian` is types-only where it
		// appears at all, and it cannot be imported outside the app, so leaving
		// it external keeps a real accidental import loud rather than bundled.
		external: ['obsidian'],
		absWorkingDir: ROOT,
		logLevel: 'warning',
	});

	const bundles = tests.map((file) =>
		join(out, file.slice(SRC.length + 1).replace(/\.ts$/, '.js')),
	);
	const result = spawnSync(process.execPath, ['--test', ...bundles], { stdio: 'inherit' });
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(out, { recursive: true, force: true });
}
