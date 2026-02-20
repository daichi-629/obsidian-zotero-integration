import { moment } from 'obsidian';

import { processZoteroAnnotationNotes } from '../bbt/exportNotes';
import { CiteKeyExport, ZoteroConnectorSettings } from '../types';
import { buildCollectionsWithFullPath } from './collections';
import { WebApiClient } from './WebApiClient';
import { getCslStyleFromSettings, htmlToMarkdownSafe } from './helpers';

type WebApiItem = {
  key: string;
  version?: number;
  data?: Record<string, any>;
  meta?: Record<string, any>;
  links?: Record<string, any>;
};

export type WebApiSearchResult = {
  key: string;
  title?: string;
  itemType?: string;
  creators?: any[];
  date?: string;
  citekey?: string;
  citation?: string;
  bibliography?: string;
};

export async function webApiSearchItems(
  client: WebApiClient,
  settings: ZoteroConnectorSettings,
  term: string
) {
  const style = getCslStyleFromSettings(settings);
  const res = await client.getLibraryApi().items().get({
    q: term,
    limit: 25,
    include: 'data,citation,bib',
    style,
  });

  const items = res.getData?.() ?? [];
  const list = Array.isArray(items) ? items : [items];

  return list.map((item) => {
    const data = (item as any).data ?? item ?? {};
    const meta = (item as any).meta ?? {};
    const title = data.title ?? meta.title ?? (item as any).title;
    return {
      key: item.key ?? data.key,
      title,
      itemType: data.itemType ?? (item as any).itemType,
      creators: data.creators ?? (item as any).creators,
      date: data.date ?? (item as any).date,
      citekey:
        data.citationKey ||
        data['citation-key'] ||
        (item as any).citationKey ||
        (item as any)['citation-key'],
      citation: htmlToMarkdownSafe((item as any).citation),
      bibliography: htmlToMarkdownSafe((item as any).bib),
    } as WebApiSearchResult;
  });
}

export async function webApiGetItem(
  client: WebApiClient,
  settings: ZoteroConnectorSettings,
  itemKey: string
) {
  const style = getCslStyleFromSettings(settings);
  const res = await client.getLibraryApi().items(itemKey).get({
    include: 'data,citation,bib',
    style,
  });

  const item = res.getData?.();
  if (!item) return null;

  const data = (item as any).data ?? item ?? {};
  const rawData = (res as any).raw?.data ?? {};
  if (!data.citationKey && rawData.citationKey) {
    data.citationKey = rawData.citationKey;
  }
  if (!data['citation-key'] && rawData['citation-key']) {
    data['citation-key'] = rawData['citation-key'];
  }
  const collectionKeys = rawData.collections ?? data.collections ?? [];
  if (Array.isArray(collectionKeys) && collectionKeys.length > 0) {
    try {
      data.collections = await buildCollectionsWithFullPath(
        client,
        collectionKeys
      );
    } catch (e) {
      console.error('Failed to resolve web API collections:', e);
    }
  }
  return {
    key: item.key ?? data.key,
    data,
    citation: htmlToMarkdownSafe((item as any).citation),
    bibliography: htmlToMarkdownSafe((item as any).bib),
  };
}

export async function webApiGetItemChildren(
  client: WebApiClient,
  itemKey: string
) {
  const res = await client.getLibraryApi().items(itemKey).children().get({
    include: 'data',
  });

  const items = res.getData?.() ?? [];
  const list = Array.isArray(items) ? items : [items];

  return list.map((item) => ({
    key: item.key,
    data: item.data ?? {},
  }));
}

export async function webApiGetAttachments(
  client: WebApiClient,
  itemKey: string
) {
  const children = await webApiGetItemChildren(client, itemKey);
  return children.filter((item) => item.data?.itemType === 'attachment');
}

export async function webApiGetNotes(
  client: WebApiClient,
  itemKey: string,
  linkify: boolean
) {
  const res = await client.getLibraryApi().items(itemKey).children().get({
    include: 'data',
  });

  const items = res.getData?.() ?? [];
  const list = Array.isArray(items) ? items : [items];
  const notes = list.filter((item) => item.data?.itemType === 'note');

  if (!linkify) {
    return notes.map((note) => ({
      key: note.key,
      note: htmlToMarkdownSafe(note.data?.note ?? ''),
    }));
  }

  const linked = await Promise.all(
    notes.map(async (note) => {
      const noteHtml = note.data?.note ?? '';
      const withLinks = await processZoteroAnnotationNotes(
        itemKey,
        noteHtml,
        {}
      );
      return {
        key: note.key,
        note: htmlToMarkdownSafe(withLinks),
      };
    })
  );

  return linked;
}

export async function webApiGetCitationAndBib(
  client: WebApiClient,
  settings: ZoteroConnectorSettings,
  itemKey: string
) {
  const style = getCslStyleFromSettings(settings);
  const res = await client.getLibraryApi().items(itemKey).get({
    include: 'citation,bib',
    style,
  });

  const item = res.getData?.();
  return {
    citation: htmlToMarkdownSafe(item?.citation),
    bibliography: htmlToMarkdownSafe(item?.bib),
  };
}

export async function webApiGetCiteKeyExports(client: WebApiClient) {
  const res = await client.getLibraryApi().items().get({
    q: '',
    limit: 100,
    include: 'data',
  });

  const items = res.getData?.() ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list
    .map((item) => {
      const data = item.data ?? {};
      const citekey = data.citationKey || data['citation-key'];
      const title = data.title;
      if (!citekey || !title) return null;
      return {
        libraryID: 0,
        citekey,
        title,
      } as CiteKeyExport;
    })
    .filter((entry): entry is CiteKeyExport => !!entry);
}

export async function webApiValidateSettings(
  client: WebApiClient,
  settings: ZoteroConnectorSettings
) {
  const style = getCslStyleFromSettings(settings);
  try {
    await client.getLibraryApi().items().get({
      limit: 1,
      include: 'data',
      style,
    });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export function buildWebApiItemNote(item: WebApiItem, includeMeta: boolean) {
  const data = item.data ?? {};
  const meta = item.meta ?? {};

  const lines: string[] = [];
  lines.push(`# ${data.title || meta.title || item.key}`);
  lines.push('');
  lines.push(`- key: ${item.key}`);
  if (data.itemType) {
    lines.push(`- type: ${data.itemType}`);
  }
  if (data.date) {
    lines.push(`- date: ${data.date}`);
  }
  if (data.creators?.length) {
    lines.push(
      `- creators: ${data.creators
        .map((c: any) =>
          `${c.lastName || ''}${c.firstName ? `, ${c.firstName}` : ''}`.trim()
        )
        .filter(Boolean)
        .join('; ')}`
    );
  }
  if (includeMeta && meta) {
    if (meta.numChildren !== undefined) {
      lines.push(`- children: ${meta.numChildren}`);
    }
    if (meta.dateAdded) {
      lines.push(`- added: ${moment(meta.dateAdded).format('YYYY-MM-DD')}`);
    }
    if (meta.dateModified) {
      lines.push(
        `- modified: ${moment(meta.dateModified).format('YYYY-MM-DD')}`
      );
    }
  }
  return lines.join('\n');
}
