import type { Database } from "./database";
import { isMissingSceneSchemaError } from "./schema-compat";
import { getSupabaseClient } from "./supabase";

const PHOTO_URL_TTL_SECONDS = 60 * 60;
const THUMBNAIL_TRANSFORM = {
  width: 240,
  height: 240,
  resize: "cover",
  quality: 60,
} as const;

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

type JobAddressFields = Pick<JobRow, "address1" | "address2" | "city" | "state" | "postal">;

export type JobMapFields = JobAddressFields & {
  country: string;
  address_label: string | null;
  latitude: number | null;
  longitude: number | null;
};
export type Job = Pick<JobRow, "id" | "name" | "status"> & JobMapFields;
export type JobDetail = Pick<JobRow, "id" | "name" | "status" | "notes"> & JobMapFields;
export type JobWithStats = Job & {
  activeItemCount: number;
  importedItemCount: number;
  packRequestCount: number;
  sceneApplicationCount: number;
};
export type ActiveJobLocation = Pick<Job, "id" | "name" | "address_label" | "latitude" | "longitude"> & {
  activeItemCount: number;
};
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
  requested_item_thumbnail_url: string | null;
  active_job_names: string[];
  picked_items: JobPickItem[];
  picked_count: number;
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
  thumbnail_url: string | null;
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

type InventoryPhotoRow = {
  id: string;
  item_id: string;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
};

type PhotoTransform = {
  width: number;
  height: number;
  resize: "cover" | "contain" | "fill";
  quality: number;
};

type JobPackRequestRow = {
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
};

type JobSceneApplicationRow = {
  id: string;
  job_id: string;
  scene_template_id: string;
  room_label: string;
  notes: string | null;
  created_at: string;
};

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function createSignedPhotoUrlMap(photos: InventoryPhotoRow[], transform?: PhotoTransform) {
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

      for (const photoChunk of chunkArray(uniquePhotos, 20)) {
        const signedUrlResults = await Promise.all(
          photoChunk.map(async (photo) => {
            const { data, error } = await supabase.storage.from(photo.bucket).createSignedUrl(photo.storagePath, PHOTO_URL_TTL_SECONDS, {
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
            signedUrlByKey.set(`${entry.bucket}:${entry.storagePath}`, entry.signedUrl);
          }
        }
      }

      return signedUrlByKey;
    } catch (error) {
      console.warn("Falling back to untransformed job photo URLs.", error);
      return createSignedPhotoUrlMap(photos);
    }
  }

  for (const [bucket, bucketPhotos] of photosByBucket.entries()) {
    const uniquePaths = [...new Set(bucketPhotos.map((photo) => photo.storage_path))];
    for (const pathChunk of chunkArray(uniquePaths, 100)) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pathChunk, PHOTO_URL_TTL_SECONDS);

      if (error) {
        throw new Error(error.message);
      }

      for (const entry of data ?? []) {
        if (!entry.path || !entry.signedUrl) {
          continue;
        }

        signedUrlByKey.set(`${bucket}:${entry.path}`, entry.signedUrl);
      }
    }
  }

  return signedUrlByKey;
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

function buildAddressLabel(parts: Array<string | null | undefined>) {
  const value = parts.filter(Boolean).join(", ");
  return value.length > 0 ? value : null;
}

async function listJobPackRequestsCompat(supabase: ReturnType<typeof getSupabaseClient>, jobId: string) {
  const { data, error } = await supabase
    .from("job_pack_requests")
    .select("id,request_text,quantity,room,category,color,notes,optional,status,requested_item_id,scene_application_id,scene_template_item_id")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (!error) {
    return (data ?? []) as JobPackRequestRow[];
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
  })) as JobPackRequestRow[];
}

async function listJobSceneApplicationsCompat(supabase: ReturnType<typeof getSupabaseClient>, jobId: string) {
  const { data, error } = await supabase
    .from("job_scene_applications")
    .select("id,job_id,scene_template_id,room_label,notes,created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSceneSchemaError(error)) {
      return [] as JobSceneApplicationRow[];
    }

    throw new Error(error.message);
  }

  return (data ?? []) as JobSceneApplicationRow[];
}

