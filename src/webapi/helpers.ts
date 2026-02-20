import { App, htmlToMarkdown } from 'obsidian';

import { ZoteroConnectorSettings } from '../types';
import { WebApiClient } from './WebApiClient';

export function getWebApiKey(
  app: App,
  settings: ZoteroConnectorSettings
): string {
  return app.secretStorage.getSecret(settings.webApiKey);
}

export function buildWebApiClient(
  apiKey: string,
  settings: ZoteroConnectorSettings
): WebApiClient {
  return new WebApiClient({
    apiKey,
    libraryType: settings.webApiLibraryType ?? 'user',
    userId: settings.webApiUserId,
    groupId: settings.webApiGroupId,
  });
}

export function getCslStyleFromSettings(settings: ZoteroConnectorSettings) {
  const exportStyle = settings.exportFormats.find((f) => !!f.cslStyle);
  if (exportStyle) return exportStyle.cslStyle;

  const citeStyle = settings.citeFormats.find((f) => !!f.cslStyle);
  if (citeStyle) return citeStyle.cslStyle;

  return undefined;
}

export function htmlToMarkdownSafe(html: string | undefined | null) {
  if (!html || typeof html !== 'string') return '';
  return htmlToMarkdown(html);
}
