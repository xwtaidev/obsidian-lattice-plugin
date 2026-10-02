import { App, Modal, Setting, setIcon } from 'obsidian';

/** An answer the dialog can give without anything being typed. */
export interface TextPromptSuggestion {
	/** Says what the button does. A verb and the value it acts on. */
	label: string;
	/** The value the dialog answers with when this is pressed. */
	value: string;
}

export interface TextPromptOptions {
	title: string;
	/** What the typed text becomes, in the user's terms. */
	body: string;
	placeholder: string;
	/** Label for the accepting button. Name the action, not "OK". */
	confirmText: string;
	/**
	 * Ready-made answers, listed under the field.
	 *
	 * These are the cases the caller can already name — a column that was
	 * removed and can be brought back. They are offered here rather than behind
	 * a menu on the button that opened this dialog, because a menu in front of a
	 * question only postpones it: the button is pressed to say something about a
	 * column, and the first thing it asks is one more choice.
	 */
	suggestions?: TextPromptSuggestion[];
}

/**
 * A dialog that asks for one line of text.
 *
 * Obsidian's public API has no prompt helper. The value asked for here is not
 * private to the dialog either — it is written into the frontmatter of the
 * notes it is dropped on — which is why the dialog spells that out rather than
 * asking for "a name" and leaving the consequence to be discovered later.
 */
export class TextPromptModal extends Modal {
	private readonly options: TextPromptOptions;
	private resolve: (value: string | null) => void = () => undefined;
	private answered = false;
	private inputEl: HTMLInputElement | null = null;
	private acceptButton: HTMLButtonElement | null = null;

	private constructor(app: App, options: TextPromptOptions) {
		super(app);
		this.options = options;
	}

	/** Resolves the trimmed text, or `null` on cancel or dismissal. */
	static open(app: App, options: TextPromptOptions): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new TextPromptModal(app, options);
			modal.resolve = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl('p', { text: this.options.body });

		new Setting(this.contentEl).addText((text) => {
			this.inputEl = text.inputEl;
			text.setPlaceholder(this.options.placeholder);
			text.onChange(() => {
				this.updateAccept();
			});
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					// There is one field, so Enter is the button.
					event.preventDefault();
					this.settle(this.readValue());
				}
			});
			text.inputEl.focus();
		});

		this.renderSuggestions();

		const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.settle(null);
		});
		this.acceptButton = buttons.createEl('button', {
			cls: 'mod-cta',
			text: this.options.confirmText,
		});
		this.acceptButton.addEventListener('click', () => {
			this.settle(this.readValue());
		});
		this.updateAccept();
	}

	onClose(): void {
		this.contentEl.empty();
		// Escape and click-outside land here. Dismissing is a cancel, never a yes.
		this.settle(null);
	}

	/**
	 * Pressing one of these is a whole answer, so the dialog closes on it rather
	 * than putting the value in the field for a second press to confirm. The
	 * button that opened this dialog is already the confirmation — a "Restore"
	 * button that then needs "Add column" pressed has named the wrong action.
	 */
	private renderSuggestions(): void {
		const suggestions = this.options.suggestions ?? [];
		if (suggestions.length === 0) {
			return;
		}

		const list = this.contentEl.createDiv({ cls: 'lattice-prompt-suggestions' });
		for (const suggestion of suggestions) {
			const button = list.createEl('button', { cls: 'lattice-prompt-suggestion' });
			setIcon(button.createSpan({ cls: 'lattice-prompt-suggestion-icon' }), 'undo-2');
			button.createSpan({ cls: 'lattice-prompt-suggestion-label', text: suggestion.label });
			button.addEventListener('click', () => {
				this.settle(suggestion.value);
			});
		}
	}

	/**
	 * Read the field itself rather than tracking what was typed through
	 * `onChange`: the two can disagree for as long as a change takes to arrive,
	 * and Enter is the shortest path to a button that would then be one
	 * keystroke behind the text on screen.
	 */
	private readValue(): string | null {
		const value = this.inputEl?.value.trim() ?? '';
		return value.length > 0 ? value : null;
	}

	/** An empty field cannot be accepted, and the button says so. */
	private updateAccept(): void {
		if (this.acceptButton !== null) {
			this.acceptButton.disabled = (this.inputEl?.value.trim().length ?? 0) === 0;
		}
	}

	private settle(value: string | null): void {
		if (this.answered) {
			return;
		}

		this.answered = true;
		this.close();
		this.resolve(value);
	}
}