function mapJobRow(row: Pick<JobRow, "id" | "name" | "status" | "address1" | "address2" | "city" | "state" | "postal">): Job {
  return {
    ...row,
    country: "US",
    address_label: buildAddressLabel([row.address1, row.address2, row.city, row.state, row.postal]),
    latitude: null,
    longitude: null,
  };
}

function mapJobDetailRow(row: Pick<JobRow, "id" | "name" | "status" | "notes" | "address1" | "address2" | "city" | "state" | "postal">): JobDetail {
  return {
    ...row,
    country: "US",
    address_label: buildAddressLabel([row.address1, row.address2, row.city, row.state, row.postal]),
    latitude: null,
    longitude: null,
  };
}

export async function listJobs() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id,name,status,address1,address2,city,state,postal")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapJobRow(row as Pick<JobRow, "id" | "name" | "status" | "address1" | "address2" | "city" | "state" | "postal">));
}

export async function createJob({
  name,
  address1,
  address2,
  city,
  state,
  postal,
  notes,
}: {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  notes: string;
}) {
  const normalizedAddress1 = address1.trim();
  const normalizedAddress2 = address2.trim();
  const normalizedCity = city.trim();
  const normalizedState = state.trim();
  const normalizedPostal = postal.trim();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("jobs").insert({
    name: name.trim(),
    address1: normalizedAddress1 || null,
    address2: normalizedAddress2 || null,
    city: normalizedCity || null,
    state: normalizedState || null,
    postal: normalizedPostal || null,
    notes: notes.trim() || null,
    status: "active",
  });

  if (error) {
    throw new Error(error.message);
  }
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
  const normalizedAddress1 = address1.trim();
  const normalizedAddress2 = address2.trim();
  const normalizedCity = city.trim();
  const normalizedState = state.trim();
  const normalizedPostal = postal.trim();
  const supabase = getSupabaseClient();
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

export async function listJobsWithStats() {
  const supabase = getSupabaseClient();
  const jobs = await listJobs();

  if (jobs.length === 0) {
    return [] as JobWithStats[];
  }

  const jobIds = jobs.map((job) => job.id);
  const [{ data: activeAssignments, error: activeError }, { data: importedItems, error: importedError }, { data: packRequests, error: packRequestsError }] =
    await Promise.all([
    supabase.from("job_items").select("job_id,checked_in_at").in("job_id", jobIds).is("checked_in_at", null),
    supabase.from("inventory_items").select("source_job_id").in("source_job_id", jobIds),
    supabase.from("job_pack_requests").select("job_id").in("job_id", jobIds).neq("status", "cancelled"),
  ]);

  if (activeError) {
    throw new Error(activeError.message);
  }
  if (importedError) {
    throw new Error(importedError.message);
  }
  if (packRequestsError) {
    throw new Error(packRequestsError.message);
  }
  const { data: sceneApplications, error: sceneApplicationsError } = await supabase.from("job_scene_applications").select("job_id").in("job_id", jobIds);

  if (sceneApplicationsError && !isMissingSceneSchemaError(sceneApplicationsError)) {
    throw new Error(sceneApplicationsError.message);
  }

  const activeByJobId = (activeAssignments ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.job_id] = (acc[row.job_id] ?? 0) + 1;
    return acc;
  }, {});

  const importedByJobId = (importedItems ?? []).reduce<Record<string, number>>((acc, row) => {
    if (row.source_job_id) {
      acc[row.source_job_id] = (acc[row.source_job_id] ?? 0) + 1;
    }
    return acc;
  }, {});

  const packRequestsByJobId = (packRequests ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.job_id] = (acc[row.job_id] ?? 0) + 1;
    return acc;
  }, {});

  const sceneApplicationsByJobId = ((sceneApplications as Array<{ job_id: string }> | null) ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.job_id] = (acc[row.job_id] ?? 0) + 1;
    return acc;
  }, {});

  return jobs.map((job) => ({
    ...job,
    activeItemCount: activeByJobId[job.id] ?? 0,
    importedItemCount: importedByJobId[job.id] ?? 0,
    packRequestCount: packRequestsByJobId[job.id] ?? 0,
    sceneApplicationCount: sceneApplicationsByJobId[job.id] ?? 0,
  }));
}

