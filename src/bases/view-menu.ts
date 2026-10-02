/**
 * Makes core's "Add view" add a board.
 *
 * A `.base` file keeps a list of views, and the toolbar's view menu can add one
 * to it — but core builds every view it adds as a table. Its `addView` ends in
 *
 *     new BasesViewConfig(query, "table", name)
 *
 * with the type written out by hand, and no API reaches that line: a
 * registration says what a view of ours *is*, not what the add button makes,
 * and `QueryController` is declared empty on purpose. So the row is intercepted
 * and the view is built here instead — with core's own class, pushed onto the
 * same list, saved through the same call. Nothing is copied but the one word.
 *
 * The new row is then clicked, which is what puts core back in charge: that
 * click is core's `selectView`, so the switch, the toolbar label and the file
 * write all happen where they would have happened anyway.
 *
 * The list and the query behind it are not public either, but they are reached
 * without guessing: `BasesViewConfig` is public and holds the query it belongs
 * to, because saving is the whole point of the pair. A board hands its config
 * over on every render for exactly that.
 *
 * This is a patch, and it fails quietly by design. With no board on screen, no
 * config, or a changed shape up top, the click is left alone and core adds the
 * table it wanted to add. Nothing errors.
 */

import type { BasesViewConfig } from 'obsidian';
import { LATTICE_BASES_VIEW_TYPE } from '../constants';

/** Core's own icon on the row that adds a view — not a label. */
const ADD_VIEW_ICON = '.bases-toolbar-menu-item-info-icon > svg.lucide-plus';
const MENU_ITEM = '.suggestion-item.bases-toolbar-menu-item';
const ITEM_NAME = '.bases-toolbar-menu-item-name';
const MENU_ROOT = '.menu';

/**
 * The view list, and only it.
 *
 * The menu says what it is: core puts the same class on the menu element and
 * on the button that opens it, and `menuEl` is the half with the rows. That
 * matters more than it looks — the property menu's rows are built by the same
 * code path and one of them wears the same "add" icon, so a row found by icon
 * alone could just as well be "add formula". The menu name is what rules it
 * out, and it is core's own, not a translation.
 */
const VIEW_MENU = '.menu.bases-toolbar-views-menu';

/** A board on screen, tagged by core with the view type it is showing. */
const BOARD_ON_SCREEN = `.bases-view[data-view-type="${LATTICE_BASES_VIEW_TYPE}"]`;

/** The toolbar that opened the menu now on screen. */
const OPEN_TOOLBAR = '.bases-toolbar.has-active-menu';

/** What a view added from a board is called. */
const NAME_ROOT = 'Board';

/**
 * The view list of a `.base` file, as core holds it in memory.
 *
 * Neither half is declared publicly. `save` is reached through
 * `BasesViewConfig.set`, and `views` through `getViewConfig`, so both are
 * standing facts of the shape rather than a guess about one.
 */
interface BasesQueryLike {
	views: BasesViewConfig[];
	save(): void;
}

/** How core's `BasesViewConfig` is built: which query, which type, which name. */
type ViewConfigConstructor = new (
	query: BasesQueryLike,
	type: string,
	name: string,
) => BasesViewConfig;

/**
 * A name no view is using yet.
 *
 * Core does the same for the views it adds, counting up from the default one,
 * and the same rule is wanted here: two views cannot share a name, and a name
 * is the only handle the list has on a view.
 */
export function uniqueViewName(
	existing: readonly string[],
	wanted: string,
): string {
	if (!existing.includes(wanted)) {
		return wanted;
	}

	for (let count = 2; count <= 1000; count += 1) {
		const candidate = `${wanted} ${count}`;
		if (!existing.includes(candidate)) {
			return candidate;
		}
	}

	return wanted;
}

/** Whether a value found by name on an undocumented object has the shape wanted. */
function isQueryLike(value: unknown): value is BasesQueryLike {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	const record = value as Record<string, unknown>;
	return Array.isArray(record['views']) && typeof record['save'] === 'function';
}

/**
 * The class to build a view with, taken from a view that is already built.
 *
 * It is not exported, so the only way to reach it is the one an instance has:
 * its prototype. A config with no instance to hand cannot be made, which is
 * why this answers `null` rather than inventing a plain object — a plain one
 * would be written to the file as `{}` the first time core saves.
 */
function viewConfigConstructor(
	views: readonly BasesViewConfig[],
): ViewConfigConstructor | null {
	const [first] = views;
	if (first === undefined) {
		return null;
	}

	const proto: unknown = Object.getPrototypeOf(first);
	if (proto === null || typeof proto !== 'object') {
		return null;
	}

	const ctor: unknown = (proto as { constructor?: unknown }).constructor;
	return typeof ctor === 'function' ? (ctor as ViewConfigConstructor) : null;
}

export class BoardViewAdder {
	private observer: MutationObserver | null = null;
	private queued = false;
	private enabled = false;

