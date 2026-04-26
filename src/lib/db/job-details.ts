import "server-only";

import type { Database } from "@/lib/supabase/database.types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type InventoryItemRow = Database["public"]["Tables"]["inventory_items"]["Row"];
type LocationRow = Database["public"]["Tables"]["locations"]["Row"];
type JobPackRequestRow = Database["public"]["Tables"]["job_pack_requests"]["Row"];
type SceneTemplateRow = Database["public"]["Tables"]["scene_templates"]["Row"];
type SceneTemplateItemRow = Database["public"]["Tables"]["scene_template_items"]["Row"];

type PostgrestLikeError = {
  code?: string;
  details?: string | null;
  message?: string;
};

const SCENE_SCHEMA_TOKENS = [
  "job_scene_applications",
  "scene_templates",
  "scene_template_items",
  "scene_application_id",
  "scene_template_item_id",
];

const SCENE_FEATURE_UNAVAILABLE_MESSAGE =
  "Scene templates are not available in this database yet. Apply the latest Supabase migration and reload.";

function buildAddressLabel(parts: Array<string | null | undefined>) {
  const value = parts.filter(Boolean).join(", ");
  return value.length > 0 ? value : null;
}

function isMissingSceneSchemaError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as PostgrestLikeError;
  const haystack = `${value.code ?? ""} ${value.message ?? ""} ${value.details ?? ""}`.toLowerCase();

  return SCENE_SCHEMA_TOKENS.some((token) => haystack.includes(token));
}

function toSceneSchemaAwareError(error: unknown) {
  if (isMissingSceneSchemaError(error)) {
    return new Error(SCENE_FEATURE_UNAVAILABLE_MESSAGE);
  }

  if (error instanceof Error) {
    return error;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return new Error(error.message);
  }

  return new Error("Unknown error");
}

function mapJobDetailRow(
  row: Pick<JobRow, "id" | "name" | "status" | "notes" | "address1" | "address2" | "address_label" | "city" | "state" | "postal" | "latitude" | "longitude">,
): JobDetail {
  return {
    ...row,
    address_label: row.address_label ?? buildAddressLabel([row.address1, row.address2, row.city, row.state, row.postal]),
  };
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

async function buildUniqueSceneSlug(name: string) {
  const supabase = await createServerSupabaseClient();
  const baseSlug = slugify(name) || "scene-template";
  const { data, error } = await supabase.from("scene_templates").select("slug").ilike("slug", `${baseSlug}%`);

  if (error) {
    throw toSceneSchemaAwareError(error);
  }

  const existingSlugs = new Set((data ?? []).map((row) => row.slug));
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}

async function listJobPackRequestsCompat(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, jobId: string) {
  const { data, error } = await supabase
    .from("job_pack_requests")
    .select("id,request_text,quantity,room,category,color,notes,optional,status,requested_item_id,scene_application_id,scene_template_item_id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (!error) {
    return (data ?? []) as Array<
      Pick<
        JobPackRequestRow,
        "id" | "request_text" | "quantity" | "room" | "category" | "color" | "notes" | "optional" | "status" | "requested_item_id" | "scene_application_id" | "scene_template_item_id"
      >
    >;
  }

  if (!isMissingSceneSchemaError(error)) {
    throw new Error(error.message);
  }

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("job_pack_requests")
    .select("id,request_text,quantity,room,category,color,notes,optional,status,requested_item_id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (fallbackError) {
    throw new Error(fallbackError.message);
  }

  return (fallbackData ?? []).map((row) => ({
    ...row,
    scene_application_id: null,
    scene_template_item_id: null,
  }));
}

async function listJobSceneApplicationsCompat(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, jobId: string) {
  const { data, error } = await supabase
    .from("job_scene_applications")
    .select("id,job_id,scene_template_id,room_label,notes,created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSceneSchemaError(error)) {
      return [] as Array<{
        id: string;
        job_id: string;
        scene_template_id: string;
        room_label: string;
        notes: string | null;
        created_at: string;
      }>;
    }

    throw new Error(error.message);
  }

  return (data ?? []) as Array<{
    id: string;
    job_id: string;
    scene_template_id: string;
    room_label: string;
    notes: string | null;
    created_at: string;
  }>;
}

