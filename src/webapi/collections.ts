import { WebApiClient } from './WebApiClient';

type CollectionInfo = {
  key: string;
  name: string;
  parentCollection?: string | null;
};

type CollectionWithPath = {
  key: string;
  name: string;
  fullPath: string;
};

function extractCollectionInfo(res: any, fallbackKey: string): CollectionInfo {
  const item = res?.getData?.() ?? {};
  const data = item?.data ?? item ?? {};
  const rawData = res?.raw?.data ?? {};
  const key = item?.key ?? data.key ?? rawData.key ?? fallbackKey;
  const name = data.name ?? rawData.name ?? key;
  const parent =
    data.parentCollection ??
    rawData.parentCollection ??
    rawData.parentCollection?.key ??
    null;

  return {
    key,
    name,
    parentCollection: parent,
  };
}

async function fetchCollectionInfo(
  client: WebApiClient,
  collectionKey: string
) {
  const res = await client.getLibraryApi().collections(collectionKey).get();
  return extractCollectionInfo(res, collectionKey);
}

export async function buildCollectionsWithFullPath(
  client: WebApiClient,
  collectionKeys: string[]
): Promise<CollectionWithPath[]> {
  const cache = new Map<string, CollectionInfo>();
  const inFlight = new Map<string, Promise<CollectionInfo>>();

  const getInfo = async (key: string): Promise<CollectionInfo> => {
    if (cache.has(key)) return cache.get(key)!;
    if (inFlight.has(key)) return inFlight.get(key)!;

    const pending = fetchCollectionInfo(client, key)
      .then((info) => {
        cache.set(key, info);
        return info;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, pending);
    return pending;
  };

  const buildPath = async (
    key: string,
    visiting: Set<string>
  ): Promise<string> => {
    if (visiting.has(key)) return key;
    visiting.add(key);

    const info = await getInfo(key);
    const parentKey = info.parentCollection;
    if (!parentKey) return info.name;

    const parentPath = await buildPath(parentKey, visiting);
    return `${parentPath}/${info.name}`;
  };

  const uniqueKeys = collectionKeys.filter((key) => !!key);
  const results: CollectionWithPath[] = [];

  for (const key of uniqueKeys) {
    const info = await getInfo(key);
    const fullPath = await buildPath(key, new Set());
    results.push({
      key: info.key,
      name: info.name,
      fullPath,
    });
  }

  return results;
}
