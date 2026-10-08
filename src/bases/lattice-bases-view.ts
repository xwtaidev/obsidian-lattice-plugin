import { BasesView, Menu, Notice, NullValue, TFile, getLanguage, setIcon } from 'obsidian';
import type { BasesEntry, BasesPropertyId, QueryController, WorkspaceLeaf } from 'obsidian';
import {
	LATTICE_BASES_VIEW_TYPE,
	LATTICE_CARD_DRAG_TYPE,
	LATTICE_COLUMN_DRAG_TYPE,
	OPTION_ADDED_COLUMNS,
	OPTION_COLUMN_ORDER,
	OPTION_GROUP_BY,
	OPTION_REMOVED_COLUMNS,
	OPTION_SHOW_DESCRIPTION,
	OPTION_SHOW_PROPERTY_NAMES,
} from '../constants';
import type LatticePlugin from '../main';
import { ConfirmModal } from '../ui/confirm-modal';
import { TextPromptModal } from '../ui/text-prompt-modal';
import { isBoardProperty } from './board-properties';
import { extractDescription } from './description';
import { DRAWER_CONTAINER_CLASS, NEW_TAB_CLASS, NEW_TAB_ICON, newTabLabel } from './drawer-action';
import { searchCardTitles } from './search-scope';
import { ValuePalette } from './value-colors';
import {
	buildColumns,
	cardDropIndex,
	columnKey,
	moveColumn,
	reorderByDrop,
	restorableColumns,
	writablePropertyKey,
	type ColumnNaming,
	type ColumnState,
	type LatticeColumn,
	type MissingValue,
} from './grouping';

/**
 * `config.get` returns `unknown`: the value comes from a `.base` file the user
 * can edit by hand. Anything that is not a list of strings counts as absent —
 * a malformed file should collapse to the default board, not error out.
 */
function readStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === 'string');
}

/**
 * What this board counts as no value.
 *
 * `BasesEntry.getValue` answers with a `NullValue` — a real object, whose
 * `toString()` is the text "null" — rather than `null` when a note does not
 * carry the property, so notes without one would each get a column named
 * `null`. Both tests are used. Identity is how core itself decides: its own
 * grouping folds a falsy value into `NullValue.value` and calls a key equal to
 * that "the one without a value", and the class is documented as a singleton.
 * `instanceof` then also catches the value if it came from the copy of the
 * class a popout window holds.
 */
const IS_MISSING: MissingValue = (value) =>
	value === null || value === NullValue.value || value instanceof NullValue;

/**
 * What to call the column that collects the notes nobody gave a value.
 *
 * It names an absence, so no note spells it and it cannot be read off the data;
 * and unlike a file property there is nothing in the app to borrow the word
 * from — core's own group headings say `None` for the same column. The board
 * this one is modelled on calls it `未分组`, which is the column the user is
 * looking for by that name, so the app's language decides the whole word and
 * everything else on the board stays English.
 */
function noValueLabel(): string {
	const language = getLanguage();
	if (language === 'zh-TW') {
		return '未分組';
	}

	return language.startsWith('zh') ? '未分组' : 'Ungrouped';
}

const NAMING: ColumnNaming = { noValue: noValueLabel(), allNotes: 'All notes' };

/**
 * The tallest the slot under a dragged card is drawn.
 *
 * A card is as tall as its description makes it. A dashed box the height of a
 * five-line card stops reading as a place one is about to go and starts reading
 * as a card that failed to load, so a long card is stood in for by a shorter
 * one — the slot has already said which card it is by then.
 */
const CARD_SLOT_MAX_HEIGHT = 200;

/** What a card drag carries: which note, and which column it started in. */
interface CardDragPayload {
	path: string;
	/** `columnKey` of the column the card was dragged out of. */
	column: string;
}

function readCardDrag(transfer: DataTransfer): CardDragPayload | null {
	const raw = transfer.getData(LATTICE_CARD_DRAG_TYPE);
	if (raw.length === 0) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object') {
			return null;
		}
		const record = parsed as Record<string, unknown>;
		const path = record['path'];
		const column = record['column'];
		return typeof path === 'string' && typeof column === 'string' ? { path, column } : null;
	} catch {
		// Not a payload this plugin wrote. Ignore, rather than throw mid-drop.
		return null;
	}
}

/**
 * The drag types in flight.
 *
 * A drag's data is unreadable while it is still going, but its *types* are, and
 * that is the only thing a `dragover` needs in order to decide which kind of
 * drag it is looking at.
 */
function dragTypes(transfer: DataTransfer): string[] {
	return Array.from(transfer.types);
}

/** A column under the pointer, plus which of its halves the pointer is in. */
interface ColumnHit {
	el: HTMLElement;
	/** True when the pointer is past the column's midpoint. */
	after: boolean;
}

/**
 * A note's description, and what it was read from.
 *
 * Reading a note body is a disk read, and the board redraws on every change to
 * the query, so the text is kept and checked against the file's stat rather
 * than read again. `text` is `null` for a note that has nothing to summarise —
 * caching that too is what stops such a note from being re-read on every
 * redraw, which would be the most expensive way to keep showing nothing.
 */
interface DescriptionEntry {
	mtime: number;
	size: number;
	text: string | null;
}

/**
 * The board, as a Bases view.
 *
 * The spike answers one question: can Bases carry a wolai-style board, or does
 * the data layer have to be written by hand? Everything here is the thinnest
 * thing that renders real data — no swimlanes yet.
 */
export class LatticeBasesView extends BasesView {
	private readonly containerEl: HTMLElement;

	/**
	 * Column order as the board last drew it.
	 *
	 * Columns are derived from the data in the order their first entry appears,
	 * so moving a card can rearrange the board underneath the drag that caused
	 * it: drag the only Backlog card to Done and Backlog is no longer the first
	 * value in the list, which shunts the remaining columns around and drops the
	 * new one at the front. Redrawing in the order the board last drew is what
	 * stops that.
	 *
	 * It is a fallback only — an explicit `latticeColumnOrder` still wins — and
	 * it is not persisted, so a layout worth keeping is pinned by moving a
	 * column, which writes the order into the `.base` file.
	 */
	private drawnOrder: string[] = [];

