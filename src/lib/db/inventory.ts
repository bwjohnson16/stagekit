import "server-only";

import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type InventoryItemRow = Database["public"]["Tables"]["inventory_items"]["Row"];
type InventoryItemInsert = Database["public"]["Tables"]["inventory_items"]["Insert"];
type InventoryItemUpdate = Database["public"]["Tables"]["inventory_items"]["Update"];
type InventoryPhotoRow = Database["public"]["Tables"]["inventory_photos"]["Row"];

const inventoryStatusSchema = z.enum(["available", "on_job", "packed", "maintenance", "sold", "lost"]);
const inventoryConditionSchema = z.enum(["new", "like_new", "good", "fair", "rough"]);
const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const INVENTORY_PAGE_SIZE = 500;

const listItemsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  status: inventoryStatusSchema.optional(),
  category: z.string().trim().min(1).optional(),
  disposition: z.enum(["keep", "dispose"]).optional(),
});

const createItemSchema = z.object({
  sku: z.string().trim().min(1).max(120).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(120).nullable().optional(),
  material: z.string().trim().max(120).nullable().optional(),
  dimensions: z.string().trim().max(120).nullable().optional(),
  status: inventoryStatusSchema.optional(),
  condition: inventoryConditionSchema.optional(),
  marked_for_disposal: z.boolean().optional(),
  estimated_listing_price_cents: z.number().int().nonnegative().nullable().optional(),
  purchase_price_cents: z.number().int().nonnegative().nullable().optional(),
  replacement_cost_cents: z.number().int().nonnegative().nullable().optional(),
  purchase_date: dateSchema.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  home_location_id: uuidSchema.nullable().optional(),
  current_location_id: uuidSchema.nullable().optional(),
});

const updateItemSchema = createItemSchema.partial();
const addPhotoRowSchema = z.object({
  itemId: uuidSchema,
  storagePath: z.string().trim().min(1),
  sortOrder: z.number().int().nonnegative().default(0),
});

const assignItemSchema = z.object({
  jobId: uuidSchema,
  itemId: uuidSchema,
});

const checkInItemSchema = z.object({
  jobItemId: uuidSchema,
});

export type InventoryItemStatus = z.infer<typeof inventoryStatusSchema>;
export type InventoryItemCondition = z.infer<typeof inventoryConditionSchema>;

export type ListItemsParams = z.input<typeof listItemsSchema>;

export type InventoryListRow = Pick<
  InventoryItemRow,
  "id" | "sku" | "name" | "category" | "status" | "condition" | "current_location_id" | "marked_for_disposal" | "estimated_listing_price_cents"
> & {
  current_location_name: string | null;
};

type InventoryItemsQuery = {
  eq: (...args: unknown[]) => InventoryItemsQuery;
  or: (...args: unknown[]) => InventoryItemsQuery;
  order: (...args: unknown[]) => InventoryItemsQuery;
  range: (from: number, to: number) => Promise<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
};

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function assertData<T>(data: T | null, label: string) {
  if (!data) {
    throw new Error(`${label}: empty response`);
  }
  return data;
}

async function listInventoryItemRows<T>(selectClause: string, configure?: (query: InventoryItemsQuery) => InventoryItemsQuery) {
  const supabase = await createServerSupabaseClient();
  const rows: T[] = [];

  for (let from = 0; ; from += INVENTORY_PAGE_SIZE) {
    let query: InventoryItemsQuery = supabase.from("inventory_items").select(selectClause) as unknown as InventoryItemsQuery;
    if (configure) {
      query = configure(query);
    }

    const { data, error } = await query.range(from, from + INVENTORY_PAGE_SIZE - 1);
    assertNoError(error, "Failed to list inventory items");

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < INVENTORY_PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export async function listItems(params: ListItemsParams = {}) {
  const parsed = listItemsSchema.parse(params);
  const supabase = await createServerSupabaseClient();
  const rows = await listInventoryItemRows<Pick<
    InventoryItemRow,
    "id" | "sku" | "name" | "category" | "status" | "condition" | "current_location_id" | "marked_for_disposal" | "estimated_listing_price_cents"
  >>("id,sku,name,category,status,condition,current_location_id,marked_for_disposal,estimated_listing_price_cents", (query) => {
    let next = query.order("created_at", { ascending: false });

    if (parsed.q) {
      const term = parsed.q.replaceAll(",", " ");
      next = next.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
    }

    if (parsed.status) {
      next = next.eq("status", parsed.status);
    }

    if (parsed.category) {
      next = next.eq("category", parsed.category);
    }

    if (parsed.disposition === "dispose") {
      next = next.eq("marked_for_disposal", true);
    }

    if (parsed.disposition === "keep") {
      next = next.eq("marked_for_disposal", false);
    }

    return next;
  });
  const locationIds = [
    ...new Set(rows.map((row) => row.current_location_id).filter((value): value is string => Boolean(value))),
  ];

  const locationNamesById = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data: locations, error: locationsError } = await supabase
      .from("locations")
      .select("id,name")
      .in("id", locationIds);
    assertNoError(locationsError, "Failed to load locations");
    (locations ?? []).forEach((location) => {
      locationNamesById.set(location.id, location.name);
    });
  }

  return rows.map((row) => ({
    ...row,
    current_location_name: row.current_location_id ? locationNamesById.get(row.current_location_id) ?? null : null,
  })) as InventoryListRow[];
}

export async function getItem(id: string) {
  const parsedId = uuidSchema.parse(id);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("inventory_items").select("*").eq("id", parsedId).maybeSingle();
  assertNoError(error, "Failed to load inventory item");
  return data;
}

