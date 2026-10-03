# Lattice

**Status: spike.** A board is a Bases view, so it lives in a `.base` file rather
than in a view of its own; the Lattice icon opens that file, and the file is kept
out of the file explorer. `docs/board-spike.md` keeps what the spike has settled
apart from what it has not.

## What it does

A kanban board of your notes. Columns are the values of a property, cards are
notes, and dragging a card into a column writes that value back to the note.

The same sentence is the one in `manifest.json` and `package.json`. It is
deliberately plain: the directory listing gives it a 250 character budget, and
it rejects a description containing the word "Obsidian", an em dash, a colon, a
quote or an emoji. `npm run check:manifest` enforces each of those.

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
  main.ts        lifecycle only: load settings, register the Bases view, the command and the settings tab
  commands.ts    addCommand calls, one per user-facing action
  settings.ts    the settings interface, its defaults, and the settings tab
  constants.ts   stable ids (plugin id, icon, the default board file)
  board-file.ts  keeps the board's `.base` file out of the file explorer
  bases/
    register.ts            registers the board as a Bases view
    lattice-bases-view.ts  the board itself: columns, cards, both drags, the menus
    grouping.ts            columns and their order, pure functions with tests
    description.ts         the note's opening paragraph, read for a card
    search-scope.ts        widens a board's search to the card titles
    board-properties.ts    which properties a board deals in
    property-menu.ts       keeps core's property menu down to those
    view-menu.ts           makes core's "Add view" add a board
    value-colors.ts        one colour per value, out of Obsidian's own eight
    drawer-action.ts       the "open in a new tab" button a sidebar preview wears
  ui/
    confirm-modal.ts       a confirmation dialog (core has no public one)
    text-prompt-modal.ts   a one-line prompt (core has no public one)
examples/
  lattice-board.base       a base to try the board view on
```

## Releasing

1. Bump `version` in `manifest.json` (SemVer), then run `npm version minor` (or
   `patch`/`major`) — that updates `versions.json` through `version-bump.mjs`.
2. Push the tag. `.github/workflows/release.yml` builds the plugin and opens a
   draft release with `main.js`, `manifest.json` and `styles.css` attached.
3. The tag must match `manifest.json`'s `version` exactly, with no leading `v`.

## License

MIT — see [LICENSE](LICENSE).