	/** The grouping property `drawnOrder` was recorded for. */
	private drawnGroupBy: BasesPropertyId | null = null;

	/**
	 * Colours for the values currently on the board.
	 *
	 * Replaced on every render rather than carried over, so a value that has
	 * left the data stops holding a colour the values still on the board could
	 * be using. See `ValuePalette`.
	 */
	private palette = new ValuePalette();

	/**
	 * Descriptions read out of note bodies, keyed by path.
	 *
	 * Kept across renders because the read is a disk access and a redraw is
	 * triggered by anything from a keystroke in another pane to a card being
	 * dropped. Bounded by the notes this board has actually shown.
	 */
	private readonly descriptions = new Map<string, DescriptionEntry>();

	/**
	 * Which render is current.
	 *
	 * A description arrives after the board has already been drawn, and the
	 * render after that one may have replaced the element it was going to be
	 * written into. The number is how a late answer tells that it is stale: the
	 * card that asked for it is gone, and the card that replaced it is asking
	 * for the same thing.
	 */
	private renderGeneration = 0;

	/**
	 * The one element currently wearing each drop affordance.
	 *
	 * One at a time, because only one column can be under the pointer — and
	 * clearing the previous one from here, on the next `dragover`, is also what
	 * keeps `dragleave` noise from strobing the whole board as the pointer
	 * crosses the gaps between cards.
	 */
	private cardDropTargetEl: HTMLElement | null = null;
	private columnIndicatorEl: HTMLElement | null = null;
	private columnIndicatorClass: string | null = null;

	/**
	 * The card a drag started from, for as long as it lasts.
	 *
	 * A drag's data cannot be read while it is still going — only its types can
	 * — and everything the feedback for a card drag needs is that data: what the
	 * card is called, how tall it is, and which column it came out of. So it is
	 * put down here on `dragstart`, where it is still readable, and the
	 * `dragover` that draws the slot reads it from here. Cleared on `dragend`.
	 *
	 * `null` while a card is being dragged in from somewhere else — a second
	 * board open beside this one, whose `dragstart` this view never saw. Such a
	 * card can still be dropped here; there is just less to say about it.
	 */
	private draggedCard: { title: string; height: number; from: string } | null = null;

	/**
	 * The slot showing where a dragged card would land, and where it is.
	 *
	 * The element is kept and moved rather than rebuilt: `dragover` fires for
	 * every pixel of the drag, and a redrawn element would restart its own
	 * layout each time. The neighbour it was last put in front of is kept with
	 * it, so "the pointer has not moved it" is a comparison of two references
	 * rather than an index to keep in step with the DOM.
	 */
	private cardSlotEl: HTMLElement | null = null;
	private cardSlotParent: HTMLElement | null = null;
	private cardSlotNext: Element | null = null;

	/**
	 * The right-sidebar leaf the last card opened in.
	 *
	 * Held on to rather than asking the workspace for the active sidebar leaf,
	 * so opening a card does not take over a panel the user put there. Once the
	 * user closes it the reference is stale, which `drawerLeafInUse` detects.
	 */
	private drawerLeaf: WorkspaceLeaf | null = null;

	/**
	 * The button added to whatever the drawer is showing, if one is up.
	 *
	 * The leaf is reused, so its view's actions are too: without holding the
	 * element there is no way to take the last one down before adding the next,
	 * and clicking through a board would stack a column of them along the
	 * header.
	 */
	private drawerAction: HTMLElement | null = null;

	constructor(
		private readonly plugin: LatticePlugin,
		controller: QueryController,
		containerEl: HTMLElement,
	) {
		super(controller);
		this.containerEl = containerEl;
	}

	/**
	 * A getter rather than a field: Obsidian reads `type` off the instance, and
	 * class fields are not assigned until after `super()` returns.
	 */
	get type(): string {
		return LATTICE_BASES_VIEW_TYPE;
	}

	onDataUpdated(): void {
		this.render();
	}

	private render(): void {
		const root = this.containerEl;
		root.empty();
		root.classList.add('lattice-board');
		this.renderGeneration += 1;

		// Core's property menu offers every property the vault has. A board is
		// the one thing that knows which of them it deals in, so it names the
		// two it keeps — when a note was created, when it last moved — and the
		// menu drops the rest of the file properties. Asked of core rather than
		// spelled out, because the label follows the app's language and a
		// `.base` file is allowed to rename it.
		this.plugin.propertyMenu.setKeptLabels([
			this.config.getDisplayName('file.ctime'),
			this.config.getDisplayName('file.mtime'),
		]);

		// A board is also the only way to the view list of the file it is
		// showing, which core's "Add view" needs and cannot reach on its own;
		// see `view-menu.ts`. Every render, because core assigns `config` after
		// the factory returns.
		this.plugin.viewMenu.remember(this.containerEl, this.config);

		// Core runs a search before a view is given any data, and the scope it
		// runs over is the view's own order — a table's columns. A board's order
		// is the fields on a card, which would leave the card's title out of the
		// search entirely; see `search-scope.ts`.
		searchCardTitles(this.config);

		// Whatever these pointed at went with the DOM.
		this.cardDropTargetEl = null;
		this.columnIndicatorEl = null;
		this.columnIndicatorClass = null;
		this.cardSlotEl = null;
		this.cardSlotParent = null;
		this.cardSlotNext = null;

		// Colours are handed out in draw order, so they are drawn again with the
		// board they belong to.
		this.palette = new ValuePalette();

		const groupBy = this.config.getAsPropertyId(OPTION_GROUP_BY);
		if (groupBy !== this.drawnGroupBy) {
			// A different property produces a different set of columns. Carrying
			// the old arrangement over would line up only where two properties
			// happen to share a value, which is worse than starting clean.
			this.drawnOrder = [];
			this.drawnGroupBy = groupBy;
		}

		const state = this.readColumnState();
		const columns = buildColumns(
			this.data.data,
			groupBy,
			{
				...state,
				// An order the user set explicitly wins. Otherwise keep drawing the
				// columns where they already are; see `drawnOrder`.
				order: state.order.length > 0 ? state.order : this.drawnOrder,
			},
			IS_MISSING,
			NAMING,
		);

		const board = root.createDiv({ cls: 'lattice-board-columns' });
		columns.forEach((column, index) => {
			board.appendChild(this.renderColumn(column, groupBy, index, columns));
		});
		this.renderAddColumn(board, groupBy, columns);
		this.drawnOrder = columns.map((column) => columnKey(column.value));

		this.wireBoardDragAndDrop(board, groupBy, columns);
	}

