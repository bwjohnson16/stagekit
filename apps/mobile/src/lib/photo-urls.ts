import AsyncStorage from "@react-native-async-storage/async-storage";

import { getSupabaseClient } from "./supabase";

const SIGNED_PHOTO_URL_CACHE_KEY = "stagekit:signed-photo-url-cache:v1";
const SIGNED_PHOTO_URL_CACHE_REFRESH_MARGIN_MS = 60 * 60 * 1000;
const MAX_SIGNED_PHOTO_URL_CACHE_ENTRIES = 1_500;
const DEFAULT_PHOTO_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export const THUMBNAIL_TRANSFORM = {
  width: 240,
  height: 240,
  resize: "cover",
  quality: 60,
} as const;

export type InventoryPhotoRow = {
  id: string;
  item_id: string;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
};

export type PhotoTransform = {
  width: number;
  height: number;
  resize: "cover" | "contain" | "fill";
  quality: number;
};

type SignedPhotoUrlCacheEntry = {
  expiresAt: number;
  url: string;
};

const signedPhotoUrlCache = new Map<string, SignedPhotoUrlCacheEntry>();
let cacheHydrationPromise: Promise<void> | null = null;
let cacheWritePromise: Promise<void> | null = null;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getPhotoStorageKey(bucket: string, storagePath: string) {
  return `${bucket}:${storagePath}`;
}

function getSignedPhotoUrlCacheKey(bucket: string, storagePath: string, transform?: PhotoTransform) {
  return JSON.stringify([bucket, storagePath, transform ?? null]);
}

function isFreshCacheEntry(entry: SignedPhotoUrlCacheEntry) {
  return entry.expiresAt - SIGNED_PHOTO_URL_CACHE_REFRESH_MARGIN_MS > Date.now();
}

async function hydrateSignedPhotoUrlCache() {
  if (cacheHydrationPromise) {
    return cacheHydrationPromise;
  }

  cacheHydrationPromise = AsyncStorage.getItem(SIGNED_PHOTO_URL_CACHE_KEY)
    .then((rawCache) => {
      if (!rawCache) {
        return;
      }

      const parsedCache = JSON.parse(rawCache) as Record<string, SignedPhotoUrlCacheEntry>;
      for (const [key, entry] of Object.entries(parsedCache)) {
        if (entry?.url && Number.isFinite(entry.expiresAt) && isFreshCacheEntry(entry)) {
          signedPhotoUrlCache.set(key, entry);
        }
      }
    })
    .catch((error) => {
      console.warn("Failed to load signed photo URL cache.", error);
    });

  return cacheHydrationPromise;
}

function setCachedSignedPhotoUrl(bucket: string, storagePath: string, url: string, expiresInSeconds: number, transform?: PhotoTransform) {
  const key = getSignedPhotoUrlCacheKey(bucket, storagePath, transform);

  signedPhotoUrlCache.delete(key);
  signedPhotoUrlCache.set(key, {
    expiresAt: Date.now() + expiresInSeconds * 1000,
    url,
  });
}

function getCachedSignedPhotoUrl(bucket: string, storagePath: string, transform?: PhotoTransform) {
  const cached = signedPhotoUrlCache.get(getSignedPhotoUrlCacheKey(bucket, storagePath, transform));

  return cached && isFreshCacheEntry(cached) ? cached.url : null;
}

async function persistSignedPhotoUrlCache() {
  if (cacheWritePromise) {
    return cacheWritePromise;
  }

  cacheWritePromise = Promise.resolve()
    .then(async () => {
      const freshEntries = [...signedPhotoUrlCache.entries()]
        .filter(([, entry]) => isFreshCacheEntry(entry))
        .slice(-MAX_SIGNED_PHOTO_URL_CACHE_ENTRIES);

      signedPhotoUrlCache.clear();
      for (const [key, entry] of freshEntries) {
        signedPhotoUrlCache.set(key, entry);
      }

      await AsyncStorage.setItem(SIGNED_PHOTO_URL_CACHE_KEY, JSON.stringify(Object.fromEntries(freshEntries)));
    })
    .catch((error) => {
      console.warn("Failed to persist signed photo URL cache.", error);
    })
    .finally(() => {
      cacheWritePromise = null;
    });

  return cacheWritePromise;
}

