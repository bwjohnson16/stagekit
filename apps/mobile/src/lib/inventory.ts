import type { Database } from "./database";
import { canonicalizeInventoryCategory } from "./inventory-taxonomy";
import { createSignedPhotoUrlMap, THUMBNAIL_TRANSFORM, type InventoryPhotoRow } from "./photo-urls";
import { fileUriToArrayBuffer } from "./storage";
import { getSupabaseClient } from "./supabase";

export const inventoryStatusOptions = ["available", "on_job", "packed", "maintenance", "sold", "lost"] as const;
export const inventoryConditionOptions = ["new", "like_new", "good", "fair", "rough"] as const;
const INVENTORY_PAGE_SIZE = 500;

export type InventoryItemStatus = Database["public"]["Enums"]["inventory_item_status"];
export type InventoryItemCondition = Database["public"]["Enums"]["inventory_condition"];
export type InventoryItem = Pick<
  Database["public"]["Tables"]["inventory_items"]["Row"],
  | "id"
  | "name"
  | "sku"
  | "category"
  | "status"
  | "condition"
  | "brand"
  | "color"
  | "material"
  | "dimensions"
  | "item_code"
  | "marked_for_disposal"
  | "notes"
  | "estimated_listing_price_cents"
  | "purchase_price_cents"
  | "purchase_date"
  | "replacement_cost_cents"
  | "current_location_id"
  | "room"
  | "source_job_id"
  | "tags"
>;

export type InventoryListItem = InventoryItem & {
  current_location_name: string | null;
  source_job_name: string | null;
  thumbnail_url: string | null;
};

export type InventoryListFilters = {
  search?: string | null;
  color?: string | null;
  category?: string | null;
  room?: string | null;
  locationName?: string | null;
};

type InventoryQueryResult = PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
  count?: number | null;
}>;

type InventoryItemsQuery = {
  eq: (column: string, value: string) => InventoryItemsQuery;
  in: (column: string, values: readonly string[]) => InventoryItemsQuery;
  or: (filters: string) => InventoryItemsQuery;
  order: (column: string, options: { ascending: boolean }) => InventoryItemsQuery;
  range: (from: number, to: number) => InventoryQueryResult;
};

