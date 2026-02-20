import { App, Notice, TFile, moment, normalizePath } from 'obsidian';

import { LoadingModal } from '../bbt/LoadingModal';
import { applyBasicTemplates } from '../bbt/basicTemplates/applyBasicTemplates';
import { getATemplatePath, renderTemplates } from '../bbt/export';
import { getLocalURI, mkMDDir, sanitizeFilePath } from '../bbt/helpers';
import { PersistExtension, renderTemplate } from '../bbt/template.env';
import {
  getExistingAnnotations,
  getLastExport,
  removeStartingSlash,
} from '../bbt/template.helpers';
import { ExportFormat, ZoteroConnectorSettings } from '../types';
import { webApiGetItem, webApiGetNotes, webApiSearchItems } from './features';
import { buildWebApiClient, getWebApiKey } from './helpers';
import { promptForText, promptForWebApiItemSelection } from './prompt';

type WebApiItemDetail = {
  key: string;
  data?: Record<string, any>;
  citation?: string;
  bibliography?: string;
};

function resolveWebApiImportFormat(
  settings: ZoteroConnectorSettings,
  format?: ExportFormat
) {
  if (format) return format;
  if (!settings.exportFormats.length) return null;
  return (
    settings.exportFormats.find((format) => format.name === 'Import #1') ??
    settings.exportFormats[0]
  );
}

function buildWebApiItemUri(
  settings: ZoteroConnectorSettings,
  itemKey: string
) {
  if (settings.webApiLibraryType === 'group') {
    return `http://zotero.org/groups/${settings.webApiGroupId}/items/${itemKey}`;
  }

  return `http://zotero.org/users/${settings.webApiUserId}/items/${itemKey}`;
}

async function buildWebApiTemplateData(
  sourcePath: string,
  detail: WebApiItemDetail,
  settings: ZoteroConnectorSettings,
  notes: { note: string }[],
  lastImportDate: moment.Moment
) {
  const data = detail.data ?? {};
  const citekey = data.citationKey || data['citation-key'] || detail.key;
  const uri = buildWebApiItemUri(settings, detail.key);
  const item = {
    ...data,
    key: detail.key,
    itemKey: detail.key,
    uri,
    citekey,
    citationKey: citekey,
    desktopURI: getLocalURI('select', uri),
    select: getLocalURI('select', uri),
    attachments: [],
    annotations: [],
    notes,
    citation: detail.citation,
    bibliography: detail.bibliography,
  };

  const templateData = {
    ...item,
    lastImportDate,
    lastExportDate: lastImportDate,
    isFirstImport: lastImportDate.valueOf() === 0,
  };

  return await applyBasicTemplates(sourcePath, templateData);
}