	private readColumnState(): ColumnState {
		return {
			order: readStringList(this.config.get(OPTION_COLUMN_ORDER)),
			removed: readStringList(this.config.get(OPTION_REMOVED_COLUMNS)),
			added: readStringList(this.config.get(OPTION_ADDED_COLUMNS)),
		};
	}

	private renderColumn(
		column: LatticeColumn,
		groupBy: BasesPropertyId | null,
		index: number,
		columns: LatticeColumn[],
	): HTMLElement {
		const columnEl = createDiv({ cls: 'lattice-column' });
		const key = columnKey(column.value);
		columnEl.dataset.value = key;

		const header = columnEl.createDiv({ cls: 'lattice-column-header' });
		this.renderColumnGrip(header, columnEl, column, key);
		// Name and count read as one label, so they sit together; the far edge of
		// the header belongs to the actions.
		this.renderColumnTitle(header, column);
		header.createSpan({ cls: 'lattice-column-count', text: String(column.entries.length) });

		const actions = header.createDiv({ cls: 'lattice-column-actions' });
		this.renderNewCardButton(actions, column, groupBy);
		this.renderColumnMenuButton(actions, column, groupBy, index, columns);

		const cards = columnEl.createDiv({ cls: 'lattice-column-cards' });
		for (const entry of column.entries) {
			cards.appendChild(this.renderCard(entry, groupBy, key));
		}

		return columnEl;
	}

	/**
	 * The column name, as a tag when it names a value.
	 *
	 * `No value` and `All notes` name the absence of a value, so they stay
	 * plain: a colour on them would claim a meaning the column does not have.
	 * Everything else is a value the notes actually carry, and it gets the same
	 * colour here that the same value gets anywhere else on the board.
	 */
	private renderColumnTitle(header: HTMLElement, column: LatticeColumn): void {
		const title = header.createSpan({ cls: 'lattice-column-title', text: column.label });
		if (column.value !== null) {
			title.addClass('lattice-label', this.palette.classFor(column.value));
		}
	}

	/**
	 * The handle a column is dragged by.
	 *
	 * Only this element starts a column drag, and that is what keeps the two
	 * drags apart: a drag that begins on a card moves the card, a drag that
	 * begins here moves the column, and neither can be mistaken for the other —
	 * no guessing from where the pointer happens to be.
	 */
	private renderColumnGrip(
		header: HTMLElement,
		columnEl: HTMLElement,
		column: LatticeColumn,
		key: string,
	): void {
		const grip = header.createSpan({
			cls: 'lattice-column-grip',
			attr: { 'aria-label': `Reorder the "${column.label}" column` },
		});
		setIcon(grip, 'grip-vertical');
		grip.draggable = true;

		grip.addEventListener('dragstart', (event) => {
			const transfer = event.dataTransfer;
			if (transfer === null) {
				return;
			}

			transfer.setData(LATTICE_COLUMN_DRAG_TYPE, key);
			transfer.effectAllowed = 'move';
			// Without this the drag ghost is the 16px glyph rather than the
			// column it is about to move.
			const rect = columnEl.getBoundingClientRect();
			transfer.setDragImage(columnEl, event.clientX - rect.left, event.clientY - rect.top);
			columnEl.classList.add('is-dragging');
		});
		grip.addEventListener('dragend', () => {
			this.finishDrag(columnEl);
		});
	}

	/**
	 * The `+` hands off to Obsidian's own new-note menu, so the folder and
	 * template come from the vault's settings instead of from a second copy of
	 * them kept here.
	 */
	private renderNewCardButton(
		parent: HTMLElement,
		column: LatticeColumn,
		groupBy: BasesPropertyId | null,
	): void {
		const key = groupBy === null ? null : writablePropertyKey(groupBy);
		if (key === null) {
			// A derived column has nothing to write, so do not offer the button.
			return;
		}

		const button = parent.createEl('button', {
			cls: 'clickable-icon lattice-column-action',
			attr: { type: 'button', 'aria-label': `New note in ${column.label}` },
		});
		setIcon(button, 'plus');
		button.addEventListener('click', (event) => {
			// Otherwise the click reaches the column behind the button.
			event.stopPropagation();
			void this.createCard(key, column.value);
		});
	}

