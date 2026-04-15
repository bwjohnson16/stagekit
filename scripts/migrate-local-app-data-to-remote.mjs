import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function parseDotEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function loadRemoteEnv() {
  return parseDotEnv(readFileSync(".env.local", "utf8"));
}

function loadLocalEnv() {
  const output = execFileSync("supabase", ["status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return parseDotEnv(output);
}

async function fetchAllRows(client, table) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select("*").order("id", { ascending: true }).range(from, to);
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  return rows;
}

async function fetchAllUsers(client) {
  const users = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }

  return users;
}

function buildMap(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null) continue;
    map.set(key, row);
  }
  return map;
}

function maybe(value) {
  return value == null ? null : value;
}

const dryRun = process.argv.includes("--dry-run");

const localEnv = loadLocalEnv();
const remoteEnv = loadRemoteEnv();

if (!localEnv.API_URL || !localEnv.SECRET_KEY) {
  throw new Error("Missing local Supabase API_URL or SECRET_KEY.");
}

if (!remoteEnv.NEXT_PUBLIC_SUPABASE_URL || !remoteEnv.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing remote NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
}

const local = createClient(localEnv.API_URL, localEnv.SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const remote = createClient(remoteEnv.NEXT_PUBLIC_SUPABASE_URL, remoteEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUsers = [];
const stats = {
  usersCreated: 0,
  locationsCreated: 0,
  jobsInserted: 0,
  batchesInserted: 0,
  itemsInserted: 0,
  itemsUpdated: 0,
  itemAliasesMapped: 0,
  photosCopied: 0,
  packRequestsInserted: 0,
  jobItemsInserted: 0,
  pickItemsInserted: 0,
};
const itemMappingCollisions = [];

const [localUsers, remoteUsers] = await Promise.all([fetchAllUsers(local), fetchAllUsers(remote)]);
const remoteUserByEmail = buildMap(remoteUsers, (user) => user.email?.toLowerCase() ?? null);
const userIdMap = new Map();

for (const localUser of localUsers) {
  const email = localUser.email?.toLowerCase();
  if (!email) continue;

  let remoteUser = remoteUserByEmail.get(email);
  if (!remoteUser) {
    const tempPassword = crypto.randomBytes(18).toString("base64url");
    if (!dryRun) {
      const { data, error } = await remote.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });
      if (error) throw new Error(`Failed to create remote user ${email}: ${error.message}`);
      remoteUser = data.user;
    } else {
      remoteUser = { id: `dry-run-${email}`, email };
    }
    remoteUserByEmail.set(email, remoteUser);
    createdUsers.push({ email, tempPassword });
    stats.usersCreated += 1;
  }

  userIdMap.set(localUser.id, remoteUser.id);
}

const [localLocations, remoteLocations] = await Promise.all([
  fetchAllRows(local, "locations"),
  fetchAllRows(remote, "locations"),
]);
const remoteLocationByName = buildMap(remoteLocations, (row) => row.name?.toLowerCase() ?? null);
const locationIdMap = new Map();

for (const location of localLocations) {
  const key = location.name.toLowerCase();
  let remoteLocation = remoteLocationByName.get(key);
  if (!remoteLocation) {
    if (!dryRun) {
      const { data, error } = await remote.from("locations").insert({
        id: location.id,
        name: location.name,
        kind: location.kind,
        notes: location.notes,
      }).select("*").single();
      if (error) throw new Error(`Failed to create location ${location.name}: ${error.message}`);
      remoteLocation = data;
    } else {
      remoteLocation = location;
    }
    remoteLocationByName.set(key, remoteLocation);
    stats.locationsCreated += 1;
  }
  locationIdMap.set(location.id, remoteLocation.id);
}

const [localJobs, remoteJobs] = await Promise.all([fetchAllRows(local, "jobs"), fetchAllRows(remote, "jobs")]);
const remoteJobsById = buildMap(remoteJobs, (row) => row.id);
const jobIdMap = new Map();

for (const job of localJobs) {
  let remoteJob = remoteJobsById.get(job.id);
  if (!remoteJob) {
    if (!dryRun) {
      const { data, error } = await remote.from("jobs").insert(job).select("*").single();
      if (error) throw new Error(`Failed to insert job ${job.name}: ${error.message}`);
      remoteJob = data;
    } else {
      remoteJob = job;
    }
    remoteJobsById.set(job.id, remoteJob);
    stats.jobsInserted += 1;
  }
  jobIdMap.set(job.id, remoteJob.id);
}

const [localBatches, remoteBatches] = await Promise.all([
  fetchAllRows(local, "intake_batches"),
  fetchAllRows(remote, "intake_batches"),
]);
const remoteBatchById = buildMap(remoteBatches, (row) => row.id);
const remoteBatchByKey = buildMap(
  remoteBatches,
  (row) => `${row.name.toLowerCase()}::${row.job_id ?? "none"}`,
);
const batchIdMap = new Map();

