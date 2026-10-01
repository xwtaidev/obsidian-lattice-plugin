import { BasesView, Menu, TFile, setIcon } from 'obsidian';
import type { BasesEntry, BasesPropertyId, QueryController, WorkspaceLeaf } from 'obsidian';
import {
	LATTICE_BASES_VIEW_TYPE,
	LATTICE_CARD_DRAG_TYPE,
	LATTICE_COLUMN_DRAG_TYPE,
	OPTION_COLUMN_ORDER,
	OPTION_GROUP_BY,
	OPTION_REMOVED_COLUMNS,
	OPTION_SHOW_DESCRIPTION,
	OPTION_SHOW_PROPERTY_NAMES,
} from '../constants';
import { ConfirmModal } from '../ui/confirm-modal';
import { extractDescription } from './description';
import { ValuePalette } from './value-colors';
import {
	buildColumns,
	columnKey,
	moveColumn,
	reorderByDrop,
	writablePropertyKey,
	type ColumnState,
	type LatticeColumn,
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
	 * The right-sidebar leaf the last card opened in.
	 *
	 * Held on to rather than asking the workspace for the active sidebar leaf,
	 * so opening a card does not take over a panel the user put there. Once the
	 * user closes it the reference is stale, which `drawerLeafInUse` detects.
	 */
	private drawerLeaf: WorkspaceLeaf | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement) {
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

		// Whatever these pointed at went with the DOM.
		this.cardDropTargetEl = null;
		this.columnIndicatorEl = null;
		this.columnIndicatorClass = null;

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
		const columns = buildColumns(this.data.data, groupBy, {
			...state,
			// An order the user set explicitly wins. Otherwise keep drawing the
			// columns where they already are; see `drawnOrder`.
			order: state.order.length > 0 ? state.order : this.drawnOrder,
		});

		const board = root.createDiv({ cls: 'lattice-board-columns' });
		columns.forEach((column, index) => {
			board.appendChild(this.renderColumn(column, groupBy, index, columns));
		});
		this.drawnOrder = columns.map((column) => columnKey(column.value));

		this.wireBoardDragAndDrop(board, groupBy, columns);
	}

	private readColumnState(): ColumnState {
		return {
			order: readStringList(this.config.get(OPTION_COLUMN_ORDER)),
			removed: readStringList(this.config.get(OPTION_REMOVED_COLUMNS)),
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
			(restorable
				? ' To bring it back, remove its entry from "latticeRemovedColumns" in this view\'s .base file.'
				: '');

		const confirmed = await ConfirmModal.open(this.app, {
			title: `Delete the "${column.label}" column?`,
			body,
			confirmText: 'Delete column',
		});
		if (!confirmed) {
			return;
		}

		const { removed } = this.readColumnState();
		// The order list is left alone: a column that is added back later returns
		// to the place the user had put it, not to the end.
		this.config.set(OPTION_REMOVED_COLUMNS, [...removed, columnKey(column.value)]);
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
		// repeating it on every card in the column is noise.
		const properties = this.config
			.getOrder()
			.filter((propertyId) => propertyId !== groupBy);
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
		await this.app.workspace.revealLeaf(leaf);
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

		const valueEl = row.createSpan({ cls: 'lattice-card-row-value' });
		const value = entry.getValue(propertyId);
		if (value === null) {
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
	 * is already telling the reader what it is.
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
				// The whole column accepts a card, so the column is what lights up.
				event.preventDefault();
				transfer.dropEffect = 'move';
				this.setCardDropTarget(this.columnAt(board, event)?.el ?? null);
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
