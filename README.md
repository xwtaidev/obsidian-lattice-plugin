# Lattice

**Status: scaffold.** The plugin loads, registers its view, its command and its
settings tab. The grid currently draws one empty cell per configured column, so
the settings round-trip is visible on screen — feature work starts in
[`src/ui/lattice-view.ts`](src/ui/lattice-view.ts).

> The description in `manifest.json`, the one in `package.json`, and the
> "What it does" section below are all placeholders. Replace the three together.

## What it does

_Placeholder._ Write it for someone scrolling the community plugin directory:
one or two sentences, no marketing.

`manifest.json` has a 250 character budget for this, and the directory rejects a
submission whose description contains the word "Obsidian", an em dash, a colon,
a quote, or an emoji. `npm run check:manifest` enforces all of that.

## Installation

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in `<Vault>/.obsidian/plugins/lattice/`.
3. Reload Obsidian, then enable **Lattice** in **Settings → Community plugins**.

### From source

```bash
npm install
npm run build
npm run deploy -- <vault-path>
```

## Development

```bash
npm install
npm run dev            # esbuild in watch mode, rebuilds main.js on save
npm run build          # type-check, then a production bundle
npm run lint           # eslint, including eslint-plugin-obsidianmd
npm run check:manifest # the rules the community directory enforces
```

`npm run dev` rebuilds the bundle but does not copy it anywhere. Obsidian loads
`main.js` from the vault, so it has to get there:

```bash
npm run deploy -- <vault-path>
```

`npm run deploy` copies `main.js`, `manifest.json` and `styles.css` into
`<vault-path>/.obsidian/plugins/<manifest id>/`, then re-reads the copies to
compare them byte for byte. A stale `styles.css` left in a vault has shipped a
wrong-looking build before, which is what that last check is for.

After deploying, reload Obsidian with `Cmd`/`Ctrl`+`R` (or use the **Reload app
without saving** command) to pick up the new bundle.

## Layout

```
src/
  main.ts        lifecycle only: load settings, register view/command/settings tab
  commands.ts    addCommand calls, one per user-facing action
  settings.ts    the settings interface, its defaults, and the settings tab
  constants.ts   stable ids (plugin id, view type, icon)
  ui/
    lattice-view.ts  the grid
```

## Releasing

1. Bump `version` in `manifest.json` (SemVer), then run `npm version minor` (or
   `patch`/`major`) — that updates `versions.json` through `version-bump.mjs`.
2. Push the tag. `.github/workflows/release.yml` builds the plugin and opens a
   draft release with `main.js`, `manifest.json` and `styles.css` attached.
3. The tag must match `manifest.json`'s `version` exactly, with no leading `v`.

## License

MIT — see [LICENSE](LICENSE).