for (const batch of localBatches) {
  const mappedJobId = maybe(jobIdMap.get(batch.job_id) ?? batch.job_id);
  const batchKey = `${batch.name.toLowerCase()}::${mappedJobId ?? "none"}`;
  let remoteBatch = remoteBatchById.get(batch.id) ?? remoteBatchByKey.get(batchKey);
  if (!remoteBatch) {
    const payload = {
      id: batch.id,
      name: batch.name,
      notes: batch.notes,
      job_id: mappedJobId,
      created_by: maybe(userIdMap.get(batch.created_by)),
      created_at: batch.created_at,
    };
    if (!dryRun) {
      const { data, error } = await remote.from("intake_batches").insert(payload).select("*").single();
      if (error) throw new Error(`Failed to insert intake batch ${batch.name}: ${error.message}`);
      remoteBatch = data;
    } else {
      remoteBatch = payload;
    }
    stats.batchesInserted += 1;
  }
  batchIdMap.set(batch.id, remoteBatch.id);
}

const [localItems, remoteItems] = await Promise.all([
  fetchAllRows(local, "inventory_items"),
  fetchAllRows(remote, "inventory_items"),
]);
const demoSkus = new Set(["CHAIR-001", "OTTO-001", "PLANT-001"]);
const filteredLocalItems = localItems.filter((item) => !demoSkus.has(item.sku ?? ""));
const remoteItemById = buildMap(remoteItems, (row) => row.id);
const remoteItemBySourcePath = buildMap(remoteItems, (row) => row.import_source_path);
const remoteItemByAssetKey = buildMap(remoteItems, (row) => row.import_source_asset_key);
const remoteUsedItemCodes = new Set(remoteItems.map((row) => row.item_code).filter(Boolean));
const itemIdMap = new Map();
const insertedRemoteItemIds = new Set();
const localItemByRemoteTarget = new Map();

for (const item of filteredLocalItems) {
  let remoteItem = null;
  let matchSource = null;
  if (remoteItemById.has(item.id)) {
    remoteItem = remoteItemById.get(item.id);
    matchSource = "id";
  } else if (item.import_source_path && remoteItemBySourcePath.has(item.import_source_path)) {
    remoteItem = remoteItemBySourcePath.get(item.import_source_path);
    matchSource = "import_source_path";
  } else if (item.import_source_asset_key && remoteItemByAssetKey.has(item.import_source_asset_key)) {
    remoteItem = remoteItemByAssetKey.get(item.import_source_asset_key);
    matchSource = "import_source_asset_key";
  }

  const payload = {
    id: remoteItem?.id ?? item.id,
    brand: item.brand,
    category: item.category,
    color: item.color,
    condition: item.condition,
    created_at: item.created_at,
    current_location_id: maybe(locationIdMap.get(item.current_location_id)),
    dimensions: item.dimensions,
    estimated_listing_price_cents: item.estimated_listing_price_cents,
    home_location_id: maybe(locationIdMap.get(item.home_location_id)),
    intake_batch_id: maybe(batchIdMap.get(item.intake_batch_id)),
    marked_for_disposal: item.marked_for_disposal,
    material: item.material,
    name: item.name,
    notes: item.notes,
    purchase_date: item.purchase_date,
    purchase_price_cents: item.purchase_price_cents,
    replacement_cost_cents: item.replacement_cost_cents,
    room: item.room,
    sku: item.sku,
    source_job_id: maybe(jobIdMap.get(item.source_job_id)),
    status: item.status,
    tags: item.tags,
    updated_at: item.updated_at,
    import_source_path: item.import_source_path,
    import_source_asset_key: item.import_source_asset_key,
    import_group_key: item.import_group_key,
    import_review_notes: item.import_review_notes,
  };

  if (!remoteItem) {
    const itemCodeConflicts = remoteUsedItemCodes.has(item.item_code);
    if (!itemCodeConflicts) {
      payload.item_code = item.item_code;
    } else {
      payload.notes = payload.notes
        ? `${payload.notes}\n[Migrated from local item_code ${item.item_code}]`
        : `[Migrated from local item_code ${item.item_code}]`;
    }
    if (!dryRun) {
      const { data, error } = await remote.from("inventory_items").insert(payload).select("*").single();
      if (error) throw new Error(`Failed to insert inventory item ${item.name}: ${error.message}`);
      remoteItem = data;
    } else {
      remoteItem = payload;
    }
    if (remoteItem.item_code) {
      remoteUsedItemCodes.add(remoteItem.item_code);
    }
    insertedRemoteItemIds.add(remoteItem.id);
    stats.itemsInserted += 1;
  } else {
    const previousLocalId = localItemByRemoteTarget.get(remoteItem.id);
    if (previousLocalId && previousLocalId !== item.id) {
      if (matchSource === "import_source_path" || matchSource === "import_source_asset_key" || matchSource === "id") {
        itemIdMap.set(item.id, remoteItem.id);
        stats.itemAliasesMapped += 1;
        continue;
      }

      itemMappingCollisions.push({
        remoteItemId: remoteItem.id,
        previousLocalItemId: previousLocalId,
        nextLocalItemId: item.id,
        nextLocalItemCode: item.item_code,
        nextImportSourcePath: item.import_source_path,
      });
      continue;
    }
    localItemByRemoteTarget.set(remoteItem.id, item.id);
    if (!dryRun) {
      const { error } = await remote.from("inventory_items").update(payload).eq("id", remoteItem.id);
      if (error) throw new Error(`Failed to update inventory item ${item.name}: ${error.message}`);
    }
    stats.itemsUpdated += 1;
  }

  itemIdMap.set(item.id, remoteItem.id);
}

