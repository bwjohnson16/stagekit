import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { canonicalizeInventoryCategory } from "./lib/inventory-taxonomy.mjs";

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

async function fetchAllRows(client, table, selectClause) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(selectClause).order("id", { ascending: true }).range(from, to);
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
    apply: false,
    limit: null,
    output: null,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--limit") {
      const nextValue = rawArgs[index + 1];
      if (!nextValue || !/^\d+$/.test(nextValue)) {
        throw new Error("--limit requires a positive integer.");
      }
      options.limit = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }

    if (arg === "--output") {
      const nextValue = rawArgs[index + 1];
      if (!nextValue) {
        throw new Error("--output requires a path.");
      }
      options.output = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/backfill-inventory-categories.mjs [--apply] [--limit N] [--output audits/file.json]

Backfills existing inventory item categories into the canonical taxonomy.

Options:
  --apply       Persist category updates to Supabase. Without this flag the script runs as a dry run.
  --limit N     Only inspect the first N changed rows.
  --output PATH Write a JSON report to PATH. Defaults to audits/inventory-category-backfill-<timestamp>.json.
  --help        Show this help message.
`);
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

const rows = await fetchAllRows(
  supabase,
  "inventory_items",
  "id,item_code,name,category,color,created_at,updated_at",
);

const changes = rows
  .map((row) => {
    const currentCategory = row.category == null ? null : String(row.category).trim() || null;
    const canonicalCategory = canonicalizeInventoryCategory(currentCategory);

    if (currentCategory === canonicalCategory) {
      return null;
    }

    return {
      id: row.id,
      item_code: row.item_code ?? null,
      name: row.name,
      color: row.color ?? null,
      current_category: currentCategory,
      canonical_category: canonicalCategory,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  })
  .filter(Boolean);

const limitedChanges = options.limit == null ? changes : changes.slice(0, options.limit);
let updated = 0;

if (options.apply) {
  for (const change of limitedChanges) {
    const { error } = await supabase.from("inventory_items").update({ category: change.canonical_category }).eq("id", change.id);
    if (error) {
      throw new Error(`Failed to update ${change.id}: ${error.message}`);
    }
    updated += 1;
  }
}

const outputPath = path.resolve(
  cwd,
  options.output ?? `audits/inventory-category-backfill-${formatTimestamp()}.json`,
);

const report = {
  generated_at: new Date().toISOString(),
  dry_run: !options.apply,
  inspected_items: rows.length,
  changed_items: changes.length,
  applied_updates: updated,
  limited_to: options.limit,
  changes: limitedChanges,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      report: path.relative(cwd, outputPath),
      dry_run: !options.apply,
      inspected_items: rows.length,
      changed_items: changes.length,
      applied_updates: updated,
      limited_to: options.limit,
    },
    null,
    2,
  ),
);