export type JobDetail = Pick<
  JobRow,
  "id" | "name" | "status" | "notes" | "address1" | "address2" | "address_label" | "city" | "state" | "postal" | "latitude" | "longitude"
>;

export type JobAssignment = {
  id: string;
  item_id: string;
  checked_out_at: string;
  checked_in_at: string | null;
  item_name: string;
  item_category: string | null;
  item_status: string;
  item_code: string;
  item_room: string | null;
};

export type JobPickItem = {
  id: string;
  pack_request_id: string | null;
  item_id: string;
  notes: string | null;
  created_at: string;
  item_name: string;
  item_category: string | null;
  item_color: string | null;
  item_status: string;
  item_code: string;
  item_room: string | null;
};

export type JobPackRequest = {
  id: string;
  request_text: string;
  quantity: number;
  room: string | null;
  category: string | null;
  color: string | null;
  notes: string | null;
  optional: boolean;
  status: string;
  requested_item_id: string | null;
  scene_application_id: string | null;
  scene_template_item_id: string | null;
  scene_template_name: string | null;
  scene_room_label: string | null;
  requested_item_name: string | null;
  requested_item_code: string | null;
  requested_item_status: string | null;
  active_job_names: string[];
  picked_items: JobPickItem[];
  picked_count: number;
};

export type JobSceneApplication = {
  id: string;
  scene_template_id: string;
  scene_template_name: string;
  room_label: string;
  notes: string | null;
  created_at: string;
  pack_request_count: number;
  fulfilled_request_count: number;
};

export type InventoryPackCandidate = Pick<
  InventoryItemRow,
  "id" | "name" | "category" | "status" | "item_code" | "room" | "color" | "source_job_id" | "current_location_id"
> & {
  current_location_name: string | null;
};

export type SceneTemplateItem = Pick<
  SceneTemplateItemRow,
  "id" | "request_text" | "quantity" | "category" | "color" | "notes" | "optional" | "is_anchor" | "requested_item_id"
> & {
  requested_item_name: string | null;
  requested_item_code: string | null;
};

export type SceneTemplate = Pick<
  SceneTemplateRow,
  "id" | "slug" | "name" | "room_type" | "style_label" | "summary" | "notes" | "sort_order"
> & {
  item_count: number;
  items: SceneTemplateItem[];
};

export async function listPackListInventoryItems() {
  const supabase = await createServerSupabaseClient();
  const { data: items, error: itemsError } = await supabase
    .from("inventory_items")
    .select("id,name,category,status,item_code,room,color,source_job_id,current_location_id")
    .order("name", { ascending: true });

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  const locationIds = [...new Set((items ?? []).map((item) => item.current_location_id).filter((value): value is string => Boolean(value)))];
  const { data: locations, error: locationsError } =
    locationIds.length === 0
      ? { data: [] as Pick<LocationRow, "id" | "name">[], error: null }
      : await supabase.from("locations").select("id,name").in("id", locationIds);

  if (locationsError) {
    throw new Error(locationsError.message);
  }

  const locationNameById = new Map((locations ?? []).map((location) => [location.id, location.name]));

  return (items ?? []).map((item) => ({
    ...item,
    current_location_name: item.current_location_id ? locationNameById.get(item.current_location_id) ?? null : null,
  })) as InventoryPackCandidate[];
}