if (itemMappingCollisions.length > 0) {
  console.log(
    JSON.stringify(
      {
        dryRun,
        collisionCount: itemMappingCollisions.length,
        collisions: itemMappingCollisions.slice(0, 20),
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const [localPhotos, remotePhotos] = await Promise.all([
  fetchAllRows(local, "inventory_photos"),
  fetchAllRows(remote, "inventory_photos"),
]);
const remotePhotoKeys = new Set(remotePhotos.map((photo) => `${photo.item_id}::${photo.sort_order}::${photo.caption ?? ""}`));

for (const photo of localPhotos) {
  const remoteItemId = itemIdMap.get(photo.item_id);
  if (!remoteItemId) continue;
  if (!insertedRemoteItemIds.has(remoteItemId)) continue;

  const photoKey = `${remoteItemId}::${photo.sort_order}::${photo.caption ?? ""}`;
  if (remotePhotoKeys.has(photoKey)) continue;

  if (!dryRun) {
    const { data: blob, error: downloadError } = await local.storage.from(photo.storage_bucket).download(photo.storage_path);
    if (downloadError) throw new Error(`Failed to download local storage object ${photo.storage_path}: ${downloadError.message}`);
    const buffer = Buffer.from(await blob.arrayBuffer());

    const { error: uploadError } = await remote.storage.from(photo.storage_bucket).upload(photo.storage_path, buffer, {
      upsert: true,
    });
    if (uploadError) throw new Error(`Failed to upload remote storage object ${photo.storage_path}: ${uploadError.message}`);

    const { error: insertError } = await remote.from("inventory_photos").insert({
      id: photo.id,
      item_id: remoteItemId,
      storage_bucket: photo.storage_bucket,
      storage_path: photo.storage_path,
      sort_order: photo.sort_order,
      caption: photo.caption,
      created_at: photo.created_at,
    });
    if (insertError) throw new Error(`Failed to insert inventory photo ${photo.id}: ${insertError.message}`);
  }

  remotePhotoKeys.add(photoKey);
  stats.photosCopied += 1;
}

const [localPackRequests, remotePackRequests] = await Promise.all([
  fetchAllRows(local, "job_pack_requests"),
  fetchAllRows(remote, "job_pack_requests"),
]);
const remotePackRequestById = buildMap(remotePackRequests, (row) => row.id);

for (const request of localPackRequests) {
  if (remotePackRequestById.has(request.id)) continue;
  const payload = {
    ...request,
    job_id: jobIdMap.get(request.job_id),
    created_by: maybe(userIdMap.get(request.created_by)),
    requested_item_id: maybe(itemIdMap.get(request.requested_item_id)),
  };
  if (!dryRun) {
    const { error } = await remote.from("job_pack_requests").insert(payload);
    if (error) throw new Error(`Failed to insert pack request ${request.id}: ${error.message}`);
  }
  stats.packRequestsInserted += 1;
}

const [localJobItems, remoteJobItems] = await Promise.all([
  fetchAllRows(local, "job_items"),
  fetchAllRows(remote, "job_items"),
]);
const remoteJobItemById = buildMap(remoteJobItems, (row) => row.id);

for (const row of localJobItems) {
  if (remoteJobItemById.has(row.id)) continue;
  const payload = {
    ...row,
    job_id: jobIdMap.get(row.job_id),
    item_id: itemIdMap.get(row.item_id),
    checked_out_by: maybe(userIdMap.get(row.checked_out_by)),
    checked_in_by: maybe(userIdMap.get(row.checked_in_by)),
  };
  if (!dryRun) {
    const { error } = await remote.from("job_items").insert(payload);
    if (error) throw new Error(`Failed to insert job item ${row.id}: ${error.message}`);
  }
  stats.jobItemsInserted += 1;
}

const [localPickItems, remotePickItems] = await Promise.all([
  fetchAllRows(local, "job_pick_items"),
  fetchAllRows(remote, "job_pick_items"),
]);
const remotePickItemById = buildMap(remotePickItems, (row) => row.id);

for (const row of localPickItems) {
  if (remotePickItemById.has(row.id)) continue;
  const payload = {
    ...row,
    job_id: jobIdMap.get(row.job_id),
    item_id: itemIdMap.get(row.item_id),
    pack_request_id: maybe(row.pack_request_id),
    picked_by: maybe(userIdMap.get(row.picked_by)),
  };
  if (!dryRun) {
    const { error } = await remote.from("job_pick_items").insert(payload);
    if (error) throw new Error(`Failed to insert job pick item ${row.id}: ${error.message}`);
  }
  stats.pickItemsInserted += 1;
}

console.log(
  JSON.stringify(
    {
      dryRun: dryRun,
      createdUsers,
      stats,
    },
    null,
    2,
  ),
);