	private renderColumnMenuButton(
		parent: HTMLElement,
		column: LatticeColumn,
		groupBy: BasesPropertyId | null,
		index: number,
		columns: LatticeColumn[],
	): void {
		const button = parent.createEl('button', {
			cls: 'clickable-icon lattice-column-action',
			attr: { type: 'button', 'aria-label': `Options for ${column.label}` },
		});
		setIcon(button, 'more-horizontal');
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			this.openColumnMenu(event, column, groupBy, index, columns);
		});
	}

	private openColumnMenu(
		event: MouseEvent,
		column: LatticeColumn,
		groupBy: BasesPropertyId | null,
		index: number,
		columns: LatticeColumn[],
	): void {
		// The order list is materialised from what is on screen right now, so a
		// move never has to reconcile with an order the user has not set.
		const keys = columns.map((candidate) => columnKey(candidate.value));
		const last = columns.length - 1;
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Move left')
				.setIcon('arrow-left')
				.setDisabled(index === 0)
				.onClick(() => {
					this.applyColumnOrder(moveColumn(keys, index, index - 1));
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Move right')
				.setIcon('arrow-right')
				.setDisabled(index === last)
				.onClick(() => {
					this.applyColumnOrder(moveColumn(keys, index, index + 1));
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Move to start')
				.setIcon('chevrons-left')
				.setDisabled(index === 0)
				.onClick(() => {
					this.applyColumnOrder(moveColumn(keys, index, 0));
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Move to end')
				.setIcon('chevrons-right')
				.setDisabled(index === last)
				.onClick(() => {
					this.applyColumnOrder(moveColumn(keys, index, last));
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Delete column')
				.setIcon('trash-2')
				.setWarning(true)
				.onClick(() => {
					void this.deleteColumn(column, groupBy);
				}),
		);

		menu.showAtMouseEvent(event);
	}

	private applyColumnOrder(order: string[]): void {
		this.config.set(OPTION_COLUMN_ORDER, order);
		this.render();
	}

	private async deleteColumn(
		column: LatticeColumn,
		groupBy: BasesPropertyId | null,
	): Promise<void> {
		const notes = column.entries.length;
		const count = `${String(notes)} ${notes === 1 ? 'note' : 'notes'}`;
		const restorable = groupBy !== null && writablePropertyKey(groupBy) !== null;
		// Say what actually happens. Deleting a column here frees nothing and
		// destroys nothing, and a dialog that let that be misread is worse than
		// no dialog at all.
		const body =
			`The column leaves this board. Its ${count} keep their properties; no file is modified.` +
			(restorable ? ' "Add column", at the end of the board, brings it back.' : '');

		const confirmed = await ConfirmModal.open(this.app, {
			title: `Delete the "${column.label}" column?`,
			body,
			confirmText: 'Delete column',
		});
		if (!confirmed) {
			return;
		}

		const { removed } = this.readColumnState();
		// The order and added lists are left alone: a column that is added back
		// later returns to the place the user had put it, not to the end.
		this.config.set(OPTION_REMOVED_COLUMNS, [...removed, columnKey(column.value)]);
		this.render();
	}

	/**
	 * The button that adds a column, after the last one.
	 *
	 * A column exists because a note carries its value, which leaves no way to
	 * set a board up: the value nobody has typed yet has nowhere to put the
	 * first card. It sits after the last column rather than in a toolbar so that
	 * the column it adds appears where it was asked for.
	 */
	private renderAddColumn(
		board: HTMLElement,
		groupBy: BasesPropertyId | null,
		columns: LatticeColumn[],
	): void {
		// A property that cannot be written — `file.name`, a formula — has no
		// value to store in a new column, so a column here would be a promise the
		// board cannot keep.
		if (groupBy === null || writablePropertyKey(groupBy) === null) {
			return;
		}

		const button = board.createEl('button', {
			cls: 'lattice-add-column',
			attr: { type: 'button', 'aria-label': 'Add a column to this board' },
		});
		setIcon(button.createSpan({ cls: 'lattice-add-column-icon' }), 'plus');
		button.createSpan({ cls: 'lattice-add-column-label', text: 'Add column' });
		button.addEventListener('click', (event) => {
			// Otherwise the click reaches the board behind the button.
			event.stopPropagation();
			void this.askForColumnName(groupBy, columns);
		});
	}

	private async askForColumnName(
		groupBy: BasesPropertyId,
		columns: LatticeColumn[],
	): Promise<void> {
		// Removing a column is a delete, so it needs an undelete in the same
		// place, and this dialog is that place: the button that adds a column is
		// the one that brings one back. Only columns the board can still name are
		// offered — one whose notes have all lost the value has nothing left to
		// call it.
		const restorable = restorableColumns(
			this.data.data,
			groupBy,
			this.readColumnState(),
			IS_MISSING,
			NAMING,
		);
		const value = await TextPromptModal.open(this.app, {
			title: 'Add column',
			body: 'The name becomes the value of the grouped property on every note you drop here.',
			placeholder: 'Column name',
			confirmText: 'Add column',
			suggestions: restorable.map((ref) => ({
				label: `Restore "${ref.label}"`,
				value: ref.key,
			})),
		});
		if (value === null) {
			return;
		}

		if (columns.some((column) => columnKey(column.value) === value)) {
			// A column named by a value the board already has is already there.
			// Saying so beats closing the dialog and changing nothing.
			new Notice(`"${value}" is already a column on this board.`);
			return;
		}

		this.addColumn(value);
	}

	/**
	 * Put a column on the board, or bring one back.
	 *
	 * The removed list has to be cleared of the value, or the column would be
	 * added and filtered straight back out. Both writes go through `config.set`
	 * rather than the plugin's own data, so the board keeps its column state in
	 * the `.base` file it belongs to.
	 */
	private addColumn(value: string): void {
		const state = this.readColumnState();
		this.config.set(
			OPTION_REMOVED_COLUMNS,
			state.removed.filter((key) => key !== value),
		);
		this.config.set(
			OPTION_ADDED_COLUMNS,
			state.added.includes(value) ? state.added : [...state.added, value],
		);
		this.render();
	}

	private async createCard(key: string, value: string | null): Promise<void> {
		await this.createFileForView(undefined, (frontmatter: Record<string, unknown>) => {
			// The new note is Obsidian's; this only fills in the property that
			// decides which column the card lands in.
			if (value !== null && value.length > 0) {
				frontmatter[key] = value;
			}
		});
	}

	private renderCard(
		entry: BasesEntry,
		groupBy: BasesPropertyId | null,
		fromColumn: string,
	): HTMLElement {
		const card = createDiv({ cls: 'lattice-card' });
		card.draggable = true;

		// The title and the description are one block rather than two rows: the
		// description is the second half of what the title says, so it sits
		// closer to the title than the properties do.
		const head = card.createDiv({ cls: 'lattice-card-head' });
		head.createDiv({ cls: 'lattice-card-title', text: entry.file.basename });
		if (this.config.get(OPTION_SHOW_DESCRIPTION) !== false) {
			this.renderDescription(head, entry.file);
		}

		const showNames = this.config.get(OPTION_SHOW_PROPERTY_NAMES) !== false;
		// The grouping value is left out: the column header already says it, and
		// repeating it on every card in the column is noise. What survives that
		// is then narrowed to the properties a board deals in — the toolbar's
		// property menu lists a file's path and size along with everything else,
		// and a card should not grow a row for them; see `board-properties.ts`.
		const properties = this.config
			.getOrder()
			.filter(
				(propertyId) =>
					propertyId !== groupBy && isBoardProperty(propertyId),
			);
		if (properties.length > 0) {
			// A wrapper rather than rows hanging off the card, so the gap between
			// the title and the properties can differ from the gap between one
			// property and the next.
			const fields = card.createDiv({ cls: 'lattice-card-fields' });
			for (const propertyId of properties) {
				this.renderCardRow(fields, entry, propertyId, showNames);
			}
		}

		card.addEventListener('dragstart', (event) => {
			const transfer = event.dataTransfer;
			if (transfer === null) {
				return;
			}

			transfer.setData(
				LATTICE_CARD_DRAG_TYPE,
				JSON.stringify({ path: entry.file.path, column: fromColumn }),
			);
			transfer.effectAllowed = 'move';
			// Measured here because this is the last moment the card can be
			// asked about itself — and because a slot left over from a drag
			// that ended without a `dragend` would otherwise stand in for this
			// card wearing the last one's title.
			this.removeCardSlot();
			this.draggedCard = {
				title: entry.file.basename,
				height: card.getBoundingClientRect().height,
				from: fromColumn,
			};
			card.classList.add('is-dragging');
		});
		card.addEventListener('dragend', () => {
			this.finishDrag(card);
		});
		card.addEventListener('click', (event) => {
			void this.openCard(entry, event);
		});

		return card;
	}

	/**
	 * The note's opening paragraph, under the title.
	 *
	 * Bases cannot hand a view the body of a note, so this is read from the
	 * markdown itself — off the main thread's critical path, and only once per
	 * edit; see `description.ts` for what comes out of it.
	 *
	 * The element is appended when the text arrives rather than reserved before
	 * it. A card whose note has nothing to summarise would otherwise carry an
	 * empty line, and a flex column charges its gap for that line even at zero
	 * height, so the card would be taller for saying nothing.
	 */
	private renderDescription(head: HTMLElement, file: TFile): void {
		const known = this.describe(file);
		if (known !== undefined) {
			if (known !== null) {
				head.createDiv({ cls: 'lattice-card-description', text: known });
			}
			return;
		}

		const generation = this.renderGeneration;
		void this.app.vault
			.cachedRead(file)
			.then((markdown) => {
				const text = extractDescription(markdown);
				this.descriptions.set(file.path, {
					mtime: file.stat.mtime,
					size: file.stat.size,
					text,
				});

				// The board was redrawn while this was being read, so the head
				// it was meant for is detached and its replacement is already
				// showing the same text.
				if (generation !== this.renderGeneration || !head.isConnected) {
					return;
				}

				if (text !== null) {
					head.createDiv({ cls: 'lattice-card-description', text });
				}
			})
			.catch(() => {
				// A note that cannot be read has no description. Caching the
				// miss is what stops every redraw from retrying a read that
				// already failed.
				this.descriptions.set(file.path, {
					mtime: file.stat.mtime,
					size: file.stat.size,
					text: null,
				});
			});
	}

	/**
	 * The description already read for a note.
	 *
	 * `undefined` is "not read yet" and `null` is "read, and there is nothing
	 * to show". They have to stay apart: only the first one should send the
	 * card back to the vault. Both the stat fields are compared, because a note
	 * saved twice within the resolution of one clock still grew or shrank.
	 */
	private describe(file: TFile): string | null | undefined {
		const entry = this.descriptions.get(file.path);
		if (entry === undefined) {
			return undefined;
		}

		if (entry.mtime !== file.stat.mtime || entry.size !== file.stat.size) {
			return undefined;
		}

		return entry.text;
	}

	/**
	 * A card click previews the note in the right sidebar instead of opening it
	 * over the board.
	 *
	 * The board is something you read from, and a board opened in the main area
	 * is the tab you are reading it in — opening a card there replaces the board
	 * with one of its own rows. The sidebar is the drawer: it collapses, it can
	 * be dragged wider, and its tab can be dragged into the main area when the
	 * note turns out to be worth a full page.
	 */
	private async openCard(entry: BasesEntry, event: MouseEvent): Promise<void> {
		// A card's values are links in their own right — tags, links, dates. A
		// click on one belongs to that link, so let it through untouched rather
		// than opening the card's note over the top of it.
		if (((event.target as Element | null)?.closest?.('a') ?? null) !== null) {
			return;
		}

		// Cmd/Ctrl keeps Obsidian's own meaning: somewhere else, which here is a
		// tab in the main area.
		if (event.ctrlKey || event.metaKey) {
			await this.app.workspace.openLinkText(entry.file.path, '', 'tab');
			return;
		}

		await this.openPreview(entry.file);
	}

	/**
	 * Open a note in the right sidebar, reusing a single leaf.
	 *
	 * Reusing, rather than splitting, is the difference between a preview and a
	 * pile: clicking through a board should leave one panel behind, not one per
	 * card. It is also why the leaf is remembered instead of borrowed from the
	 * sidebar — a preview must not land on top of a panel the user opened there
	 * themselves.
	 */
	private async openPreview(file: TFile): Promise<void> {
		const leaf = this.drawerLeafInUse() ?? this.app.workspace.getRightLeaf(false);
		if (leaf === null) {
			return;
		}

		this.drawerLeaf = leaf;
		await leaf.openFile(file);
		this.offerNewTab(leaf);
		await this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Put the way out of the drawer over the corner of what it is showing.
	 *
	 * A preview is the drawer by design — the board stays put and the note is
	 * read beside it — but a note in the sidebar cannot leave it, and Obsidian
	 * puts no way out on the header either: a drawer's header is hidden whole,
	 * which takes the view's own buttons (the bookmark, the reading-mode
	 * toggle, the menu) with it. So `addAction`, which writes into that header,
	 * writes somewhere invisible; the button goes into the view's content
	 * instead and is held against its top corner by styles.css.
	 *
	 * Only for a leaf in the right sidebar: it means "out of the drawer", and a
	 * tab that has been dragged into the main area is already out.
	 */
	private offerNewTab(leaf: WorkspaceLeaf): void {
		this.removeNewTab();

		if (leaf.getRoot() !== this.app.workspace.rightSplit) {
			return;
		}

		const container = leaf.view.containerEl;
		container.classList.add(DRAWER_CONTAINER_CLASS);
		const button = container.createEl('button', {
			cls: `clickable-icon ${NEW_TAB_CLASS}`,
			attr: { 'aria-label': newTabLabel(getLanguage()) },
		});
		setIcon(button, NEW_TAB_ICON);
		button.addEventListener('click', () => {
			void this.openInMainArea(leaf);
		});

		this.drawerAction = button;
	}

	/**
	 * Take the last button down, and the mark that placed it, before the next
	 * one goes up.
	 *
	 * The leaf is reused, so its view is too, and a button left behind would
	 * stay for every note the drawer goes on to show.
	 */
	private removeNewTab(): void {
		const button = this.drawerAction;
		this.drawerAction = null;
		if (button === null) {
			return;
		}

		const container = button.parentElement;
		button.remove();
		container?.classList.remove(DRAWER_CONTAINER_CLASS);
	}

	/**
	 * The note the drawer is showing, as a page of its own in the main area.
	 *
	 * Which note is asked of the view rather than remembered from the click, so
	 * the button keeps meaning the same thing after the drawer has been
	 * navigated — including by following a link inside the preview, which is
	 * exactly when a page of one's own is worth wanting.
	 */
	private async openInMainArea(leaf: WorkspaceLeaf): Promise<void> {
		const shown = (leaf.view as { file?: TFile | null }).file ?? null;
		if (shown === null) {
			return;
		}

		// Already a page of its own somewhere? Go there instead of opening a
		// second copy of it. The button means "show me this properly", and the
		// note being open already is the board answering that. A new tab every
		// press is also what pressing twice would otherwise leave behind.
		const already = this.mainAreaLeafFor(shown.path);
		if (already !== null) {
			await this.app.workspace.revealLeaf(already);
		} else {
			await this.app.workspace.openLinkText(shown.path, '', 'tab');
		}

		this.closeDrawer(leaf);
	}

	/**
	 * Take the drawer down, now that the note is somewhere it can be read.
	 *
	 * The panel was there to show the note *beside* the board; once the note
	 * has a page of its own the drawer would only show it a second time, and
	 * hold a column of the screen to do it. So it goes — and only it: a panel
	 * the user opened in the sidebar themselves is theirs, and a sidebar still
	 * holding one is not ours to fold.
	 *
	 * Detaching the leaf is what the sidebar notices: an empty side dock is
	 * put away, which is the same "out of the drawer" the button promises,
	 * said the same way whether or not Obsidian would have got there itself.
	 */
	private closeDrawer(leaf: WorkspaceLeaf): void {
		if (leaf.getRoot() !== this.app.workspace.rightSplit) {
			return;
		}

		if (this.drawerLeaf === leaf) {
			this.drawerLeaf = null;
		}

		this.removeNewTab();
		leaf.detach();
	}

	/** The leaf in the main area showing a note, if any is. */
	private mainAreaLeafFor(path: string): WorkspaceLeaf | null {
		const right = this.app.workspace.rightSplit;
		const left = this.app.workspace.leftSplit;
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found !== null) {
				return;
			}
			const root = leaf.getRoot();
			if (root === right || root === left) {
				return;
			}
			if ((leaf.view as { file?: TFile | null }).file?.path === path) {
				found = leaf;
			}
		});

		return found;
	}

	/**
	 * The remembered drawer leaf, or `null` once it is gone.
	 *
	 * A leaf the user closed is dead, and opening a note in it would show
	 * nothing, so the reference is dropped and the next click falls back to the
	 * sidebar's own leaf.
	 */
	private drawerLeafInUse(): WorkspaceLeaf | null {
		const remembered = this.drawerLeaf;
		if (remembered === null) {
			return null;
		}

		let alive = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === remembered) {
				alive = true;
			}
		});

		if (!alive) {
			this.drawerLeaf = null;
		}

		return alive ? remembered : null;
	}

	private renderCardRow(
		parent: HTMLElement,
		entry: BasesEntry,
		propertyId: BasesPropertyId,
		showName: boolean,
	): void {
		const row = parent.createDiv({ cls: 'lattice-card-row' });
		if (showName) {
			row.createSpan({
				cls: 'lattice-card-row-name',
				text: this.config.getDisplayName(propertyId),
			});
		}

		// `bases-rendered-value` is the class Obsidian puts on its own value
		// containers (`bases-cards-line`), and it is load bearing: it carries
		// `--input-border-width: 0` and the input resets that tell an input it is
		// a value being shown rather than a field being edited. A date renders as
		// an input, so without it a card shows a boxed form control in the middle
		// of a line of text.
		const valueEl = row.createSpan({ cls: 'lattice-card-row-value bases-rendered-value' });
		const value = entry.getValue(propertyId);
		// `IS_MISSING` covers `null` as well; it is spelled out here so the type
		// narrows for the render below, which takes a value and not a maybe.
		if (value === null || IS_MISSING(value)) {
			valueEl.classList.add('is-empty');
			valueEl.setText('—');
			return;
		}

		// Obsidian's own renderer, so links, tags and dates come out looking the
		// way they do everywhere else in the app.
		value.renderTo(valueEl, this.app.renderContext);
		// A link is draggable by default, and the browser would then drag the
		// link instead of the card it sits in.
		valueEl.querySelectorAll('a').forEach((anchor) => {
			anchor.draggable = false;
		});
		this.colorValue(valueEl);
	}

	/**
	 * Give a value its colour.
	 *
	 * A tag comes out of `renderTo` already looking like a pill, one per tag, so
	 * each gets a colour of its own and the row is left to wrap. A value that
	 * came out as plain text is the value, so the whole span becomes the pill —
	 * and it has to be the span, because the row clips what overflows it and the
	 * padding of an inline child is painted outside its own line box.
	 *
	 * Anything else — a link, a date — is left exactly as Obsidian drew it. It
	 * is already telling the reader what it is, and the class on the cell is
	 * what keeps a date a line of text rather than a form control.
	 */
	private colorValue(valueEl: HTMLElement): void {
		const tags = valueEl.querySelectorAll('.tag');
		if (tags.length > 0) {
			valueEl.addClass('has-tags');
			tags.forEach((tag) => {
				tag.addClass(this.palette.classFor(tag.textContent ?? ''));
			});
			return;
		}

		if (valueEl.childElementCount > 0) {
			return;
		}

		const text = valueEl.textContent;
		if (text !== null && text.length > 0) {
			valueEl.addClass('is-chip', this.palette.classFor(text));
		}
	}

	/**
	 * One set of drag handlers for the whole board.
	 *
	 * Nothing is wired per column. The column under the pointer is looked up
	 * from the event, so there is one place that decides what a drag means and
	 * one element wearing a drop affordance at any given moment.
	 */
	private wireBoardDragAndDrop(
		board: HTMLElement,
		groupBy: BasesPropertyId | null,
		columns: LatticeColumn[],
	): void {
		// Whether this board can take a card at all. A grouping property that is
		// derived (`file.name`, `formula.x`) has nothing to write back to, so no
		// column on this board accepts a card and none of them should say they
		// do.
		const cardKey = groupBy === null ? null : writablePropertyKey(groupBy);

		board.addEventListener('dragover', (event) => {
			const transfer = event.dataTransfer;
			if (transfer === null) {
				return;
			}

			const types = dragTypes(transfer);
			if (types.includes(LATTICE_COLUMN_DRAG_TYPE)) {
				// A dragged column is looking for a slot *between* columns, which
				// is why it gets a rule rather than a lit-up column.
				event.preventDefault();
				transfer.dropEffect = 'move';
				const hit = this.columnAt(board, event);
				this.setColumnIndicator(hit?.el ?? null, hit?.after ?? false);
				return;
			}

			if (types.includes(LATTICE_CARD_DRAG_TYPE)) {
				this.showCardDrop(transfer, event, board, cardKey);
			}
			// Anything else — a file from Finder, a drag from another pane — is
			// left alone: no preventDefault, so the board does not accept it.
		});

		board.addEventListener('drop', (event) => {
			const transfer = event.dataTransfer;
			const hit = this.columnAt(board, event);
			this.clearDropFeedback();
			if (transfer === null) {
				return;
			}

			const types = dragTypes(transfer);
			if (types.includes(LATTICE_COLUMN_DRAG_TYPE)) {
				event.preventDefault();
				this.dropColumn(transfer, hit, columns);
				return;
			}

			if (types.includes(LATTICE_CARD_DRAG_TYPE)) {
				event.preventDefault();
				void this.dropCard(transfer, hit, groupBy);
			}
		});
	}

	/**
	 * The column the pointer is over, with which half of it the pointer is in.
	 *
	 * The pointer spends real time in the gaps between columns, where the event
	 * target is the board itself; falling back to the nearest column keeps the
	 * indicator from blinking out every time it crosses one.
	 */
	private columnAt(board: HTMLElement, event: DragEvent): ColumnHit | null {
		const under = (event.target as Element | null)?.closest?.('.lattice-column') ?? null;
		const el =
			under !== null && under.instanceOf(HTMLElement) && board.contains(under)
				? under
				: this.nearestColumn(board, event.clientX);
		if (el === null) {
			return null;
		}

		const rect = el.getBoundingClientRect();
		return { el, after: event.clientX >= rect.left + rect.width / 2 };
	}

	private nearestColumn(board: HTMLElement, clientX: number): HTMLElement | null {
		let nearest: HTMLElement | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;

		for (const child of Array.from(board.children)) {
			// `instanceOf`, not `instanceof`: the check has to hold for nodes from
			// the popout windows too.
			if (!child.instanceOf(HTMLElement) || !child.classList.contains('lattice-column')) {
				continue;
			}

			const rect = child.getBoundingClientRect();
			const distance =
				clientX < rect.left ? rect.left - clientX : Math.max(0, clientX - rect.right);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearest = child;
			}
		}

		return nearest;
	}

	private setCardDropTarget(el: HTMLElement | null): void {
		if (this.cardDropTargetEl === el) {
			return;
		}

		this.cardDropTargetEl?.classList.remove('is-card-drop-target');
		this.cardDropTargetEl = el;
		el?.classList.add('is-card-drop-target');
	}

	/**
	 * What a card being dragged over the board looks like.
	 *
	 * Two things, because they answer two questions: the column under the
	 * pointer lights up — *which* column — and a slot opens in its list, in
	 * front of the cards the pointer has not reached — *where* in it. The card's
	 * own title goes in the slot, so what is being moved stays legible after the
	 * browser's drag image has been dragged off the edge of the window.
	 *
	 * A column that would do nothing with the card gets neither. Dropping a card
	 * back where it already is, or anywhere at all on a board whose columns come
	 * from a property that cannot be written, is not a move — and lighting a
	 * column up is this board promising that it is. The drag is handed back to
	 * the browser there instead, which is where a cursor saying "no drop" comes
	 * from without a word of it in the plugin.
	 */
	private showCardDrop(
		transfer: DataTransfer,
		event: DragEvent,
		board: HTMLElement,
		cardKey: string | null,
	): void {
		const hit = this.columnAt(board, event);
		// An unknown origin — a card dragged in from another board — is never
		// the column under the pointer, which is what the `?.` says.
		const from = this.draggedCard?.from ?? null;
		if (hit === null || cardKey === null || from === hit.el.dataset.value) {
			transfer.dropEffect = 'none';
			this.setCardDropTarget(null);
			this.removeCardSlot();
			return;
		}

		event.preventDefault();
		transfer.dropEffect = 'move';
		this.setCardDropTarget(hit.el);
		this.setCardSlot(hit.el, event.clientY);
	}

	/**
	 * Open the slot in a column's list, in front of the first card the pointer
	 * has not passed the middle of.
	 *
	 * The slot takes up room, which is the point of it — the cards under it move
	 * down by the amount they are about to move down by. It is also why the slot
	 * is skipped when the midpoints are measured: it is not one of the cards the
	 * pointer is choosing between, and counting it would make the slot's own
	 * height part of the answer to where the slot goes.
	 */
	private setCardSlot(columnEl: HTMLElement, clientY: number): void {
		const list = columnEl.querySelector<HTMLElement>('.lattice-column-cards');
		if (list === null) {
			this.removeCardSlot();
			return;
		}

		const cards = Array.from(list.children).filter((child) => child !== this.cardSlotEl);
		const index = cardDropIndex(
			cards.map((card) => {
				const rect = card.getBoundingClientRect();
				return rect.top + rect.height / 2;
			}),
			clientY,
		);
		const next = cards[index] ?? null;

		if (this.cardSlotEl !== null && this.cardSlotParent === list && this.cardSlotNext === next) {
			return;
		}

		this.cardSlotParent = list;
		this.cardSlotNext = next;
		this.cardSlotEl ??= this.createCardSlot();
		list.insertBefore(this.cardSlotEl, next);
	}

	/**
	 * The slot itself: a dashed outline of the card being dragged, wearing its
	 * title, as tall as the card it stands in for.
	 *
	 * A card dragged in from another board arrives here with nothing known about
	 * it, so it gets an empty slot of the same shape — the drag still says which
	 * column it is over, which is all this view can honestly say.
	 */
	private createCardSlot(): HTMLElement {
		const slot = createDiv({ cls: 'lattice-card-slot' });
		const card = this.draggedCard;
		if (card === null) {
			return slot;
		}

		slot.style.height = `${Math.min(card.height, CARD_SLOT_MAX_HEIGHT)}px`;
		slot.createDiv({ cls: 'lattice-card-slot-title', text: card.title });
		return slot;
	}

	private removeCardSlot(): void {
		this.cardSlotEl?.remove();
		this.cardSlotEl = null;
		this.cardSlotParent = null;
		this.cardSlotNext = null;
	}

	private setColumnIndicator(el: HTMLElement | null, after: boolean): void {
		const cls = after ? 'is-drop-after' : 'is-drop-before';
		if (this.columnIndicatorEl === el && this.columnIndicatorClass === cls) {
			return;
		}

		this.columnIndicatorEl?.classList.remove('is-drop-before', 'is-drop-after');
		this.columnIndicatorEl = el;
		this.columnIndicatorClass = cls;
		el?.classList.add(cls);
	}

	private clearDropFeedback(): void {
		this.cardDropTargetEl?.classList.remove('is-card-drop-target');
		this.cardDropTargetEl = null;
		this.removeCardSlot();
		this.columnIndicatorEl?.classList.remove('is-drop-before', 'is-drop-after');
		this.columnIndicatorEl = null;
		this.columnIndicatorClass = null;
	}

	/**
	 * End of a drag, whatever it was: the dragged element stops looking dragged
	 * and no column is left lit up. A drag that ends outside the board — Escape,
	 * or a drop on another pane — lands here too, which is why the cleanup
	 * hangs off `dragend` on the source rather than off `drop`.
	 */
	private finishDrag(dragged: HTMLElement): void {
		dragged.classList.remove('is-dragging');
		this.draggedCard = null;
		this.clearDropFeedback();
	}

	private dropColumn(
		transfer: DataTransfer,
		hit: ColumnHit | null,
		columns: LatticeColumn[],
	): void {
		if (hit === null) {
			return;
		}

		const dragged = transfer.getData(LATTICE_COLUMN_DRAG_TYPE);
		const keys = columns.map((column) => columnKey(column.value));
		const from = keys.indexOf(dragged);
		const hovered = keys.indexOf(hit.el.dataset.value ?? '');
		if (from === -1 || hovered === -1) {
			return;
		}

		const next = reorderByDrop(keys, from, hovered, hit.after);
		// Dropped back where it started: leave the `.base` file untouched.
		if (next.every((key, index) => key === keys[index])) {
			return;
		}

		this.applyColumnOrder(next);
	}

	private async dropCard(
		transfer: DataTransfer,
		hit: ColumnHit | null,
		groupBy: BasesPropertyId | null,
	): Promise<void> {
		const payload = readCardDrag(transfer);
		if (payload === null || hit === null) {
			return;
		}

		const key = groupBy === null ? null : writablePropertyKey(groupBy);
		const target = hit.el.dataset.value ?? '';
		// A derived column has nothing to write, and a card dropped back where it
		// started would rewrite the note to no effect.
		if (key === null || payload.column === target) {
			return;
		}

		await this.moveCard(payload.path, key, target);
	}

	private async moveCard(path: string, key: string, value: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return;
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			if (value.length === 0) {
				delete frontmatter[key];
				return;
			}
			frontmatter[key] = value;
		});
	}
}
