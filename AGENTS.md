# Obsidian community plugin: Lattice

## Project overview

- Plugin: **Lattice** (`id: lattice`) — a grid view over the vault. The feature
  set is not settled yet; `README.md` is a placeholder too.
- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.
- Current state: scaffold. Lifecycle, view registration, one command and a
  settings tab all work; the grid renders empty cells.
    - `src/main.ts` — lifecycle, view registration, commands, settings loading (keep it small).
    - `src/commands.ts` — `addCommand` calls.
    - `src/settings.ts` — the settings interface, `DEFAULT_SETTINGS`, and the settings tab.
    - `src/constants.ts` — stable ids and the icon name.
    - `src/ui/lattice-view.ts` — the grid view.

## Environment & tooling

- Node.js: current LTS (Node 18+ is fine). CI runs the build on Node 20, 22 and 24.
- **Package manager: npm** (`package.json` defines the scripts and dependencies).
  `package-lock.json` is committed on purpose.
- **Bundler: esbuild** (`esbuild.config.mjs`). Keep the `external` list in step
  with the entry points — anything not bundled has to exist in Obsidian already.
- Types: the `obsidian` package ships them; there is no `@types/obsidian`.
- `npm run build` type-checks with `tsc -noEmit` and then bundles. A type error
  fails the build, so the bundle on disk is never from unchecked source.

```bash
npm install
npm run dev            # watch
npm run build          # type-check + production bundle
npm run lint
npm run check:manifest
npm run deploy -- <vault-path>
```

## Coding conventions

- TypeScript with `"strict": true`, plus `noUncheckedIndexedAccess`. Indexed and
  destructured reads are `T | undefined`; handle them rather than asserting.
- Tabs for indentation, single quotes, LF. `.editorconfig` covers the editor side.
- **Keep `main.ts` minimal**: lifecycle only — loading, unloading, registering
  views, commands and the settings tab. Feature logic lives in its own module.
- **Split large files**: past roughly 200-300 lines, break it up.
- Bundle everything into `main.js`. No unbundled runtime dependencies.
- Use Obsidian's DOM helpers (`createDiv`, `createEl`) instead of `innerHTML`.
  Never build a node from a string that includes vault content.
- Avoid direct `document` / `window`: use `this.app.workspace` and `activeWindow`
  so the plugin keeps working in pop-out windows.

## Registering things (and cleaning them up)

Every listener, interval and DOM event goes through a `register*` helper, so
unloading the plugin cannot leak it:

```ts
this.registerEvent(this.app.workspace.on('file-open', (file) => { /* ... */ }));
this.registerDomEvent(activeWindow, 'resize', () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

Views registered with `registerView` are detached by Obsidian on unload — do not
call `detachLeavesOfType` from `onunload`.

## Commands & settings

- User-facing actions go through `this.addCommand(...)`; see `src/commands.ts`.
- Command IDs are stable API — a hotkey is stored against the ID, so renaming one
  loses that hotkey. Lower case, hyphenated, and never change an ID after release.
- Settings are persisted with `loadData()` / `saveData()`. New fields must have a
  default in `DEFAULT_SETTINGS`, because a vault upgrading from an older version
  only has the fields it saved.
- After a setting changes, re-render whatever is on screen; a grid left showing
  the previous value reads as a bug.

## Manifest rules (`manifest.json`)

- Required: `id`, `name`, `version` (SemVer `x.y.z`), `minAppVersion`,
  `description`, `isDesktopOnly`. Optional: `author`, `authorUrl`, `fundingUrl`.
- Never change `id` after release. Treat it as stable API.
- Raise `minAppVersion` only when a new API actually needs it.
- The description: at most 250 characters, no em dashes, no colons, no quotes, no
  emoji, no "Obsidian", and it ends with a period.
- `npm run check:manifest` codes all of the above. Run it before tagging —
  the directory's automated review rejects over these, and a rejection can only
  be fixed by publishing another release.

## Versioning & releases

- Bump `manifest.json`'s `version`, and keep `versions.json` mapping the plugin
  version to `minAppVersion`.
- Tag exactly as the version, with no leading `v`. `.github/workflows/release.yml`
  builds and opens a draft release with `main.js`, `manifest.json` and
  `styles.css` attached.

## Testing

- Manual install: copy `main.js`, `manifest.json`, `styles.css` to
  `<Vault>/.obsidian/plugins/lattice/`, reload Obsidian, enable the plugin in
  **Settings → Community plugins**.
- `npm run deploy -- <vault-path>` does the copy and then verifies the files
  landed byte for byte.
- There is no test runner yet. If logic with real invariants appears (parsing,
  scheduling, anything with dates), add one rather than testing by hand.

## Security, privacy, and compliance

Follow Obsidian's Developer Policies and Plugin Guidelines:

- Default to local, offline operation. No network request without a user-facing
  reason, disclosed in `README.md`.
- No telemetry. No remote code, no fetching and evaluating scripts, no
  self-updating outside normal releases.
- Read and write only inside the vault.
- Register and clean up everything, so the plugin unloads without a trace.

## UX & copy guidelines

- Sentence case for headings, buttons and titles.
- Action-oriented imperatives in step-by-step copy; **bold** for literal UI labels.
- Arrow notation for navigation: **Settings → Community plugins**.
- Prefer "select" over "click".

## Performance

- Defer heavy work out of `onload`; start light and initialise lazily.
- Batch disk access, avoid repeated vault scans, debounce filesystem events.

## Mobile

- `isDesktopOnly` is `false`, so avoid Node and Electron APIs.
- Test on iOS and Android where feasible; be mindful of memory and storage.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