export async function updateJob({
  jobId,
  name,
  address1,
  address2,
  city,
  state,
  postal,
  notes,
  status,
}: {
  jobId: string;
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  notes: string;
  status: string;
}) {
  const supabase = await createServerSupabaseClient();
  const normalizedAddress1 = address1.trim();
  const normalizedAddress2 = address2.trim();
  const normalizedCity = city.trim();
  const normalizedState = state.trim();
  const normalizedPostal = postal.trim();

  const { error } = await supabase
    .from("jobs")
    .update({
      name: name.trim(),
      address1: normalizedAddress1 || null,
      address2: normalizedAddress2 || null,
      city: normalizedCity || null,
      state: normalizedState || null,
      postal: normalizedPostal || null,
      notes: notes.trim() || null,
      status: status.trim(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getJobDetail(jobId: string) {
  const supabase = await createServerSupabaseClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,name,status,notes,address1,address2,address_label,city,state,postal,latitude,longitude")
    .eq("id", jobId)
    .single();

  if (jobError) {
    throw new Error(jobError.message);
  }

  const [
    { data: jobItems, error: jobItemsError },
    packRequests,
    { data: pickedItems, error: pickedItemsError },
    sceneApplications,
  ] = await Promise.all([
    supabase.from("job_items").select("id,item_id,checked_out_at,checked_in_at").eq("job_id", jobId).order("checked_out_at", { ascending: false }),
    listJobPackRequestsCompat(supabase, jobId),
    supabase.from("job_pick_items").select("id,job_id,pack_request_id,item_id,notes,created_at").eq("job_id", jobId).order("created_at", { ascending: false }),
    listJobSceneApplicationsCompat(supabase, jobId),
  ]);

  if (jobItemsError) {
    throw new Error(jobItemsError.message);
  }
  if (pickedItemsError) {
    throw new Error(pickedItemsError.message);
  }

  const assignedItemIds = [...new Set((jobItems ?? []).map((row) => row.item_id))];
  const requestedItemIds = [...new Set(packRequests.map((row) => row.requested_item_id).filter((value): value is string => Boolean(value)))];
  const pickedItemIds = [...new Set((pickedItems ?? []).map((row) => row.item_id))];
  const sceneTemplateIds = [...new Set(sceneApplications.map((row) => row.scene_template_id))];
  const referencedItemIds = [...new Set([...assignedItemIds, ...requestedItemIds, ...pickedItemIds])];

  const { data: referencedItems, error: referencedItemsError } =
    referencedItemIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("inventory_items").select("id,name,category,color,status,item_code,room").in("id", referencedItemIds);

  if (referencedItemsError) {
    throw new Error(referencedItemsError.message);
  }

  const { data: activeRequestAssignments, error: activeRequestAssignmentsError } =
    requestedItemIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("job_items").select("job_id,item_id").in("item_id", requestedItemIds).is("checked_in_at", null);

  if (activeRequestAssignmentsError) {
    throw new Error(activeRequestAssignmentsError.message);
  }

  const activeJobIds = [...new Set((activeRequestAssignments ?? []).map((row) => row.job_id))];
  const { data: activeJobs, error: activeJobsError } =
    activeJobIds.length === 0 ? { data: [], error: null } : await supabase.from("jobs").select("id,name").in("id", activeJobIds);

  if (activeJobsError) {
    throw new Error(activeJobsError.message);
  }

  const { data: sceneTemplates, error: sceneTemplatesError } =
    sceneTemplateIds.length === 0 ? { data: [], error: null } : await supabase.from("scene_templates").select("id,name").in("id", sceneTemplateIds);

  if (sceneTemplatesError) {
    throw toSceneSchemaAwareError(sceneTemplatesError);
  }

  const itemsById = new Map((referencedItems ?? []).map((item) => [item.id, item]));
  const jobNameById = new Map((activeJobs ?? []).map((activeJob) => [activeJob.id, activeJob.name]));
  const sceneTemplateNameById = new Map((sceneTemplates ?? []).map((template) => [template.id, template.name]));
  const sceneApplicationsById = new Map(
    sceneApplications.map((application) => [
      application.id,
      {
        ...application,
        scene_template_name: sceneTemplateNameById.get(application.scene_template_id) ?? "Unknown scene",
      },
    ]),
  );

  const assignments = (jobItems ?? []).map((jobItem) => {
    const item = itemsById.get(jobItem.item_id);

    return {
      id: jobItem.id,
      item_id: jobItem.item_id,
      checked_out_at: jobItem.checked_out_at,
      checked_in_at: jobItem.checked_in_at,
      item_name: item?.name ?? "Unknown item",
      item_category: item?.category ?? null,
      item_status: item?.status ?? "unknown",
      item_code: item?.item_code ?? "unknown",
      item_room: item?.room ?? null,
    };
  }) as JobAssignment[];

  const activeJobNamesByItemId = (activeRequestAssignments ?? []).reduce<Record<string, string[]>>((acc, row) => {
    const jobName = jobNameById.get(row.job_id);
    if (!jobName) {
      return acc;
    }

    acc[row.item_id] = [...(acc[row.item_id] ?? []), jobName];
    return acc;
  }, {});

  const exactPickList = (pickedItems ?? []).map((pickedItem) => {
    const item = itemsById.get(pickedItem.item_id);
    return {
      id: pickedItem.id,
      pack_request_id: pickedItem.pack_request_id,
      item_id: pickedItem.item_id,
      notes: pickedItem.notes,
      created_at: pickedItem.created_at,
      item_name: item?.name ?? "Unknown item",
      item_category: item?.category ?? null,
      item_color: item?.color ?? null,
      item_status: item?.status ?? "unknown",
      item_code: item?.item_code ?? "unknown",
      item_room: item?.room ?? null,
    };
  }) as JobPickItem[];

  const pickedItemsByRequestId = exactPickList.reduce<Record<string, JobPickItem[]>>((acc, pickedItem) => {
    if (!pickedItem.pack_request_id) {
      return acc;
    }

    acc[pickedItem.pack_request_id] = [...(acc[pickedItem.pack_request_id] ?? []), pickedItem];
    return acc;
  }, {});

  const packRequestList = packRequests.map((request) => {
    const requestedItem = request.requested_item_id ? itemsById.get(request.requested_item_id) : null;
    const requestPickedItems = pickedItemsByRequestId[request.id] ?? [];
    const sceneApplication = request.scene_application_id ? sceneApplicationsById.get(request.scene_application_id) : null;

    return {
      id: request.id,
      request_text: request.request_text,
      quantity: request.quantity,
      room: request.room,
      category: request.category,
      color: request.color,
      notes: request.notes,
      optional: request.optional,
      status: request.status,
      requested_item_id: request.requested_item_id,
      scene_application_id: request.scene_application_id,
      scene_template_item_id: request.scene_template_item_id,
      scene_template_name: sceneApplication?.scene_template_name ?? null,
      scene_room_label: sceneApplication?.room_label ?? null,
      requested_item_name: requestedItem?.name ?? null,
      requested_item_code: requestedItem?.item_code ?? null,
      requested_item_status: requestedItem?.status ?? null,
      active_job_names:
        request.requested_item_id != null ? [...new Set((activeJobNamesByItemId[request.requested_item_id] ?? []).filter((name) => name !== job.name))] : [],
      picked_items: requestPickedItems,
      picked_count: requestPickedItems.length,
    };
  }) as JobPackRequest[];

  const packRequestStatsBySceneApplicationId = packRequestList.reduce<Record<string, { total: number; fulfilled: number }>>((acc, request) => {
    if (!request.scene_application_id) {
      return acc;
    }

    const current = acc[request.scene_application_id] ?? { total: 0, fulfilled: 0 };
    current.total += 1;
    if (request.picked_count >= request.quantity) {
      current.fulfilled += 1;
    }
    acc[request.scene_application_id] = current;
    return acc;
  }, {});

  const appliedScenes = sceneApplications.map((application) => {
    const stats = packRequestStatsBySceneApplicationId[application.id] ?? { total: 0, fulfilled: 0 };

    return {
      id: application.id,
      scene_template_id: application.scene_template_id,
      scene_template_name: sceneTemplateNameById.get(application.scene_template_id) ?? "Unknown scene",
      room_label: application.room_label,
      notes: application.notes,
      created_at: application.created_at,
      pack_request_count: stats.total,
      fulfilled_request_count: stats.fulfilled,
    };
  }) as JobSceneApplication[];

  return {
    job: mapJobDetailRow(job),
    assignments,
    packRequests: packRequestList,
    pickedItems: exactPickList,
    sceneApplications: appliedScenes,
  };
}

export async function createPackRequest({
  jobId,
  requestText,
  quantity,
  room,
  category,
  color,
  notes,
  optional,
  requestedItemId,
}: {
  jobId: string;
  requestText: string;
  quantity: number;
  room: string;
  category: string;
  color: string;
  notes: string;
  optional: boolean;
  requestedItemId: string | null;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("job_pack_requests")
    .insert({
      job_id: jobId,
      request_text: requestText.trim(),
      quantity,
      room: room.trim() || null,
      category: category.trim() || null,
      color: color.trim() || null,
      notes: notes.trim() || null,
      optional,
      requested_item_id: requestedItemId,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data.id;
}

export async function updatePackRequest({
  packRequestId,
  requestText,
  quantity,
  room,
  category,
  color,
  notes,
  optional,
  requestedItemId,
}: {
  packRequestId: string;
  requestText: string;
  quantity: number;
  room: string;
  category: string;
  color: string;
  notes: string;
  optional: boolean;
  requestedItemId: string | null;
}) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("job_pack_requests")
    .update({
      request_text: requestText.trim(),
      quantity,
      room: room.trim() || null,
      category: category.trim() || null,
      color: color.trim() || null,
      notes: notes.trim() || null,
      optional,
      requested_item_id: requestedItemId,
    })
    .eq("id", packRequestId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updatePackRequestStatus(packRequestId: string, status: "requested" | "packed" | "cancelled") {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("job_pack_requests").update({ status }).eq("id", packRequestId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deletePackRequest(packRequestId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("job_pack_requests").delete().eq("id", packRequestId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function togglePackRequestOptional(packRequestId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("job_pack_requests").select("optional").eq("id", packRequestId).single();

  if (error) {
    throw new Error(error.message);
  }

  const { error: updateError } = await supabase.from("job_pack_requests").update({ optional: !data.optional }).eq("id", packRequestId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return !data.optional;
}

export async function createJobPickItem({
  jobId,
  itemId,
  packRequestId,
  notes,
}: {
  jobId: string;
  itemId: string;
  packRequestId?: string | null;
  notes?: string;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: existingPick, error: existingPickError }, { data: activeAssignment, error: activeAssignmentError }, { data: item, error: itemError }] =
    await Promise.all([
      supabase.from("job_pick_items").select("id,job_id").eq("item_id", itemId).limit(1).maybeSingle(),
      supabase.from("job_items").select("job_id").eq("item_id", itemId).is("checked_in_at", null).limit(1).maybeSingle(),
      supabase.from("inventory_items").select("id,status").eq("id", itemId).single(),
    ]);

  if (existingPickError) {
    throw new Error(existingPickError.message);
  }
  if (activeAssignmentError) {
    throw new Error(activeAssignmentError.message);
  }
  if (itemError) {
    throw new Error(itemError.message);
  }

  if (existingPick) {
    throw new Error(existingPick.job_id === jobId ? "This item is already logged for this project." : "This item is already logged for another project.");
  }

  if (activeAssignment && activeAssignment.job_id !== jobId) {
    throw new Error("This item is already assigned to another active project.");
  }

  if (item.status !== "available" && !(item.status === "on_job" && activeAssignment?.job_id === jobId)) {
    throw new Error(`Item cannot be logged right now. Current status: ${item.status}.`);
  }

  const { error } = await supabase.from("job_pick_items").insert({
    job_id: jobId,
    item_id: itemId,
    pack_request_id: packRequestId ?? null,
    notes: notes?.trim() || null,
    picked_by: user?.id ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteJobPickItem(jobPickItemId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("job_pick_items").delete().eq("id", jobPickItemId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listSceneTemplates() {
  const supabase = await createServerSupabaseClient();
  const { data: templates, error: templatesError } = await supabase
    .from("scene_templates")
    .select("id,slug,name,room_type,style_label,summary,notes,sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (templatesError) {
    if (isMissingSceneSchemaError(templatesError)) {
      return [] as SceneTemplate[];
    }

    throw new Error(templatesError.message);
  }

  const templateIds = (templates ?? []).map((template) => template.id);
  const { data: items, error: itemsError } =
    templateIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("scene_template_items")
          .select("id,scene_template_id,request_text,quantity,category,color,notes,optional,is_anchor,requested_item_id")
          .in("scene_template_id", templateIds)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

  if (itemsError) {
    if (isMissingSceneSchemaError(itemsError)) {
      return [] as SceneTemplate[];
    }

    throw new Error(itemsError.message);
  }

  const requestedItemIds = [...new Set((items ?? []).map((item) => item.requested_item_id).filter((value): value is string => Boolean(value)))];
  const { data: requestedItems, error: requestedItemsError } =
    requestedItemIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("inventory_items").select("id,name,item_code").in("id", requestedItemIds);

  if (requestedItemsError) {
    throw new Error(requestedItemsError.message);
  }

  const requestedItemsById = new Map((requestedItems ?? []).map((item) => [item.id, item]));
  const itemsByTemplateId = (items ?? []).reduce<Record<string, SceneTemplateItem[]>>((acc, item) => {
    const requestedItem = item.requested_item_id ? requestedItemsById.get(item.requested_item_id) : null;
    const nextItem = {
      id: item.id,
      request_text: item.request_text,
      quantity: item.quantity,
      category: item.category,
      color: item.color,
      notes: item.notes,
      optional: item.optional,
      is_anchor: item.is_anchor,
      requested_item_id: item.requested_item_id,
      requested_item_name: requestedItem?.name ?? null,
      requested_item_code: requestedItem?.item_code ?? null,
    };
    acc[item.scene_template_id] = [...(acc[item.scene_template_id] ?? []), nextItem];
    return acc;
  }, {});

  return (templates ?? []).map((template) => ({
    ...template,
    item_count: (itemsByTemplateId[template.id] ?? []).length,
    items: itemsByTemplateId[template.id] ?? [],
  })) as SceneTemplate[];
}

export async function applySceneTemplateToJob({
  jobId,
  sceneTemplateId,
  roomLabel,
  notes,
}: {
  jobId: string;
  sceneTemplateId: string;
  roomLabel: string;
  notes?: string;
}) {
  const normalizedRoomLabel = roomLabel.trim();
  if (!normalizedRoomLabel) {
    throw new Error("Room label is required to apply a scene.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: template, error: templateError } = await supabase
    .from("scene_templates")
    .select("id,name")
    .eq("id", sceneTemplateId)
    .eq("active", true)
    .single();

  if (templateError) {
    throw toSceneSchemaAwareError(templateError);
  }

  const { data: templateItems, error: templateItemsError } = await supabase
    .from("scene_template_items")
    .select("id,request_text,quantity,category,color,notes,optional,requested_item_id")
    .eq("scene_template_id", sceneTemplateId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (templateItemsError) {
    throw toSceneSchemaAwareError(templateItemsError);
  }

  if (!templateItems || templateItems.length === 0) {
    throw new Error("This scene does not have any template items yet.");
  }

  const { data: sceneApplication, error: sceneApplicationError } = await supabase
    .from("job_scene_applications")
    .insert({
      job_id: jobId,
      scene_template_id: sceneTemplateId,
      room_label: normalizedRoomLabel,
      notes: notes?.trim() || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (sceneApplicationError) {
    throw toSceneSchemaAwareError(sceneApplicationError);
  }

  const { error: packRequestInsertError } = await supabase.from("job_pack_requests").insert(
    templateItems.map((item) => ({
      job_id: jobId,
      request_text: item.request_text,
      quantity: item.quantity,
      room: normalizedRoomLabel,
      category: item.category,
      color: item.color,
      notes: item.notes,
      optional: item.optional,
      requested_item_id: item.requested_item_id,
      scene_application_id: sceneApplication.id,
      scene_template_item_id: item.id,
      created_by: user?.id ?? null,
    })),
  );

  if (packRequestInsertError) {
    await supabase.from("job_scene_applications").delete().eq("id", sceneApplication.id);
    throw toSceneSchemaAwareError(packRequestInsertError);
  }

  return {
    sceneApplicationId: sceneApplication.id,
    sceneName: template.name,
  };
}

export async function deleteSceneApplication(sceneApplicationId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("job_scene_applications").delete().eq("id", sceneApplicationId);

  if (error) {
    throw toSceneSchemaAwareError(error);
  }
}

export async function createSceneTemplateFromJobRoom({
  jobId,
  sourceRoom,
  name,
  roomType,
  styleLabel,
  summary,
  notes,
}: {
  jobId: string;
  sourceRoom: string;
  name: string;
  roomType?: string;
  styleLabel?: string;
  summary?: string;
  notes?: string;
}) {
  const normalizedSourceRoom = sourceRoom.trim();
  const normalizedName = name.trim();
  if (!normalizedSourceRoom) {
    throw new Error("Choose a room to save as a reusable scene.");
  }
  if (!normalizedName) {
    throw new Error("Scene template name is required.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sourceRequests, error: sourceRequestsError } = await supabase
    .from("job_pack_requests")
    .select("request_text,quantity,category,color,notes,optional,requested_item_id,created_at")
    .eq("job_id", jobId)
    .eq("room", normalizedSourceRoom)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });

  if (sourceRequestsError) {
    throw toSceneSchemaAwareError(sourceRequestsError);
  }

  if (!sourceRequests || sourceRequests.length === 0) {
    throw new Error("That room does not have any active pack requests to save.");
  }

  const slug = await buildUniqueSceneSlug(normalizedName);
  const { data: template, error: templateError } = await supabase
    .from("scene_templates")
    .insert({
      slug,
      name: normalizedName,
      room_type: roomType?.trim() || normalizedSourceRoom,
      style_label: styleLabel?.trim() || null,
      summary: summary?.trim() || `Saved from ${normalizedSourceRoom} pack list`,
      notes: notes?.trim() || null,
      created_by: user?.id ?? null,
    })
    .select("id,name")
    .single();

  if (templateError) {
    throw toSceneSchemaAwareError(templateError);
  }

  const { error: itemsError } = await supabase.from("scene_template_items").insert(
    sourceRequests.map((request, index) => ({
      scene_template_id: template.id,
      sort_order: (index + 1) * 10,
      request_text: request.request_text,
      quantity: request.quantity,
      category: request.category,
      color: request.color,
      notes: request.notes,
      optional: request.optional,
      requested_item_id: request.requested_item_id,
      is_anchor: index === 0,
    })),
  );

  if (itemsError) {
    await supabase.from("scene_templates").delete().eq("id", template.id);
    throw toSceneSchemaAwareError(itemsError);
  }

  return {
    sceneTemplateId: template.id,
    sceneName: template.name,
    itemCount: sourceRequests.length,
  };
}