export async function createItem(payload: InventoryItemInsert) {
  const parsedPayload = createItemSchema.parse(payload);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.from("inventory_items").insert(parsedPayload).select("*").single();
  assertNoError(error, "Failed to create inventory item");
  return assertData(data, "Failed to create inventory item");
}

export async function updateItem(id: string, payload: InventoryItemUpdate) {
  const parsedId = uuidSchema.parse(id);
  const parsedPayload = updateItemSchema.parse(payload);
  const supabase = await createServerSupabaseClient();

  if (Object.keys(parsedPayload).length === 0) {
    return getItem(parsedId);
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .update(parsedPayload)
    .eq("id", parsedId)
    .select("*")
    .single();
  assertNoError(error, "Failed to update inventory item");
  return assertData(data, "Failed to update inventory item");
}

export async function listPhotos(itemId: string) {
  const parsedItemId = uuidSchema.parse(itemId);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_photos")
    .select("*")
    .eq("item_id", parsedItemId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  assertNoError(error, "Failed to list photos");
  return (data ?? []) as InventoryPhotoRow[];
}

export async function addPhotoRow(itemId: string, storagePath: string, sortOrder = 0) {
  const parsed = addPhotoRowSchema.parse({ itemId, storagePath, sortOrder });
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_photos")
    .insert({
      item_id: parsed.itemId,
      storage_path: parsed.storagePath,
      sort_order: parsed.sortOrder,
      storage_bucket: "inventory",
    })
    .select("*")
    .single();

  assertNoError(error, "Failed to add photo row");
  return assertData(data, "Failed to add photo row");
}

export async function deleteItem(id: string) {
  const parsedId = uuidSchema.parse(id);
  const supabase = await createServerSupabaseClient();

  const { data: photos, error: photosError } = await supabase
    .from("inventory_photos")
    .select("storage_bucket,storage_path")
    .eq("item_id", parsedId);
  assertNoError(photosError, "Failed to load inventory photos");

  const pathsByBucket = new Map<string, string[]>();
  (photos ?? []).forEach((photo) => {
    const bucketPaths = pathsByBucket.get(photo.storage_bucket) ?? [];
    bucketPaths.push(photo.storage_path);
    pathsByBucket.set(photo.storage_bucket, bucketPaths);
  });

  for (const [bucket, storagePaths] of pathsByBucket.entries()) {
    if (storagePaths.length === 0) continue;
    const { error } = await supabase.storage.from(bucket).remove(storagePaths);
    assertNoError(error, "Failed to remove inventory photo files");
  }

  const { error: pickItemsError } = await supabase.from("job_pick_items").delete().eq("item_id", parsedId);
  assertNoError(pickItemsError, "Failed to delete job pick rows");

  const { error: jobItemsError } = await supabase.from("job_items").delete().eq("item_id", parsedId);
  assertNoError(jobItemsError, "Failed to delete job item rows");

  const { error: packRequestsError } = await supabase.from("job_pack_requests").update({ requested_item_id: null }).eq("requested_item_id", parsedId);
  assertNoError(packRequestsError, "Failed to clear pack request links");

  const { error: photoRowsError } = await supabase.from("inventory_photos").delete().eq("item_id", parsedId);
  assertNoError(photoRowsError, "Failed to delete inventory photo rows");

  const { error: itemError } = await supabase.from("inventory_items").delete().eq("id", parsedId);
  assertNoError(itemError, "Failed to delete inventory item");
}

export async function assignItemToJob(jobId: string, itemId: string) {
  const parsed = assignItemSchema.parse({ jobId, itemId });
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: activeAssignment, error: activeAssignmentError } = await supabase
    .from("job_items")
    .select("id,job_id")
    .eq("item_id", parsed.itemId)
    .is("checked_in_at", null)
    .maybeSingle();
  assertNoError(activeAssignmentError, "Failed to check current assignment");
  if (activeAssignment) {
    throw new Error(activeAssignment.job_id === parsed.jobId ? "Item is already assigned to this job." : "Item is already assigned to another active job.");
  }

  const { data: item, error: itemError } = await supabase.from("inventory_items").select("id,status").eq("id", parsed.itemId).single();
  assertNoError(itemError, "Failed to load inventory item");
  if (!item || item.status !== "available") {
    throw new Error(`Item is not available. Current status: ${item?.status ?? "unknown"}.`);
  }

  const { data, error } = await supabase
    .from("job_items")
    .insert({
      job_id: parsed.jobId,
      item_id: parsed.itemId,
      checked_out_by: user?.id ?? null,
    })
    .select("*")
    .single();
  assertNoError(error, "Failed to assign item to job");

  const { error: itemStatusError } = await supabase
    .from("inventory_items")
    .update({ status: "on_job" })
    .eq("id", parsed.itemId);
  assertNoError(itemStatusError, "Failed to update item status to on_job");

  return assertData(data, "Failed to assign item to job");
}

export async function checkInItem(jobItemId: string) {
  const parsed = checkInItemSchema.parse({ jobItemId });
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: jobItem, error: loadError } = await supabase
    .from("job_items")
    .select("id,item_id,checked_in_at")
    .eq("id", parsed.jobItemId)
    .single();
  assertNoError(loadError, "Failed to load job item");
  const checkedOutJobItem = assertData(jobItem, "Failed to load job item");

  const checkInTimestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from("job_items")
    .update({
      checked_in_at: checkInTimestamp,
      checked_in_by: user?.id ?? null,
    })
    .eq("id", parsed.jobItemId)
    .select("*")
    .single();
  assertNoError(error, "Failed to check in job item");

  const { error: itemStatusError } = await supabase
    .from("inventory_items")
    .update({ status: "available" })
    .eq("id", checkedOutJobItem.item_id);
  assertNoError(itemStatusError, "Failed to update item status to available");

  return assertData(data, "Failed to check in job item");
}
