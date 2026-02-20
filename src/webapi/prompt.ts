import { App, Modal, SuggestModal } from 'obsidian';

import { WebApiSearchResult } from './features';

export function promptForText(
  app: App,
  title: string,
  placeholder?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const modal = new Modal(app);
    modal.titleEl.setText(title);

    const input = modal.contentEl.createEl('input', {
      type: 'text',
      placeholder: placeholder ?? '',
    });
    input.addClass('prompt-input');
    input.focus();

    const buttonRow = modal.contentEl.createDiv({
      cls: 'prompt-buttons',
    });
    const cancel = buttonRow.createEl('button', { text: 'Cancel' });
    const submit = buttonRow.createEl('button', { text: 'Search' });

    const closeWith = (value: string | null) => {
      resolved = true;
      modal.close();
      resolve(value);
    };

    cancel.addEventListener('click', () => closeWith(null));
    submit.addEventListener('click', () => {
      const value = input.value.trim();
      closeWith(value.length ? value : null);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const value = input.value.trim();
        closeWith(value.length ? value : null);
      }
      if (event.key === 'Escape') {
        closeWith(null);
      }
    });

    modal.onClose = () => {
      if (!resolved) {
        resolve(null);
      }
    };

    modal.open();
  });
}

function formatCreators(creators?: any[]) {
  if (!creators?.length) return '';
  return creators
    .map((c) => {
      const last = c.lastName || '';
      const first = c.firstName ? `, ${c.firstName}` : '';
      return `${last}${first}`.trim();
    })
    .filter(Boolean)
    .join('; ');
}

class WebApiItemSuggestModal extends SuggestModal<WebApiSearchResult> {
  private items: WebApiSearchResult[];
  private resolve: (value: WebApiSearchResult) => void;
  private reject: (reason?: Error) => void;
  private resolved = false;

  constructor(
    app: App,
    items: WebApiSearchResult[],
    resolve: (value: WebApiSearchResult) => void,
    reject: (reason?: Error) => void,
    title?: string
  ) {
    super(app);
    this.items = items;
    this.resolve = resolve;
    this.reject = reject;
    if (title) {
      this.setTitle(title);
    }
  }

  getSuggestions(query: string): WebApiSearchResult[] {
    const term = query.trim().toLowerCase();
    if (!term) return this.items;
    return this.items.filter((item) => {
      const title = item.title?.toLowerCase() ?? '';
      const citekey = item.citekey?.toLowerCase() ?? '';
      const creators = formatCreators(item.creators).toLowerCase();
      return (
        title.includes(term) ||
        citekey.includes(term) ||
        creators.includes(term)
      );
    });
  }

  renderSuggestion(item: WebApiSearchResult, el: HTMLElement) {
    const name = item.title || item.key;
    el.createEl('div', { text: name });
    const sub = [
      item.creators?.length
        ? `authors: ${formatCreators(item.creators)}`
        : null,
      item.itemType ? `type: ${item.itemType}` : null,
      item.date ? `date: ${item.date}` : null,
      item.citekey ? `citekey: ${item.citekey}` : null,
    ]
      .filter(Boolean)
      .join(' • ');
    if (sub) {
      el.createEl('div', { text: sub, cls: 'webapi-item-select-sub' });
    }
  }

  onChooseSuggestion(
    item: WebApiSearchResult,
    _evt: MouseEvent | KeyboardEvent
  ) {
    this.resolved = true;
    this.resolve(item);
    this.close();
  }

  onClose() {
    if (this.resolved) return;
    window.setTimeout(() => {
      if (this.resolved) return;
      this.reject(new Error('Selection cancelled.'));
    }, 1);
  }
}

export function promptForWebApiItemSelection(
  app: App,
  title: string,
  items: WebApiSearchResult[]
): Promise<WebApiSearchResult> {
  return new Promise((resolve, reject) => {
    const modal = new WebApiItemSuggestModal(
      app,
      items,
      resolve,
      reject,
      title
    );
    modal.open();
  });
}