export async function createSignedPhotoUrlMap(
  photos: InventoryPhotoRow[],
  transform?: PhotoTransform,
  expiresInSeconds = DEFAULT_PHOTO_URL_TTL_SECONDS,
) {
  await hydrateSignedPhotoUrlCache();

  const supabase = getSupabaseClient();
  const signedUrlByKey = new Map<string, string>();
  const photosByBucket = new Map<string, InventoryPhotoRow[]>();

  for (const photo of photos) {
    const bucketPhotos = photosByBucket.get(photo.storage_bucket) ?? [];
    bucketPhotos.push(photo);
    photosByBucket.set(photo.storage_bucket, bucketPhotos);
  }

  if (transform) {
    try {
      const uniquePhotos = [...photosByBucket.entries()].flatMap(([bucket, bucketPhotos]) =>
        [...new Set(bucketPhotos.map((photo) => photo.storage_path))].map((storagePath) => ({
          bucket,
          storagePath,
        })),
      );
      const uncachedPhotos = uniquePhotos.filter((photo) => {
        const cachedUrl = getCachedSignedPhotoUrl(photo.bucket, photo.storagePath, transform);
        if (cachedUrl) {
          signedUrlByKey.set(getPhotoStorageKey(photo.bucket, photo.storagePath), cachedUrl);
          return false;
        }

        return true;
      });

      for (const photoChunk of chunkArray(uncachedPhotos, 20)) {
        const signedUrlResults = await Promise.all(
          photoChunk.map(async (photo) => {
            const { data, error } = await supabase.storage.from(photo.bucket).createSignedUrl(photo.storagePath, expiresInSeconds, {
              transform,
            });

            if (error) {
              throw new Error(error.message);
            }

            return {
              ...photo,
              signedUrl: data.signedUrl,
            };
          }),
        );

        for (const entry of signedUrlResults) {
          if (entry.signedUrl) {
            setCachedSignedPhotoUrl(entry.bucket, entry.storagePath, entry.signedUrl, expiresInSeconds, transform);
            signedUrlByKey.set(getPhotoStorageKey(entry.bucket, entry.storagePath), entry.signedUrl);
          }
        }
      }

      if (uncachedPhotos.length > 0) {
        void persistSignedPhotoUrlCache();
      }

      return signedUrlByKey;
    } catch (error) {
      console.warn("Falling back to untransformed photo URLs.", error);
      return createSignedPhotoUrlMap(photos, undefined, expiresInSeconds);
    }
  }

  let didUpdateCache = false;

  for (const [bucket, bucketPhotos] of photosByBucket.entries()) {
    const uniquePaths = [...new Set(bucketPhotos.map((photo) => photo.storage_path))];
    const uncachedPaths = uniquePaths.filter((storagePath) => {
      const cachedUrl = getCachedSignedPhotoUrl(bucket, storagePath);
      if (cachedUrl) {
        signedUrlByKey.set(getPhotoStorageKey(bucket, storagePath), cachedUrl);
        return false;
      }

      return true;
    });

    for (const pathChunk of chunkArray(uncachedPaths, 100)) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pathChunk, expiresInSeconds);

      if (error) {
        throw new Error(error.message);
      }

      for (const entry of data ?? []) {
        if (!entry.path || !entry.signedUrl) {
          continue;
        }

        setCachedSignedPhotoUrl(bucket, entry.path, entry.signedUrl, expiresInSeconds);
        signedUrlByKey.set(getPhotoStorageKey(bucket, entry.path), entry.signedUrl);
      }
    }

    didUpdateCache = didUpdateCache || uncachedPaths.length > 0;
  }

  if (didUpdateCache) {
    void persistSignedPhotoUrlCache();
  }

  return signedUrlByKey;
}
