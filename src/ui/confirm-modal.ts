import { App, Modal } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	/** What will happen, in full. This is the whole point of the dialog. */
	body: string;
	/** Label for the confirming button. Name the action, not "OK". */
	confirmText: string;
}

/**
 * A yes/no dialog.
 *
 * Obsidian's public API has no confirm helper, and the actions this fronts are
 * not reversible from the UI, so the dialog states the consequence instead of
 * asking a bare "are you sure".
 */
export class ConfirmModal extends Modal {
	private readonly options: ConfirmOptions;
	private resolve: (confirmed: boolean) => void = () => undefined;
	private answered = false;

	private constructor(app: App, options: ConfirmOptions) {
		super(app);
		this.options = options;
	}

	/** Resolves `true` when confirmed, `false` on cancel or dismissal. */
	static open(app: App, options: ConfirmOptions): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(app, options);
			modal.resolve = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl('p', { text: this.options.body });

		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.settle(false);
		});
		buttons
			.createEl('button', { cls: 'mod-warning', text: this.options.confirmText })
			.addEventListener('click', () => {
				this.settle(true);
			});
	}

	onClose(): void {
		this.contentEl.empty();
		// Escape and click-outside land here. Dismissing is a cancel, never a yes.
		this.settle(false);
	}

	private settle(confirmed: boolean): void {
		if (this.answered) {
			return;
		}

		this.answered = true;
		this.close();
		this.resolve(confirmed);
	}
}