export async function getJobDetail(jobId: string) {
  const supabase = getSupabaseClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,name,status,notes,address1,address2,city,state,postal")
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
  const requestedItemIds = [...new Set((packRequests ?? []).map((row) => row.requested_item_id).filter((value): value is string => Boolean(value)))];
  const pickedItemIds = [...new Set((pickedItems ?? []).map((row) => row.item_id))];
  const sceneTemplateIds = [...new Set((sceneApplications ?? []).map((row) => row.scene_template_id))];
  const referencedItemIds = [...new Set([...assignedItemIds, ...requestedItemIds, ...pickedItemIds])];
  const { data: assignedItems, error: assignedItemsError } =
    referencedItemIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("inventory_items")
          .select("id,name,category,color,status,item_code,room")
          .in("id", referencedItemIds);

  if (assignedItemsError) {
    throw new Error(assignedItemsError.message);
  }

  const photos = await listInventoryCoverPhotosForItems([...new Set([...requestedItemIds, ...pickedItemIds])]);
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

  const { data: activeRequestAssignments, error: activeRequestAssignmentsError } =
    requestedItemIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("job_items")
          .select("job_id,item_id,checked_in_at")
          .in("item_id", requestedItemIds)
          .is("checked_in_at", null);

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
    sceneTemplateIds.length === 0
      ? { data: [], error: null }
      : await supabase.from("scene_templates").select("id,name").in("id", sceneTemplateIds);

  if (sceneTemplatesError) {
    throw new Error(sceneTemplatesError.message);
  }

  const itemsById = new Map((assignedItems ?? []).map((item) => [item.id, item]));
  const jobNameById = new Map((activeJobs ?? []).map((activeJob) => [activeJob.id, activeJob.name]));
  const sceneTemplateNameById = new Map((sceneTemplates ?? []).map((template) => [template.id, template.name]));
  const sceneApplicationsById = new Map(
    (sceneApplications ?? []).map((application) => [
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
      thumbnail_url: thumbnailUrlByItemId.get(pickedItem.item_id) ?? null,
    };
  }) as JobPickItem[];

  const pickedItemsByRequestId = exactPickList.reduce<Record<string, JobPickItem[]>>((acc, pickedItem) => {
    if (!pickedItem.pack_request_id) {
      return acc;
    }

    acc[pickedItem.pack_request_id] = [...(acc[pickedItem.pack_request_id] ?? []), pickedItem];
    return acc;
  }, {});

  const packRequestList = (packRequests ?? []).map((request) => {
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
      requested_item_thumbnail_url: request.requested_item_id ? thumbnailUrlByItemId.get(request.requested_item_id) ?? null : null,
      active_job_names: request.requested_item_id ? [...new Set((activeJobNamesByItemId[request.requested_item_id] ?? []).filter((name) => name !== job.name))] : [],
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

  const appliedScenes = (sceneApplications ?? []).map((application) => {
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
    job: mapJobDetailRow(job as Pick<JobRow, "id" | "name" | "status" | "notes" | "address1" | "address2" | "city" | "state" | "postal">),
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
  const supabase = getSupabaseClient();
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

  return data.id as string;
}

export async function createExactItemPackRequest({
  jobId,
  itemId,
  itemName,
  category,
  color,
  room,
}: {
  jobId: string;
  itemId: string;
  itemName: string;
  category: string | null;
  color: string | null;
  room: string | null;
}) {
  const supabase = getSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("job_pack_requests")
    .select("id")
    .eq("job_id", jobId)
    .eq("requested_item_id", itemId)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing?.id) {
    throw new Error("This item is already on that project's pack list.");
  }

  await createPackRequest({
    jobId,
    requestText: itemName,
    quantity: 1,
    room: room ?? "",
    category: category ?? "",
    color: color ?? "",
    notes: "",
    optional: false,
    requestedItemId: itemId,
  });
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
  const supabase = getSupabaseClient();
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
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("job_pack_requests").update({ status }).eq("id", packRequestId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deletePackRequest(packRequestId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("job_pack_requests").delete().eq("id", packRequestId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function assignItemToJob(jobId: string, itemId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: activeAssignment, error: activeAssignmentError } = await supabase
    .from("job_items")
    .select("id,job_id")
    .eq("item_id", itemId)
    .is("checked_in_at", null)
    .maybeSingle();

  if (activeAssignmentError) {
    throw new Error(activeAssignmentError.message);
  }
  if (activeAssignment) {
    throw new Error(activeAssignment.job_id === jobId ? "Item is already assigned to this project." : "Item is already assigned to another active project.");
  }

  const { data: item, error: itemError } = await supabase.from("inventory_items").select("id,status").eq("id", itemId).single();
  if (itemError) {
    throw new Error(itemError.message);
  }
  if (item.status !== "available") {
    throw new Error(`Item is not available. Current status: ${item.status}.`);
  }

  const { error: insertError } = await supabase.from("job_items").insert({
    job_id: jobId,
    item_id: itemId,
    checked_out_by: user?.id ?? null,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  const { error: updateError } = await supabase.from("inventory_items").update({ status: "on_job" }).eq("id", itemId);
  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function checkInJobItem(jobItemId: string) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: jobItem, error: loadError } = await supabase.from("job_items").select("id,item_id,job_id").eq("id", jobItemId).single();
  if (loadError) {
    throw new Error(loadError.message);
  }

  const { error: updateJobItemError } = await supabase
    .from("job_items")
    .update({
      checked_in_at: new Date().toISOString(),
      checked_in_by: user?.id ?? null,
    })
    .eq("id", jobItemId);

  if (updateJobItemError) {
    throw new Error(updateJobItemError.message);
  }

  const { error: updateInventoryError } = await supabase.from("inventory_items").update({ status: "available" }).eq("id", jobItem.item_id);
  if (updateInventoryError) {
    throw new Error(updateInventoryError.message);
  }

  const { error: deletePickError } = await supabase.from("job_pick_items").delete().eq("job_id", jobItem.job_id).eq("item_id", jobItem.item_id);
  if (deletePickError) {
    throw new Error(deletePickError.message);
  }
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
  const supabase = getSupabaseClient();
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
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("job_pick_items").delete().eq("id", jobPickItemId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listActiveJobLocations() {
  const supabase = getSupabaseClient();
  const { data: activeAssignments, error: activeAssignmentsError } = await supabase
    .from("job_items")
    .select("job_id")
    .is("checked_in_at", null);

  if (activeAssignmentsError) {
    throw new Error(activeAssignmentsError.message);
  }

  const activeCountsByJobId = (activeAssignments ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.job_id] = (acc[row.job_id] ?? 0) + 1;
    return acc;
  }, {});
  const jobIds = Object.keys(activeCountsByJobId);

  if (jobIds.length === 0) {
    return [] as ActiveJobLocation[];
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id,name,address1,address2,city,state,postal")
    .in("id", jobIds)
    .order("name", { ascending: true });


  if (jobsError) {
    throw new Error(jobsError.message);
  }

  return (jobs ?? []).map((job) => ({
    id: job.id,
    name: job.name,
    address_label: buildAddressLabel([job.address1, job.address2, job.city, job.state, job.postal]),
    latitude: null,
    longitude: null,
    activeItemCount: activeCountsByJobId[job.id] ?? 0,
  })) as ActiveJobLocation[];
}