	/**
	 * Every board on screen, by the container core hands it.
	 *
	 * A config is the way to the query, and a board is the only thing that has
	 * one. Weak, because a board that closed is not worth keeping and the
	 * element is the only handle on it.
	 */
	private readonly boards = new WeakMap<HTMLElement, BasesViewConfig>();

	/** Rows already intercepted — a redraw must not stack handlers. */
	private readonly watched = new WeakSet<Element>();

	/**
	 * Called by a board on every render.
	 *
	 * Not once at construction: core assigns `config` after the factory returns,
	 * so the first render is the earliest it can be read, and a render is the
	 * reminder that it is there.
	 */
	remember(containerEl: HTMLElement, config: BasesViewConfig): void {
		this.boards.set(containerEl, config);
	}

	start(): void {
		if (this.observer !== null) {
			return;
		}

		this.enabled = true;
		this.observer = new MutationObserver(() => {
			this.schedule();
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	stop(): void {
		this.enabled = false;
		this.observer?.disconnect();
		this.observer = null;
	}

	/**
	 * At most one pass per frame.
	 *
	 * The view list is rebuilt from scratch on every keystroke in its search
	 * box, and the body this watches changes for a living. Neither is expensive
	 * on its own; together, without a brake, they are.
	 */
	private schedule(): void {
		if (this.queued) {
			return;
		}

		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			this.apply();
		});
	}

	private apply(): void {
		if (!this.enabled) {
			return;
		}

		for (const row of Array.from(
			document.querySelectorAll<HTMLElement>(`${VIEW_MENU} ${MENU_ITEM}`),
		)) {
			if (row.querySelector(ADD_VIEW_ICON) === null || this.watched.has(row)) {
				continue;
			}

			this.watched.add(row);
			row.addEventListener(
				'click',
				(event) => {
					this.onAddView(event);
				},
				// Before core's own handler, which listens on the list rather
				// than on the row, so nothing has run by the time this decides.
				{ capture: true },
			);
		}
	}

	private onAddView(event: Event): void {
		const query = this.queryForOpenMenu();
		const row = event.currentTarget;
		const menu = row instanceof Element ? row.closest(MENU_ROOT) : null;
		// The search box is what redraws the list, and that redraw is what puts
		// the new view on screen. With no box, no list, or no query to write
		// to, this cannot finish the job — and half of it is worse than none,
		// so core's own add is left alone to run.
		const search = menu?.querySelector<HTMLInputElement>('input') ?? null;
		if (query === null || menu === null || search === null) {
			return;
		}

		const Config = viewConfigConstructor(query.views);
		if (Config === null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const name = uniqueViewName(
			query.views.map((view) => view.name),
			NAME_ROOT,
		);
		query.views.push(new Config(query, LATTICE_BASES_VIEW_TYPE, name));
		query.save();

		this.openNewView(menu, search, name);
	}

	/**
	 * Put the new view in front of the user, by clicking its row.
	 *
	 * Core switches views from that click and from nowhere else, so this goes
	 * through the list rather than around it. The search box is cleared first:
	 * it filters the list, a view added while a filter is up can land outside
	 * it, and clearing it is also the redraw — core rebuilds on `input`.
	 *
	 * The click goes out a frame later, once that redraw has been applied. If
	 * the menu closed in between there is nothing to click, and the view is
	 * still there in the list for next time.
	 */
	private openNewView(
		menu: Element,
		search: HTMLInputElement,
		name: string,
	): void {
		search.value = '';
		search.dispatchEvent(new Event('input', { bubbles: true }));

		window.requestAnimationFrame(() => {
			const row = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM)).find(
				(item) => item.querySelector(ITEM_NAME)?.textContent === name,
			);
			row?.click();
		});
	}

	/**
	 * The query behind the board whose menu is open, or `null` if the menu is
	 * not a board's.
	 *
	 * The menu itself is moved onto the body, so it carries no link back to the
	 * view it is about. The toolbar that opened it does: core builds a toolbar
	 * and the view it drives side by side under one container, and marks the
	 * toolbar with `has-active-menu` for as long as one of its menus is up.
	 * Following that is what keeps the view out of the wrong file — another
	 * board on screen may well belong to a different `.base`.
	 *
	 * A menu opened over a table has no board under it, and is left alone. So is
	 * one whose board never rendered: this adds a view from a board's own
	 * toolbar and from nowhere else, which is also why it never has to choose
	 * between two candidates.
	 */
	private queryForOpenMenu(): BasesQueryLike | null {
		const toolbar = document.querySelector(OPEN_TOOLBAR);
		const owner = toolbar?.parentElement?.parentElement ?? null;
		const container =
			owner?.querySelector<HTMLElement>(`:scope > ${BOARD_ON_SCREEN}`) ?? null;
		if (container === null) {
			return null;
		}

		const config = this.boards.get(container);
		if (config === undefined) {
			return null;
		}

		// `BasesViewConfig` does not declare the query, but it cannot save
		// itself without one: `set` is documented as storing a value for the
		// view, and that is a file write.
		const query: unknown = (config as { query?: unknown }).query;
		return isQueryLike(query) ? query : null;
	}
}
