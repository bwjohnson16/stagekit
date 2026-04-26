import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { canonicalizeInventoryCategory } from "./lib/inventory-taxonomy.mjs";

const execFileAsync = promisify(execFile);

const [, , manifestArg = "imports/manifest.json", ...rawFlags] = process.argv;
const cwd = process.cwd();
const manifestPath = path.resolve(cwd, manifestArg);
const dryRun = rawFlags.includes("--dry-run");

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

async function loadEnv() {
  const envFile = path.resolve(cwd, ".env.local");
  const envContents = await readFile(envFile, "utf8");
  return parseDotEnv(envContents);
}

function toNullableText(value) {
  return value && value.trim() ? value.trim() : null;
}

async function resolveOrCreateLocation(supabase, cache, locationName) {
  const normalized = toNullableText(locationName);
  if (!normalized) return null;
  if (cache.has(normalized)) return cache.get(normalized);

  const { data: existing, error: existingError } = await supabase.from("locations").select("id").eq("name", normalized).maybeSingle();
  if (existingError) throw new Error(`Failed to resolve location "${normalized}": ${existingError.message}`);

  if (existing?.id) {
    cache.set(normalized, existing.id);
    return existing.id;
  }

  const { data: created, error: createError } = await supabase
    .from("locations")
    .insert({ name: normalized, kind: "warehouse" })
    .select("id")
    .single();

  if (createError) throw new Error(`Failed to create location "${normalized}": ${createError.message}`);

  cache.set(normalized, created.id);
  return created.id;
}

async function resolveJobId(supabase, cache, jobName) {
  const normalized = toNullableText(jobName);
  if (!normalized) return null;
  if (cache.has(normalized)) return cache.get(normalized);

  const { data, error } = await supabase.from("jobs").select("id").eq("name", normalized).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to resolve job "${normalized}": ${error.message}`);

  const jobId = data?.id ?? null;
  cache.set(normalized, jobId);
  return jobId;
}

async function resolveOrCreateBatch(supabase, cache, batchName, jobId) {
  const normalized = toNullableText(batchName);
  if (!normalized) return null;
  const cacheKey = `${normalized}::${jobId ?? "none"}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let query = supabase.from("intake_batches").select("id").eq("name", normalized).order("created_at", { ascending: false }).limit(1);
  query = jobId ? query.eq("job_id", jobId) : query.is("job_id", null);

  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw new Error(`Failed to resolve batch "${normalized}": ${existingError.message}`);

  if (existing?.id) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }

  const { data: created, error: createError } = await supabase
    .from("intake_batches")
    .insert({
      name: normalized,
      job_id: jobId,
      created_by: null,
    })
    .select("id")
    .single();

  if (createError) throw new Error(`Failed to create batch "${normalized}": ${createError.message}`);

  cache.set(cacheKey, created.id);
  return created.id;
}

const env = await loadEnv();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const locationCache = new Map();
const jobCache = new Map();
const batchCache = new Map();
const results = [];
const importedAt = new Date().toISOString();

