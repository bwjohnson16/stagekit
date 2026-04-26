import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { canonicalizeInventoryCategory } from "./lib/inventory-taxonomy.mjs";

const execFileAsync = promisify(execFile);

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

async function loadEnv(cwd) {
  const envFile = path.resolve(cwd, ".env.local");
  const envContents = await readFile(envFile, "utf8");
  return parseDotEnv(envContents);
}

async function fetchAllRows(client, table, selectClause, orderColumn = "id") {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(selectClause).order(orderColumn, { ascending: true }).range(from, to);
    if (error) {
      throw new Error(`Failed to fetch ${table}: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) {
      break;
    }
  }

  return rows;
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-");
}

function parseArgs(rawArgs) {
  const options = {
    limitPhotos: null,
    concurrency: 4,
    outputDir: "audits",
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--limit-photos") {
      const nextValue = rawArgs[index + 1];
      if (!nextValue || !/^\d+$/.test(nextValue)) {
        throw new Error("--limit-photos requires a positive integer.");
      }
      options.limitPhotos = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      const nextValue = rawArgs[index + 1];
      if (!nextValue || !/^\d+$/.test(nextValue)) {
        throw new Error("--concurrency requires a positive integer.");
      }
      options.concurrency = Math.max(1, Number.parseInt(nextValue, 10));
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const nextValue = rawArgs[index + 1];
      if (!nextValue) {
        throw new Error("--output-dir requires a path.");
      }
      options.outputDir = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/audit-inventory-media.mjs [--limit-photos N] [--concurrency N] [--output-dir audits]

Downloads inventory photos from Supabase Storage and writes a removal-focused audit report.

The report includes:
  - exact duplicate photos
  - same-item duplicate-photo candidates
  - likely duplicate items from cover-photo similarity + metadata
  - bad-image candidates (tiny, blank, dark, bright, low-detail, unreadable)

Options:
  --limit-photos N  Only analyze the first N photos after ordering by item and sort order.
  --concurrency N   Number of concurrent photo downloads/analyses. Default: 4.
  --output-dir DIR  Directory for the JSON and Markdown reports. Default: audits
  --help            Show this help message.
`);
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^set of \d+\s+/i, "")
    .replace(/[^\w\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeColor(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeDimensions(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function itemSignature(item) {
  return [
    normalizeName(item.name),
    canonicalizeInventoryCategory(item.category) ?? "",
    normalizeColor(item.color),
    normalizeDimensions(item.dimensions),
  ].join(" | ");
}

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) {
    return Number.MAX_SAFE_INTEGER;
  }

  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftNibble = Number.parseInt(left[index], 16);
    const rightNibble = Number.parseInt(right[index], 16);
    const xor = leftNibble ^ rightNibble;
    distance += xor.toString(2).replaceAll("0", "").length;
  }

  return distance;
}

async function getImageDimensions(filePath) {
  const { stdout } = await execFileAsync("/opt/homebrew/bin/magick", ["identify", "-format", "%w %h", filePath], {
    encoding: "utf8",
  });
  const [widthValue, heightValue] = stdout.trim().split(/\s+/);

  return {
    width: Number.parseInt(widthValue, 10),
    height: Number.parseInt(heightValue, 10),
  };
}

async function createGrayVariant(sourcePath, width, height) {
  const { stdout } = await execFileAsync(
    "/opt/homebrew/bin/magick",
    [sourcePath, "-resize", `${width}x${height}!`, "-colorspace", "Gray", "-depth", "8", "gray:-"],
    {
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const pixelData = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (pixelData.length < width * height) {
    throw new Error("Gray pixel payload is truncated.");
  }

  return {
    width,
    height,
    pixelData: pixelData.subarray(0, width * height),
  };
}

function grayscaleAt(grayImage, x, y) {
  return grayImage.pixelData[y * grayImage.width + x];
}

function computeDHash(grayImage) {
  let bits = "";

  for (let y = 0; y < grayImage.height; y += 1) {
    for (let x = 0; x < grayImage.width - 1; x += 1) {
      bits += grayscaleAt(grayImage, x, y) > grayscaleAt(grayImage, x + 1, y) ? "1" : "0";
    }
  }

  let hex = "";
  for (let index = 0; index < bits.length; index += 4) {
    hex += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  }

  return hex;
}

function computeImageStats(grayImage) {
  const luminances = [];
  let sum = 0;
  let nearBlackCount = 0;
  let nearWhiteCount = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  const histogram = new Array(16).fill(0);

  for (let y = 0; y < grayImage.height; y += 1) {
    for (let x = 0; x < grayImage.width; x += 1) {
      const luminance = grayscaleAt(grayImage, x, y);
      luminances.push(luminance);
      sum += luminance;
      histogram[Math.min(15, Math.floor(luminance / 16))] += 1;

      if (luminance <= 12) nearBlackCount += 1;
      if (luminance >= 243) nearWhiteCount += 1;

      if (x + 1 < grayImage.width) {
        edgeSum += Math.abs(luminance - grayscaleAt(grayImage, x + 1, y));
        edgeCount += 1;
      }

      if (y + 1 < grayImage.height) {
        edgeSum += Math.abs(luminance - grayscaleAt(grayImage, x, y + 1));
        edgeCount += 1;
      }
    }
  }

  const totalPixels = luminances.length;
  const mean = totalPixels === 0 ? 0 : sum / totalPixels;
  let variance = 0;

  for (const luminance of luminances) {
    variance += (luminance - mean) ** 2;
  }

  variance = totalPixels === 0 ? 0 : variance / totalPixels;

  let entropy = 0;
  for (const bucket of histogram) {
    if (bucket === 0) continue;
    const probability = bucket / totalPixels;
    entropy -= probability * Math.log2(probability);
  }

  return {
    mean_luminance: Number(mean.toFixed(2)),
    luminance_stddev: Number(Math.sqrt(variance).toFixed(2)),
    entropy: Number(entropy.toFixed(3)),
    edge_strength: Number((edgeCount === 0 ? 0 : edgeSum / edgeCount).toFixed(2)),
    near_black_ratio: Number((totalPixels === 0 ? 0 : nearBlackCount / totalPixels).toFixed(3)),
    near_white_ratio: Number((totalPixels === 0 ? 0 : nearWhiteCount / totalPixels).toFixed(3)),
  };
}

function classifyImageQuality({ width, height, fileSizeBytes, stats }) {
  const flags = [];

  if (width == null || height == null) {
    flags.push("missing_dimensions");
    return flags;
  }

  if (Math.min(width, height) < 500) {
    flags.push("low_resolution");
  }

  if (width * height < 350_000) {
    flags.push("small_image_area");
  }

  if (fileSizeBytes < 45_000) {
    flags.push("tiny_file_size");
  }

  if (stats.near_black_ratio >= 0.96) {
    flags.push("mostly_black");
  }

  if (stats.near_white_ratio >= 0.96) {
    flags.push("mostly_white");
  }

  if (stats.mean_luminance <= 20) {
    flags.push("very_dark");
  }

  if (stats.mean_luminance >= 245) {
    flags.push("very_bright");
  }

  if (stats.entropy <= 2.2) {
    flags.push("very_low_entropy");
  }

  if (stats.edge_strength <= 8) {
    flags.push("low_edge_detail");
  }

  return flags;
}

async function analyzePhotoFile(sourcePath, fileSizeBytes) {
  const dimensions = await getImageDimensions(sourcePath);
  const dhashImage = await createGrayVariant(sourcePath, 9, 8);
  const statsImage = await createGrayVariant(sourcePath, 32, 32);
  const stats = computeImageStats(statsImage);

  return {
    width: dimensions.width,
    height: dimensions.height,
    dhash: computeDHash(dhashImage),
    stats,
    quality_flags: classifyImageQuality({
      width: dimensions.width,
      height: dimensions.height,
      fileSizeBytes,
      stats,
    }),
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function buildPhotoSummary(photoAnalysis, item, jobsById, locationsById) {
  return {
    photo_id: photoAnalysis.photo_id,
    item_id: item.id,
    item_code: item.item_code ?? null,
    item_name: item.name,
    category: canonicalizeInventoryCategory(item.category) ?? item.category ?? null,
    color: item.color ?? null,
    room: item.room ?? null,
    source_job_name: item.source_job_id ? jobsById.get(item.source_job_id) ?? null : null,
    current_location_name: item.current_location_id ? locationsById.get(item.current_location_id) ?? null : null,
    storage_path: photoAnalysis.storage_path,
    sort_order: photoAnalysis.sort_order,
    width: photoAnalysis.width,
    height: photoAnalysis.height,
    file_size_bytes: photoAnalysis.file_size_bytes,
    exact_sha1: photoAnalysis.exact_sha1,
    dhash: photoAnalysis.dhash,
    quality_flags: photoAnalysis.quality_flags,
    quality_metrics: photoAnalysis.quality_metrics,
  };
}

function uniqueByKey(items, keyFn) {
  const seen = new Set();
  const results = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }

  return results;
}

function takeTop(items, count) {
  return items.slice(0, Math.min(items.length, count));
}

function renderMarkdownReport({
  generatedAt,
  photoCount,
  itemCount,
  exactDuplicateGroups,
  sameItemDuplicateCandidates,
  likelyDuplicateItems,
  badImageCandidates,
  unreadablePhotos,
  jsonRelativePath,
}) {
  const lines = [
    "# Inventory Media Audit",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Items analyzed: ${itemCount}`,
    `Photos analyzed: ${photoCount}`,
    "",
    "## Summary",
    "",
    `- Exact duplicate photo groups: ${exactDuplicateGroups.length}`,
    `- Same-item duplicate-photo candidates: ${sameItemDuplicateCandidates.length}`,
    `- Likely duplicate item pairs: ${likelyDuplicateItems.length}`,
    `- Bad-image candidates: ${badImageCandidates.length}`,
    `- Unreadable photos: ${unreadablePhotos.length}`,
    "",
    `Full JSON: ${jsonRelativePath}`,
    "",
  ];

  if (badImageCandidates.length > 0) {
    lines.push("## Bad Image Candidates", "");
    for (const candidate of takeTop(badImageCandidates, 25)) {
      lines.push(
        `- ${candidate.item_code ?? candidate.item_id} · ${candidate.item_name} · photo ${candidate.photo_id} · ${candidate.quality_flags.join(", ")}`,
      );
    }
    lines.push("");
  }

  if (exactDuplicateGroups.length > 0) {
    lines.push("## Exact Duplicate Photos", "");
    for (const group of takeTop(exactDuplicateGroups, 20)) {
      const labels = group.photos.map((photo) => `${photo.item_code ?? photo.item_id}:${photo.photo_id}`).join(", ");
      lines.push(`- ${group.exact_sha1} · ${group.photos.length} photos · ${labels}`);
    }
    lines.push("");
  }

  if (sameItemDuplicateCandidates.length > 0) {
    lines.push("## Same-Item Duplicate Photo Candidates", "");
    for (const candidate of takeTop(sameItemDuplicateCandidates, 20)) {
      lines.push(
        `- ${candidate.item_code ?? candidate.item_id} · ${candidate.item_name} · photos ${candidate.photo_ids.join(", ")} · ${candidate.reason}`,
      );
    }
    lines.push("");
  }

  if (likelyDuplicateItems.length > 0) {
    lines.push("## Likely Duplicate Items", "");
    for (const candidate of takeTop(likelyDuplicateItems, 25)) {
      lines.push(
        `- ${candidate.left.item_code ?? candidate.left.item_id} / ${candidate.right.item_code ?? candidate.right.item_id} · ${candidate.reason} · dHash distance ${candidate.cover_dhash_distance}`,
      );
    }
    lines.push("");
  }

  if (unreadablePhotos.length > 0) {
    lines.push("## Unreadable Photos", "");
    for (const photo of takeTop(unreadablePhotos, 20)) {
      lines.push(`- ${photo.item_code ?? photo.item_id} · ${photo.item_name} · ${photo.photo_id} · ${photo.error}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

const cwd = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const env = await loadEnv(cwd);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [items, photos, jobs, locations] = await Promise.all([
  fetchAllRows(
    supabase,
    "inventory_items",
    "id,item_code,name,category,color,dimensions,room,source_job_id,current_location_id,status,created_at,updated_at",
  ),
  fetchAllRows(
    supabase,
    "inventory_photos",
    "id,item_id,storage_bucket,storage_path,sort_order,caption,created_at",
    "created_at",
  ),
  fetchAllRows(supabase, "jobs", "id,name"),
  fetchAllRows(supabase, "locations", "id,name"),
]);

const jobsById = new Map(jobs.map((job) => [job.id, job.name]));
const locationsById = new Map(locations.map((location) => [location.id, location.name]));
const itemsById = new Map(items.map((item) => [item.id, item]));

const orderedPhotos = [...photos].sort((left, right) => {
  if (left.item_id !== right.item_id) {
    return left.item_id.localeCompare(right.item_id);
  }

  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order;
  }

  return left.created_at.localeCompare(right.created_at);
});

const targetPhotos = options.limitPhotos == null ? orderedPhotos : orderedPhotos.slice(0, options.limitPhotos);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "stagekit-inventory-audit-"));

try {
  const photoAnalyses = await runWithConcurrency(targetPhotos, options.concurrency, async (photo) => {
    const extension = path.extname(photo.storage_path) || ".img";
    const tempSourcePath = path.join(tempDir, `${photo.id}${extension}`);

    try {
      const { data, error } = await supabase.storage.from(photo.storage_bucket).download(photo.storage_path);
      if (error) {
        throw new Error(`download_failed: ${error.message}`);
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      const exactSha1 = crypto.createHash("sha1").update(buffer).digest("hex");
      await writeFile(tempSourcePath, buffer);

      const analysis = await analyzePhotoFile(tempSourcePath, buffer.length);
      return {
        photo_id: photo.id,
        item_id: photo.item_id,
        storage_bucket: photo.storage_bucket,
        storage_path: photo.storage_path,
        sort_order: photo.sort_order,
        caption: photo.caption ?? null,
        created_at: photo.created_at,
        file_size_bytes: buffer.length,
        exact_sha1: exactSha1,
        width: analysis.width,
        height: analysis.height,
        dhash: analysis.dhash,
        quality_flags: analysis.quality_flags,
        quality_metrics: analysis.stats,
        error: null,
      };
    } catch (error) {
      return {
        photo_id: photo.id,
        item_id: photo.item_id,
        storage_bucket: photo.storage_bucket,
        storage_path: photo.storage_path,
        sort_order: photo.sort_order,
        caption: photo.caption ?? null,
        created_at: photo.created_at,
        file_size_bytes: null,
        exact_sha1: null,
        width: null,
        height: null,
        dhash: null,
        quality_flags: ["unreadable"],
        quality_metrics: null,
        error: error instanceof Error ? error.message : "unknown_error",
      };
    } finally {
      await rm(tempSourcePath, { force: true });
    }
  });

  const exactGroupsByHash = new Map();
  const photoAnalysesByItemId = new Map();

  for (const analysis of photoAnalyses) {
    const itemPhotos = photoAnalysesByItemId.get(analysis.item_id) ?? [];
    itemPhotos.push(analysis);
    photoAnalysesByItemId.set(analysis.item_id, itemPhotos);

    if (!analysis.exact_sha1) continue;
    const bucket = exactGroupsByHash.get(analysis.exact_sha1) ?? [];
    bucket.push(analysis);
    exactGroupsByHash.set(analysis.exact_sha1, bucket);
  }

  const exactDuplicateGroups = [...exactGroupsByHash.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([exactSha1, group]) => ({
      exact_sha1: exactSha1,
      photos: group
        .map((analysis) => buildPhotoSummary(analysis, itemsById.get(analysis.item_id), jobsById, locationsById))
        .sort((left, right) => left.item_name.localeCompare(right.item_name)),
      distinct_items: new Set(group.map((analysis) => analysis.item_id)).size,
    }))
    .sort((left, right) => right.photos.length - left.photos.length);

  const unreadablePhotos = photoAnalyses
    .filter((analysis) => analysis.error)
    .map((analysis) => ({
      photo_id: analysis.photo_id,
      item_id: analysis.item_id,
      item_code: itemsById.get(analysis.item_id)?.item_code ?? null,
      item_name: itemsById.get(analysis.item_id)?.name ?? "Unknown item",
      storage_path: analysis.storage_path,
      error: analysis.error,
    }));

  const badImageCandidates = photoAnalyses
    .filter((analysis) => analysis.quality_flags.length > 0 && !analysis.error)
    .map((analysis) => buildPhotoSummary(analysis, itemsById.get(analysis.item_id), jobsById, locationsById))
    .sort((left, right) => right.quality_flags.length - left.quality_flags.length);

  const sameItemDuplicateCandidates = [];

  for (const [itemId, itemPhotos] of photoAnalysesByItemId.entries()) {
    const item = itemsById.get(itemId);
    if (!item) continue;

    const exactDuplicatePhotos = [...new Map(
      itemPhotos
        .filter((photo) => photo.exact_sha1)
        .map((photo) => [photo.exact_sha1, itemPhotos.filter((candidate) => candidate.exact_sha1 === photo.exact_sha1)]),
    ).values()]
      .filter((group) => group.length > 1);

    for (const group of exactDuplicatePhotos) {
      sameItemDuplicateCandidates.push({
        item_id: itemId,
        item_code: item.item_code ?? null,
        item_name: item.name,
        reason: "same item has exact duplicate photo files",
        photo_ids: group.map((photo) => photo.photo_id),
      });
    }

    for (let leftIndex = 0; leftIndex < itemPhotos.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < itemPhotos.length; rightIndex += 1) {
        const left = itemPhotos[leftIndex];
        const right = itemPhotos[rightIndex];

        if (!left.dhash || !right.dhash || left.exact_sha1 === right.exact_sha1) {
          continue;
        }

        const distance = hammingDistance(left.dhash, right.dhash);
        if (distance <= 3) {
          sameItemDuplicateCandidates.push({
            item_id: itemId,
            item_code: item.item_code ?? null,
            item_name: item.name,
            reason: `same item has visually similar photos (dHash distance ${distance})`,
            photo_ids: [left.photo_id, right.photo_id],
          });
        }
      }
    }
  }

  const dedupedSameItemDuplicateCandidates = uniqueByKey(
    sameItemDuplicateCandidates,
    (candidate) => `${candidate.item_id}:${candidate.photo_ids.slice().sort().join(",")}:${candidate.reason}`,
  );

  const coverPhotos = items
    .map((item) => {
      const itemPhotos = (photoAnalysesByItemId.get(item.id) ?? []).sort((left, right) => left.sort_order - right.sort_order);
      const coverPhoto = itemPhotos[0] ?? null;
      if (!coverPhoto || !coverPhoto.dhash) {
        return null;
      }

      return {
        item,
        cover: coverPhoto,
        signature: itemSignature(item),
      };
    })
    .filter(Boolean);

  const coverGroupsBySignature = new Map();
  for (const entry of coverPhotos) {
    const bucket = coverGroupsBySignature.get(entry.signature) ?? [];
    bucket.push(entry);
    coverGroupsBySignature.set(entry.signature, bucket);
  }

  const likelyDuplicateItems = [];

  for (const group of coverGroupsBySignature.values()) {
    if (group.length < 2) continue;

    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex];
        const right = group[rightIndex];
        const distance = hammingDistance(left.cover.dhash, right.cover.dhash);
        const sharedExactPhoto = Boolean(left.cover.exact_sha1 && left.cover.exact_sha1 === right.cover.exact_sha1);

        if (!sharedExactPhoto && distance > 6) {
          continue;
        }

        likelyDuplicateItems.push({
          reason: sharedExactPhoto ? "same metadata signature and exact same cover photo" : "same metadata signature and similar cover photo",
          cover_dhash_distance: distance,
          shared_exact_cover_hash: sharedExactPhoto,
          left: {
            item_id: left.item.id,
            item_code: left.item.item_code ?? null,
            item_name: left.item.name,
            category: canonicalizeInventoryCategory(left.item.category) ?? left.item.category ?? null,
            color: left.item.color ?? null,
            dimensions: left.item.dimensions ?? null,
            source_job_name: left.item.source_job_id ? jobsById.get(left.item.source_job_id) ?? null : null,
          },
          right: {
            item_id: right.item.id,
            item_code: right.item.item_code ?? null,
            item_name: right.item.name,
            category: canonicalizeInventoryCategory(right.item.category) ?? right.item.category ?? null,
            color: right.item.color ?? null,
            dimensions: right.item.dimensions ?? null,
            source_job_name: right.item.source_job_id ? jobsById.get(right.item.source_job_id) ?? null : null,
          },
        });
      }
    }
  }

  const dedupedLikelyDuplicateItems = uniqueByKey(
    likelyDuplicateItems,
    (candidate) => [candidate.left.item_id, candidate.right.item_id].sort().join(":"),
  ).sort((left, right) => left.cover_dhash_distance - right.cover_dhash_distance);

  const generatedAt = new Date().toISOString();
  const timestamp = formatTimestamp(new Date(generatedAt));
  const outputDir = path.resolve(cwd, options.outputDir);
  const jsonPath = path.join(outputDir, `inventory-media-audit-${timestamp}.json`);
  const markdownPath = path.join(outputDir, `inventory-media-audit-${timestamp}.md`);

  const report = {
    generated_at: generatedAt,
    photo_count: photoAnalyses.length,
    item_count: items.length,
    options: {
      limit_photos: options.limitPhotos,
      concurrency: options.concurrency,
    },
    exact_duplicate_photo_groups: exactDuplicateGroups,
    same_item_duplicate_photo_candidates: dedupedSameItemDuplicateCandidates,
    likely_duplicate_items: dedupedLikelyDuplicateItems,
    bad_image_candidates: badImageCandidates,
    unreadable_photos: unreadablePhotos,
    analyzed_photos: photoAnalyses,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    markdownPath,
    renderMarkdownReport({
      generatedAt,
      photoCount: photoAnalyses.length,
      itemCount: items.length,
      exactDuplicateGroups,
      sameItemDuplicateCandidates: dedupedSameItemDuplicateCandidates,
      likelyDuplicateItems: dedupedLikelyDuplicateItems,
      badImageCandidates,
      unreadablePhotos,
      jsonRelativePath: path.relative(cwd, jsonPath),
    }),
  );

  console.log(
    JSON.stringify(
      {
        json_report: path.relative(cwd, jsonPath),
        markdown_report: path.relative(cwd, markdownPath),
        photo_count: photoAnalyses.length,
        item_count: items.length,
        exact_duplicate_photo_groups: exactDuplicateGroups.length,
        same_item_duplicate_photo_candidates: dedupedSameItemDuplicateCandidates.length,
        likely_duplicate_items: dedupedLikelyDuplicateItems.length,
        bad_image_candidates: badImageCandidates.length,
        unreadable_photos: unreadablePhotos.length,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