export async function runWebApiImport(
  app: App,
  settings: ZoteroConnectorSettings,
  format?: ExportFormat
) {
  if (!settings.webApiEnabled) {
    new Notice('Web API is disabled. Enable it in settings first.');
    return;
  }

  if (
    (settings.webApiLibraryType === 'user' && !settings.webApiUserId) ||
    (settings.webApiLibraryType === 'group' && !settings.webApiGroupId)
  ) {
    new Notice('Web API library ID is missing in settings.');
    return;
  }

  const term = await promptForText(
    app,
    'Search Zotero Web API',
    'Enter search term'
  );
  if (!term) return;

  const apiKey = getWebApiKey(app, settings);
  if (!apiKey) {
    new Notice('Web API key is not set.');
    return;
  }

  const client = buildWebApiClient(apiKey, settings);
  const modal = new LoadingModal(app, 'Searching Zotero Web API...');
  let modalOpen = true;
  modal.open();

  try {
    const results = await webApiSearchItems(client, settings, term);
    const filtered = results.filter((item) => item.itemType !== 'attachment');
    if (!filtered.length) {
      new Notice('No items found.');
      return;
    }

    modal.close();
    modalOpen = false;

    const resolvedFormat = resolveWebApiImportFormat(settings, format);
    if (!resolvedFormat) {
      new Notice('No import format found. Add an Export Format first.');
      return;
    }

    const selected = await promptForWebApiItemSelection(
      app,
      'Select items to import',
      filtered
    );

    const detail = await webApiGetItem(client, settings, selected.key);
    if (!detail) {
      new Notice('Failed to fetch selected item.');
      return;
    }

    const notes = await webApiGetNotes(client, detail.key, true);
    const database = {
      database: settings.database,
      port: settings.port,
    };
    const params = {
      settings,
      database,
      exportFormat: resolvedFormat,
    };
    const sourcePath = getATemplatePath(params);
    const pathTemplateData = await buildWebApiTemplateData(
      sourcePath,
      detail,
      settings,
      notes,
      moment(0)
    );
    const markdownPath = normalizePath(
      sanitizeFilePath(
        removeStartingSlash(
          await renderTemplate(
            sourcePath,
            resolvedFormat.outputPathTemplate,
            pathTemplateData
          )
        )
      )
    );
    const existingFile = app.vault.getAbstractFileByPath(markdownPath) as TFile;
    const existingContent = existingFile
      ? await app.vault.read(existingFile)
      : '';
    const existingAnnotations = existingFile
      ? getExistingAnnotations(existingContent)
      : '';
    const lastImportDate = existingFile
      ? getLastExport(existingContent)
      : moment(0);

    const templateData = await buildWebApiTemplateData(
      sourcePath,
      detail,
      settings,
      notes,
      lastImportDate
    );
    const rendered = await renderTemplates(
      params,
      PersistExtension.prepareTemplateData(templateData, existingContent),
      existingAnnotations
    );

    if (!rendered) {
      return;
    }

    if (existingFile) {
      await app.vault.modify(existingFile, rendered);
    } else {
      await mkMDDir(markdownPath);
      await app.vault.create(markdownPath, rendered);
    }

    if (settings.openNoteAfterImport) {
      const file = app.vault.getAbstractFileByPath(markdownPath) as TFile;
      if (file) {
        await app.workspace.getLeaf(true).openFile(file);
      }
    }
    new Notice('Imported 1 item.');
  } catch (e) {
    if (e instanceof Error && e.message === 'Selection cancelled.') {
      return;
    }
    console.error(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    new Notice(`Web API search failed: ${message}`, 10000);
  } finally {
    if (modalOpen) {
      modal.close();
    }
  }
}

export async function runWebApiSearchTest(
  app: App,
  settings: ZoteroConnectorSettings
) {
  return runWebApiImport(app, settings);
}

export async function dataExplorerWebApiPrompt(
  app: App,
  settings: ZoteroConnectorSettings
) {
  if (!settings.webApiEnabled) {
    new Notice('Web API is disabled. Enable it in settings first.');
    return null;
  }

  if (
    (settings.webApiLibraryType === 'user' && !settings.webApiUserId) ||
    (settings.webApiLibraryType === 'group' && !settings.webApiGroupId)
  ) {
    new Notice('Web API library ID is missing in settings.');
    return null;
  }

  const term = await promptForText(
    app,
    'Search Zotero Web API',
    'Enter search term'
  );
  if (!term) return null;

  const apiKey = getWebApiKey(app, settings);
  if (!apiKey) {
    new Notice('Web API key is not set.');
    return null;
  }

  const client = buildWebApiClient(apiKey, settings);
  const modal = new LoadingModal(app, 'Searching Zotero Web API...');
  let modalOpen = true;
  modal.open();

  try {
    const results = await webApiSearchItems(client, settings, term);
    const filtered = results.filter((item) => item.itemType !== 'attachment');
    if (!filtered.length) {
      new Notice('No items found.');
      return null;
    }

    modal.close();
    modalOpen = false;

    const selected = await promptForWebApiItemSelection(
      app,
      'Select item to preview',
      filtered
    );

    const detail = await webApiGetItem(client, settings, selected.key);
    if (!detail) {
      new Notice('Failed to fetch selected item.');
      return null;
    }

    const notes = await webApiGetNotes(client, detail.key, true);
    const templateData = await buildWebApiTemplateData(
      '',
      detail,
      settings,
      notes,
      moment(0)
    );

    return [templateData];
  } catch (e) {
    if (e instanceof Error && e.message === 'Selection cancelled.') {
      return null;
    }
    console.error(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    new Notice(`Web API search failed: ${message}`, 10000);
    return null;
  } finally {
    if (modalOpen) {
      modal.close();
    }
  }
}