export type InventoryPhoto = {
  id: string;
  url: string;
  sort_order: number;
  storage_bucket: string;
  storage_path: string;
};

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function listInventoryPhotosForItems(itemIds: string[]) {
  if (itemIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseClient();
  const photoRows: InventoryPhotoRow[] = [];

  for (const itemIdChunk of chunkArray(itemIds, 100)) {
    const { data, error } = await supabase
      .from("inventory_photos")
      .select("id,item_id,storage_bucket,storage_path,sort_order")
      .in("item_id", itemIdChunk)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    photoRows.push(...((data ?? []) as InventoryPhotoRow[]));
  }

  return photoRows;
}

async function listInventoryCoverPhotosForItems(itemIds: string[]) {
  const photos = await listInventoryPhotosForItems(itemIds);
  const coverPhotosByItemId = new Map<string, InventoryPhotoRow>();

  for (const photo of photos) {
    if (!coverPhotosByItemId.has(photo.item_id)) {
      coverPhotosByItemId.set(photo.item_id, photo);
    }
  }

  return [...coverPhotosByItemId.values()];
}

async function listActiveJobAssignmentsForItems(itemIds: string[]) {
  if (itemIds.length === 0) {
    return [] as { item_id: string; job_id: string }[];
  }

  const supabase = getSupabaseClient();
  const assignmentRows: { item_id: string; job_id: string }[] = [];

  for (const itemIdChunk of chunkArray(itemIds, 100)) {
    const { data, error } = await supabase.from("job_items").select("item_id,job_id").in("item_id", itemIdChunk).is("checked_in_at", null);

    if (error) {
      throw new Error(error.message);
    }

    assignmentRows.push(...((data ?? []) as { item_id: string; job_id: string }[]));
  }

  return assignmentRows;
}

async function listInventoryItemRows<T>(selectClause: string, configure?: (query: InventoryItemsQuery) => InventoryItemsQuery, maxRows?: number) {
  const supabase = getSupabaseClient();
  const rows: T[] = [];

  for (let from = 0; ; from += INVENTORY_PAGE_SIZE) {
    const remainingRows = maxRows == null ? INVENTORY_PAGE_SIZE : Math.min(INVENTORY_PAGE_SIZE, maxRows - rows.length);
    if (remainingRows <= 0) {
      break;
    }

    let query = supabase.from("inventory_items").select(selectClause) as unknown as InventoryItemsQuery;
    if (configure) {
      query = configure(query);
    }

    const { data, error } = await query.range(from, from + remainingRows - 1);
    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < INVENTORY_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

function cleanInventorySearch(value: string | null | undefined) {
  return (value ?? "").trim().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
}

async function getLocationIdsByName(locationName: string | null | undefined) {
  const cleanedLocationName = (locationName ?? "").trim();

  if (!cleanedLocationName) {
    return null;
  }

  const { data, error } = await getSupabaseClient().from("locations").select("id").eq("name", cleanedLocationName);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((location) => location.id);
}

function applyInventoryListFilters(query: InventoryItemsQuery, filters: InventoryListFilters | undefined, locationIds: string[] | null) {
  let nextQuery = query;
  const cleanedSearch = cleanInventorySearch(filters?.search);

  if (cleanedSearch) {
    const pattern = `%${cleanedSearch}%`;
    nextQuery = nextQuery.or(
      [
        `name.ilike.${pattern}`,
        `sku.ilike.${pattern}`,
        `brand.ilike.${pattern}`,
        `category.ilike.${pattern}`,
        `color.ilike.${pattern}`,
        `room.ilike.${pattern}`,
        `item_code.ilike.${pattern}`,
        `dimensions.ilike.${pattern}`,
        `notes.ilike.${pattern}`,
      ].join(","),
    );
  }

  if (filters?.color) {
    nextQuery = nextQuery.eq("color", filters.color);
  }

  if (filters?.category) {
    nextQuery = nextQuery.eq("category", canonicalizeInventoryCategory(filters.category) ?? filters.category);
  }

  if (filters?.room) {
    nextQuery = nextQuery.eq("room", filters.room);
  }

  if (locationIds) {
    nextQuery = nextQuery.in("current_location_id", locationIds);
  }

  return nextQuery;
}

async function listInventoryItemRowsPage<T>({
  selectClause,
  filters,
  maxRows,
}: {
  selectClause: string;
  filters?: InventoryListFilters;
  maxRows: number;
}) {
  const locationIds = await getLocationIdsByName(filters?.locationName);

  if (locationIds && locationIds.length === 0) {
    return { rows: [] as T[], totalCount: 0 };
  }

  const supabase = getSupabaseClient();
  const baseQuery = supabase.from("inventory_items").select(selectClause, { count: "exact" }) as unknown as InventoryItemsQuery;
  const query = applyInventoryListFilters(baseQuery, filters, locationIds)
    .order("created_at", { ascending: false })
    .range(0, maxRows - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as T[];

  return {
    rows,
    totalCount: count ?? rows.length,
  };
}

export type InventoryAssignableItem = Pick<
  Database["public"]["Tables"]["inventory_items"]["Row"],
  "id" | "name" | "category" | "status" | "item_code" | "room"
>;

export type InventoryPackCandidate = Pick<
  Database["public"]["Tables"]["inventory_items"]["Row"],
  "id" | "name" | "category" | "status" | "item_code" | "room" | "color" | "source_job_id" | "current_location_id"
> & {
  current_location_name: string | null;
  thumbnail_url: string | null;
};

export type InventoryItemUpdate = Pick<
  Database["public"]["Tables"]["inventory_items"]["Update"],
  | "name"
  | "sku"
  | "brand"
  | "category"
  | "status"
  | "condition"
  | "color"
  | "material"
  | "dimensions"
  | "notes"
  | "marked_for_disposal"
  | "estimated_listing_price_cents"
  | "purchase_price_cents"
  | "purchase_date"
  | "replacement_cost_cents"
  | "room"
  | "tags"
  | "current_location_id"
  | "source_job_id"
>;

async function hydrateInventoryListItems(items: InventoryItem[], includeThumbnails: boolean) {
  const supabase = getSupabaseClient();
  const locationIds = [...new Set(items.map((item) => item.current_location_id).filter((value): value is string => Boolean(value)))];
  const sourceJobIds = [...new Set(items.map((item) => item.source_job_id).filter((value): value is string => Boolean(value)))];
  const itemIds = items.map((item) => item.id);

  const [{ data: locations, error: locationError }, { data: jobs, error: jobError }, activeAssignments, photos] = await Promise.all([
    locationIds.length > 0 ? supabase.from("locations").select("id,name").in("id", locationIds) : Promise.resolve({ data: [], error: null }),
    sourceJobIds.length > 0 ? supabase.from("jobs").select("id,name").in("id", sourceJobIds) : Promise.resolve({ data: [], error: null }),
    listActiveJobAssignmentsForItems(itemIds),
    includeThumbnails ? listInventoryCoverPhotosForItems(itemIds) : Promise.resolve([]),
  ]);

  if (locationError) {
    throw new Error(locationError.message);
  }
  if (jobError) {
    throw new Error(jobError.message);
  }
  const activeJobIds = [...new Set(activeAssignments.map((assignment) => assignment.job_id))];
  const { data: activeJobs, error: activeJobsError } =
    activeJobIds.length > 0 ? await supabase.from("jobs").select("id,name").in("id", activeJobIds) : { data: [], error: null };

  if (activeJobsError) {
    throw new Error(activeJobsError.message);
  }

  const locationNameById = new Map((locations ?? []).map((location) => [location.id, location.name]));
  const jobNameById = new Map((jobs ?? []).map((job) => [job.id, job.name]));
  const activeJobNameById = new Map((activeJobs ?? []).map((job) => [job.id, job.name]));
  const activeJobNameByItemId = new Map(activeAssignments.map((assignment) => [assignment.item_id, activeJobNameById.get(assignment.job_id) ?? null]));
  const thumbnailUrlByItemId = new Map<string, string>();
  const signedUrlByKey = includeThumbnails ? await createSignedPhotoUrlMap(photos, THUMBNAIL_TRANSFORM) : new Map<string, string>();

  for (const photo of photos) {
    if (thumbnailUrlByItemId.has(photo.item_id)) {
      continue;
    }

    const signedUrl = signedUrlByKey.get(`${photo.storage_bucket}:${photo.storage_path}`);
    if (signedUrl) {
      thumbnailUrlByItemId.set(photo.item_id, signedUrl);
    }
  }

  return items.map((item) => ({
    ...item,
    current_location_name:
      activeJobNameByItemId.get(item.id) ??
      (item.current_location_id ? locationNameById.get(item.current_location_id) ?? null : null),
    source_job_name: item.source_job_id ? jobNameById.get(item.source_job_id) ?? null : null,
    thumbnail_url: thumbnailUrlByItemId.get(item.id) ?? null,
  })) as InventoryListItem[];
}

export async function listInventoryItems({ includeThumbnails = true, maxItems }: { includeThumbnails?: boolean; maxItems?: number } = {}) {
  const items = await listInventoryItemRows<InventoryItem>(
    "id,name,sku,category,status,condition,brand,color,material,dimensions,item_code,marked_for_disposal,notes,estimated_listing_price_cents,purchase_price_cents,purchase_date,replacement_cost_cents,current_location_id,room,source_job_id,tags",
    (query) => query.order("created_at", { ascending: false }),
    maxItems,
  );

  return hydrateInventoryListItems(items, includeThumbnails);
}

export async function listInventoryItemsPage({
  filters,
  includeThumbnails = true,
  maxItems,
}: {
  filters?: InventoryListFilters;
  includeThumbnails?: boolean;
  maxItems: number;
}) {
  const { rows, totalCount } = await listInventoryItemRowsPage<InventoryItem>({
    selectClause:
      "id,name,sku,category,status,condition,brand,color,material,dimensions,item_code,marked_for_disposal,notes,estimated_listing_price_cents,purchase_price_cents,purchase_date,replacement_cost_cents,current_location_id,room,source_job_id,tags",
    filters,
    maxRows: maxItems,
  });

  return {
    items: await hydrateInventoryListItems(rows, includeThumbnails),
    totalCount,
  };
}

export async function listInventoryItemThumbnails(itemIds: string[]) {
  const photos = await listInventoryCoverPhotosForItems(itemIds);
  const signedUrlByKey = await createSignedPhotoUrlMap(photos, THUMBNAIL_TRANSFORM);
  const thumbnailUrlByItemId = new Map<string, string>();

  for (const photo of photos) {
    if (thumbnailUrlByItemId.has(photo.item_id)) {
      continue;
    }

    const signedUrl = signedUrlByKey.get(`${photo.storage_bucket}:${photo.storage_path}`);
    if (signedUrl) {
      thumbnailUrlByItemId.set(photo.item_id, signedUrl);
    }
  }

  return thumbnailUrlByItemId;
}

export async function getInventoryItem(itemId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id,name,sku,category,status,condition,brand,color,material,dimensions,item_code,marked_for_disposal,notes,estimated_listing_price_cents,purchase_price_cents,purchase_date,replacement_cost_cents,current_location_id,room,source_job_id,tags")
    .eq("id", itemId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryItem;
}

export async function listAvailableInventoryItems() {
  return listInventoryItemRows<InventoryAssignableItem>(
    "id,name,category,status,item_code,room",
    (query) => query.eq("status", "available").order("name", { ascending: true }),
  );
}

export async function listPackListInventoryItems() {
  const items = await listInventoryItemRows<Omit<InventoryPackCandidate, "thumbnail_url" | "current_location_name">>(
    "id,name,category,status,item_code,room,color,source_job_id,current_location_id",
    (query) => query.order("name", { ascending: true }),
  );
  const locationIds = [...new Set(items.map((item) => item.current_location_id).filter((value): value is string => Boolean(value)))];
  const photos = await listInventoryCoverPhotosForItems(items.map((item) => item.id));
  const [locationsResult, signedUrlByKey] = await Promise.all([
    locationIds.length > 0 ? getSupabaseClient().from("locations").select("id,name").in("id", locationIds) : Promise.resolve({ data: [], error: null }),
    createSignedPhotoUrlMap(photos, THUMBNAIL_TRANSFORM),
  ]);

  if (locationsResult.error) {
    throw new Error(locationsResult.error.message);
  }

  const locationNameById = new Map((locationsResult.data ?? []).map((location) => [location.id, location.name]));
  const thumbnailUrlByItemId = new Map<string, string>();

  for (const photo of photos) {
    if (thumbnailUrlByItemId.has(photo.item_id)) {
      continue;
    }

    const signedUrl = signedUrlByKey.get(`${photo.storage_bucket}:${photo.storage_path}`);
    if (signedUrl) {
      thumbnailUrlByItemId.set(photo.item_id, signedUrl);
    }
  }

  return items.map((item) => ({
    ...item,
    current_location_name: item.current_location_id ? locationNameById.get(item.current_location_id) ?? null : null,
    thumbnail_url: thumbnailUrlByItemId.get(item.id) ?? null,
  })) as InventoryPackCandidate[];
}

export async function updateInventoryItem(itemId: string, payload: InventoryItemUpdate) {
  const supabase = getSupabaseClient();
  const normalizedPayload = {
    ...payload,
    category:
      Object.prototype.hasOwnProperty.call(payload, "category")
        ? canonicalizeInventoryCategory(payload.category ?? null)
        : payload.category,
  };
  const { data, error } = await supabase
    .from("inventory_items")
    .update(normalizedPayload)
    .eq("id", itemId)
    .select("id,name,sku,category,status,condition,brand,color,material,dimensions,item_code,marked_for_disposal,notes,estimated_listing_price_cents,purchase_price_cents,purchase_date,replacement_cost_cents,current_location_id,room,source_job_id,tags")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as InventoryItem;
}

export async function getInventoryItemContext(itemId: string) {
  const supabase = getSupabaseClient();
  const item = await getInventoryItem(itemId);

  const [locationsResult, jobsResult, photosResult, activeAssignmentResult, packListResult] = await Promise.all([
    supabase.from("locations").select("id,name,kind").order("name", { ascending: true }),
    supabase.from("jobs").select("id,name").order("created_at", { ascending: false }),
    supabase.from("inventory_photos").select("id,item_id,storage_bucket,storage_path,sort_order").eq("item_id", itemId).order("sort_order", { ascending: true }),
    supabase
      .from("job_items")
      .select("job_id,checked_out_at")
      .eq("item_id", itemId)
      .is("checked_in_at", null)
      .order("checked_out_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("job_pack_requests")
      .select("job_id,status")
      .eq("requested_item_id", itemId)
      .neq("status", "cancelled"),
  ]);

  if (locationsResult.error) {
    throw new Error(locationsResult.error.message);
  }
  if (jobsResult.error) {
    throw new Error(jobsResult.error.message);
  }
  if (photosResult.error) {
    throw new Error(photosResult.error.message);
  }
  if (activeAssignmentResult.error) {
    throw new Error(activeAssignmentResult.error.message);
  }
  if (packListResult.error) {
    throw new Error(packListResult.error.message);
  }

  const currentLocationName =
    item.current_location_id && locationsResult.data
      ? locationsResult.data.find((location) => location.id === item.current_location_id)?.name ?? null
      : null;
  const jobNameById = new Map((jobsResult.data ?? []).map((job) => [job.id, job.name]));
  const sourceJobName = item.source_job_id ? jobNameById.get(item.source_job_id) ?? null : null;
  const activeAssignmentJobId = activeAssignmentResult.data?.job_id ?? null;
  const activeAssignmentJobName = activeAssignmentJobId ? jobNameById.get(activeAssignmentJobId) ?? null : null;
  const packListJobNames = [...new Set((packListResult.data ?? []).map((row) => jobNameById.get(row.job_id)).filter((value): value is string => Boolean(value)))];
  const signedUrlByKey = await createSignedPhotoUrlMap((photosResult.data ?? []) as InventoryPhotoRow[]);
  const photos = ((photosResult.data ?? []) as InventoryPhotoRow[])
    .map((photo) => {
      const url = signedUrlByKey.get(`${photo.storage_bucket}:${photo.storage_path}`) ?? null;
      if (!url) {
        return null;
      }

      return {
        id: photo.id,
        url,
        sort_order: photo.sort_order,
        storage_bucket: photo.storage_bucket,
        storage_path: photo.storage_path,
      } satisfies InventoryPhoto;
    })
    .filter((photo): photo is InventoryPhoto => Boolean(photo));

  return {
    item,
    currentLocationName,
    sourceJobName,
    activeAssignment: activeAssignmentResult.data
      ? {
          job_id: activeAssignmentJobId,
          job_name: activeAssignmentJobName,
          checked_out_at: activeAssignmentResult.data.checked_out_at,
        }
      : null,
    packListJobNames,
    locations: locationsResult.data ?? [],
    jobs: jobsResult.data ?? [],
    photos,
  };
}

function toNullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPhotoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function uploadInventoryPhotos(itemId: string, imageUris: string[]) {
  if (imageUris.length === 0) {
    return;
  }

  const supabase = getSupabaseClient();
  const { count, error: countError } = await supabase.from("inventory_photos").select("*", { count: "exact", head: true }).eq("item_id", itemId);

  if (countError) {
    throw new Error(countError.message);
  }

  let nextSortOrder = count ?? 0;

  for (const imageUri of imageUris) {
    const fileBuffer = await fileUriToArrayBuffer(imageUri);
    const photoId = buildPhotoId();
    const storagePath = `items/${itemId}/${photoId}.jpg`;

    const { error: uploadError } = await supabase.storage.from("inventory").upload(storagePath, fileBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { error: photoError } = await supabase.from("inventory_photos").insert({
      item_id: itemId,
      storage_bucket: "inventory",
      storage_path: storagePath,
      sort_order: nextSortOrder,
    });
    if (photoError) {
      throw new Error(photoError.message);
    }

    nextSortOrder += 1;
  }
}

export async function createInventoryItemWithPhotos({
  name,
  category,
  color,
  dimensions,
  notes,
  markedForDisposal,
  estimatedListingPriceCents,
  purchasePriceCents,
  replacementCostCents,
  room,
  tags,
  batchName,
  sourceJobId,
  imageUris,
}: {
  name: string;
  category: string;
  color: string;
  dimensions: string;
  notes: string;
  markedForDisposal: boolean;
  estimatedListingPriceCents: number | null;
  purchasePriceCents: number | null;
  replacementCostCents: number | null;
  room: string;
  tags: string[];
  batchName: string;
  sourceJobId: string | null;
  imageUris: string[];
}) {
  const supabase = getSupabaseClient();
  let intakeBatchId: string | null = null;

  if (batchName.trim()) {
    let existingBatchQuery = supabase
      .from("intake_batches")
      .select("id")
      .eq("name", batchName.trim())
      .order("created_at", { ascending: false })
      .limit(1);

    existingBatchQuery = sourceJobId ? existingBatchQuery.eq("job_id", sourceJobId) : existingBatchQuery.is("job_id", null);

    const { data: existingBatch, error: loadBatchError } = await existingBatchQuery.maybeSingle();

    if (loadBatchError) {
      throw new Error(loadBatchError.message);
    }

    if (existingBatch) {
      intakeBatchId = existingBatch.id;
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: createdBatch, error: batchError } = await supabase
        .from("intake_batches")
        .insert({
          name: batchName.trim(),
          job_id: sourceJobId,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();

      if (batchError) {
        throw new Error(batchError.message);
      }

      intakeBatchId = createdBatch.id;
    }
  }

  const nextStatus: InventoryItemStatus = sourceJobId ? "on_job" : "available";
  const { data: item, error } = await supabase
    .from("inventory_items")
    .insert({
      name,
      category: canonicalizeInventoryCategory(category),
      color: toNullableText(color),
      dimensions: toNullableText(dimensions),
      marked_for_disposal: markedForDisposal,
      notes: toNullableText(notes),
      estimated_listing_price_cents: estimatedListingPriceCents,
      purchase_price_cents: purchasePriceCents,
      replacement_cost_cents: replacementCostCents,
      room: toNullableText(room),
      tags,
      status: nextStatus,
      condition: "good",
      intake_batch_id: intakeBatchId,
      source_job_id: sourceJobId,
    })
    .select("id,name,sku,category,status,condition,brand,color,material,dimensions,item_code,marked_for_disposal,notes,estimated_listing_price_cents,purchase_price_cents,purchase_date,replacement_cost_cents,current_location_id,room,source_job_id,tags")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await uploadInventoryPhotos(item.id, imageUris);

  if (sourceJobId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: assignmentError } = await supabase.from("job_items").insert({
      job_id: sourceJobId,
      item_id: item.id,
      checked_out_by: user?.id ?? null,
    });

    if (assignmentError) {
      throw new Error(assignmentError.message);
    }
  }

  return item as InventoryItem;
}

export async function addInventoryItemPhotos(itemId: string, imageUris: string[]) {
  await uploadInventoryPhotos(itemId, imageUris);
}

export async function setInventoryPhotoCover(itemId: string, photoId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_photos")
    .select("id,sort_order")
    .eq("item_id", itemId)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const photos = (data ?? []) as Pick<InventoryPhotoRow, "id" | "sort_order">[];
  const target = photos.find((photo) => photo.id === photoId);
  if (!target) {
    throw new Error("Photo not found.");
  }

  const reorderedIds = [photoId, ...photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id)];
  for (const [index, id] of reorderedIds.entries()) {
    const { error: updateError } = await supabase.from("inventory_photos").update({ sort_order: index }).eq("id", id);
    if (updateError) {
      throw new Error(updateError.message);
    }
  }
}

export async function deleteInventoryPhoto(itemId: string, photoId: string) {
  const supabase = getSupabaseClient();
  const { data: photo, error: loadError } = await supabase
    .from("inventory_photos")
    .select("id,item_id,storage_bucket,storage_path,sort_order")
    .eq("id", photoId)
    .eq("item_id", itemId)
    .single();

  if (loadError) {
    throw new Error(loadError.message);
  }

  const { error: storageError } = await supabase.storage.from(photo.storage_bucket).remove([photo.storage_path]);
  if (storageError) {
    throw new Error(storageError.message);
  }

  const { error: deleteError } = await supabase.from("inventory_photos").delete().eq("id", photoId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { data: remaining, error: remainingError } = await supabase
    .from("inventory_photos")
    .select("id")
    .eq("item_id", itemId)
    .order("sort_order", { ascending: true });

  if (remainingError) {
    throw new Error(remainingError.message);
  }

  for (const [index, remainingPhoto] of ((remaining ?? []) as Pick<InventoryPhotoRow, "id">[]).entries()) {
    const { error: updateError } = await supabase.from("inventory_photos").update({ sort_order: index }).eq("id", remainingPhoto.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
  }
}

export async function deleteInventoryItem(itemId: string) {
  const supabase = getSupabaseClient();
  const { data: photos, error: photosError } = await supabase
    .from("inventory_photos")
    .select("id,storage_bucket,storage_path")
    .eq("item_id", itemId);

  if (photosError) {
    throw new Error(photosError.message);
  }

  const pathsByBucket = new Map<string, string[]>();
  for (const photo of photos ?? []) {
    const bucketPaths = pathsByBucket.get(photo.storage_bucket) ?? [];
    bucketPaths.push(photo.storage_path);
    pathsByBucket.set(photo.storage_bucket, bucketPaths);
  }

  for (const [bucket, storagePaths] of pathsByBucket.entries()) {
    if (storagePaths.length === 0) {
      continue;
    }

    const { error: storageError } = await supabase.storage.from(bucket).remove(storagePaths);
    if (storageError) {
      throw new Error(storageError.message);
    }
  }

  const { error: pickItemsError } = await supabase.from("job_pick_items").delete().eq("item_id", itemId);
  if (pickItemsError) {
    throw new Error(pickItemsError.message);
  }

  const { error: jobItemsError } = await supabase.from("job_items").delete().eq("item_id", itemId);
  if (jobItemsError) {
    throw new Error(jobItemsError.message);
  }

  const { error: packRequestsError } = await supabase.from("job_pack_requests").update({ requested_item_id: null }).eq("requested_item_id", itemId);
  if (packRequestsError) {
    throw new Error(packRequestsError.message);
  }

  const { error: photoRowsError } = await supabase.from("inventory_photos").delete().eq("item_id", itemId);
  if (photoRowsError) {
    throw new Error(photoRowsError.message);
  }

  const { error: itemError } = await supabase.from("inventory_items").delete().eq("id", itemId);
  if (itemError) {
    throw new Error(itemError.message);
  }
}

export async function createInventoryItemWithPhoto({
  name,
  category,
  color,
  dimensions,
  notes,
  markedForDisposal,
  estimatedListingPriceCents,
  purchasePriceCents,
  replacementCostCents,
  room,
  tags,
  batchName,
  sourceJobId,
  imageUri,
}: {
  name: string;
  category: string;
  color: string;
  dimensions: string;
  notes: string;
  markedForDisposal: boolean;
  estimatedListingPriceCents: number | null;
  purchasePriceCents: number | null;
  replacementCostCents: number | null;
  room: string;
  tags: string[];
  batchName: string;
  sourceJobId: string | null;
  imageUri: string | null;
}) {
  return createInventoryItemWithPhotos({
    name,
    category,
    color,
    dimensions,
    notes,
    markedForDisposal,
    estimatedListingPriceCents,
    purchasePriceCents,
    replacementCostCents,
    room,
    tags,
    batchName,
    sourceJobId,
    imageUris: imageUri ? [imageUri] : [],
  });
}