async function saveManifest() {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function normalizeUploadAsset(sourcePath, originalExtension) {
  const extension = (originalExtension || ".jpg").toLowerCase();

  if (extension !== ".heic") {
    return {
      buffer: await readFile(sourcePath),
      storageExtension: extension,
      contentType:
        extension === ".png"
          ? "image/png"
          : extension === ".jpeg" || extension === ".jpg"
            ? "image/jpeg"
            : "application/octet-stream",
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "stagekit-import-"));
  const outputPath = path.join(tempDir, `${path.parse(sourcePath).name}.jpg`);

  try {
    await execFileAsync("/usr/bin/sips", ["-s", "format", "jpeg", sourcePath, "--out", outputPath]);
    return {
      buffer: await readFile(outputPath),
      storageExtension: ".jpg",
      contentType: "image/jpeg",
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

for (let index = 0; index < manifest.items.length; index += 1) {
  const entry = manifest.items[index];

  if (entry.import_status === "imported") {
    results.push({ source_path: entry.source_path, status: "already_imported" });
    continue;
  }

  if (entry.import_status !== "approved") {
    results.push({ source_path: entry.source_path, status: "skipped" });
    continue;
  }

  const jobId = await resolveJobId(supabase, jobCache, entry.source_job_name);
  const intakeBatchId = await resolveOrCreateBatch(supabase, batchCache, entry.batch_name || manifest.defaults?.batch_name, jobId);
  const currentLocationId = await resolveOrCreateLocation(
    supabase,
    locationCache,
    entry.current_location_name || manifest.defaults?.current_location_name,
  );
  const homeLocationId = await resolveOrCreateLocation(
    supabase,
    locationCache,
    entry.home_location_name || manifest.defaults?.home_location_name,
  );

  const nextStatus = jobId ? "on_job" : "available";
  const plannedName = toNullableText(entry.item_name) ?? path.parse(entry.filename).name;
  const extension = path.extname(entry.filename).toLowerCase() || ".jpg";

  if (dryRun) {
    results.push({
      source_path: entry.source_path,
      status: "dry_run",
      item_name: plannedName,
      batch_name: entry.batch_name || manifest.defaults?.batch_name,
      source_job_name: entry.source_job_name || null,
      extension,
    });
    continue;
  }

  const absoluteImagePath = path.resolve(cwd, entry.source_path);
  const uploadAsset = await normalizeUploadAsset(absoluteImagePath, extension);

  const { data: createdItem, error: itemError } = await supabase
    .from("inventory_items")
    .insert({
      name: plannedName,
      category: canonicalizeInventoryCategory(entry.category),
      color: toNullableText(entry.color),
      material: toNullableText(entry.material),
      dimensions: toNullableText(entry.dimensions),
      notes: toNullableText(entry.notes),
      room: toNullableText(entry.room),
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      condition: toNullableText(entry.condition) ?? "good",
      status: nextStatus,
      intake_batch_id: intakeBatchId,
      source_job_id: jobId,
      current_location_id: currentLocationId,
      home_location_id: homeLocationId,
      import_source_path: toNullableText(entry.source_path),
      import_source_asset_key: toNullableText(entry.source_asset_key),
      import_group_key: toNullableText(entry.group_key),
      import_review_notes: toNullableText(entry.review_notes),
    })
    .select("id")
    .single();

  if (itemError) {
    throw new Error(`Failed to create item for ${entry.source_path}: ${itemError.message}`);
  }

  const photoId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = `items/${createdItem.id}/${photoId}${uploadAsset.storageExtension}`;

  const { error: uploadError } = await supabase.storage.from("inventory").upload(storagePath, uploadAsset.buffer, {
    contentType: uploadAsset.contentType,
    upsert: false,
  });
  if (uploadError) {
    throw new Error(`Failed to upload ${entry.source_path}: ${uploadError.message}`);
  }

  const { error: photoError } = await supabase.from("inventory_photos").insert({
    item_id: createdItem.id,
    storage_bucket: "inventory",
    storage_path: storagePath,
    sort_order: 0,
    caption: toNullableText(entry.caption),
  });
  if (photoError) {
    throw new Error(`Failed to create photo row for ${entry.source_path}: ${photoError.message}`);
  }

  if (jobId) {
    const { error: assignmentError } = await supabase.from("job_items").insert({
      job_id: jobId,
      item_id: createdItem.id,
      checked_out_by: null,
    });
    if (assignmentError) {
      throw new Error(`Failed to create job assignment for ${entry.source_path}: ${assignmentError.message}`);
    }
  }

  manifest.items[index] = {
    ...entry,
    import_status: "imported",
    imported_at: importedAt,
    imported_item_id: createdItem.id,
    imported_storage_path: storagePath,
  };
  await saveManifest();

  results.push({
    source_path: entry.source_path,
    status: "imported",
    item_id: createdItem.id,
  });
}

console.log(
  JSON.stringify(
    {
      manifest: path.relative(cwd, manifestPath),
      dry_run: dryRun,
      imported: results.filter((result) => result.status === "imported").length,
      already_imported: results.filter((result) => result.status === "already_imported").length,
      dry_run_ready: results.filter((result) => result.status === "dry_run").length,
      skipped: results.filter((result) => result.status === "skipped").length,
    },
    null,
    2,
  ),
);
