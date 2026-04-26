import Link from "next/link";
import { redirect } from "next/navigation";

import { inventoryCategorySuggestionValues, sortInventoryCategories } from "@/lib/inventory-taxonomy";
import {
  createItem,
  listItems,
  type InventoryItemCondition,
  type InventoryItemStatus,
} from "@/lib/db/inventory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const statusOptions: InventoryItemStatus[] = ["available", "on_job", "packed", "maintenance", "sold", "lost"];
const conditionOptions: InventoryItemCondition[] = ["new", "like_new", "good", "fair", "rough"];
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const STORAGE_SIGN_BATCH_SIZE = 100;
const PHOTO_QUERY_BATCH_SIZE = 100;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function toNullableText(value: string) {
  return value.length > 0 ? value : null;
}

function parseStatus(value: string): InventoryItemStatus | undefined {
  return statusOptions.includes(value as InventoryItemStatus) ? (value as InventoryItemStatus) : undefined;
}

function parseCondition(value: string): InventoryItemCondition | undefined {
  return conditionOptions.includes(value as InventoryItemCondition) ? (value as InventoryItemCondition) : undefined;
}

function parseDisposition(value: string) {
  return value === "keep" || value === "dispose" ? value : undefined;
}

function formatCurrency(cents: number | null) {
  return cents == null ? "—" : currencyFormatter.format(cents / 100);
}

async function createItemAction(formData: FormData) {
  "use server";

  const name = readString(formData.get("name"));
  if (!name) {
    redirect(`/inventory?message=${encodeURIComponent("Item name is required.")}`);
  }

  const status = parseStatus(readString(formData.get("status")));
  const condition = parseCondition(readString(formData.get("condition")));

  const item = await createItem({
    name,
    sku: toNullableText(readString(formData.get("sku"))),
    category: toNullableText(readString(formData.get("category"))),
    status,
    condition,
  });

  redirect(`/inventory/${item.id}`);
}

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = firstValue(params.q) ?? "";
  const statusFilter = parseStatus(firstValue(params.status) ?? "");
  const categoryFilter = firstValue(params.category) ?? "";
  const dispositionFilter = parseDisposition(firstValue(params.disposition) ?? "");
  const message = firstValue(params.message);

  const [items, allItems] = await Promise.all([
    listItems({
      q: q || undefined,
      status: statusFilter,
      category: categoryFilter || undefined,
      disposition: dispositionFilter,
    }),
    listItems(),
  ]);

  const categories = sortInventoryCategories([
    ...new Set([
      ...inventoryCategorySuggestionValues,
      ...allItems.map((item) => item.category).filter((value): value is string => Boolean(value)),
    ]),
  ]);
  const showingCountLabel =
    items.length === allItems.length
      ? `Showing ${items.length} item${items.length === 1 ? "" : "s"}`
      : `Showing ${items.length} of ${allItems.length} item${allItems.length === 1 ? "" : "s"}`;
  const supabase = await createServerSupabaseClient();
  const itemIds = items.map((item) => item.id);
  const thumbnailByItemId = new Map<string, string>();

  if (itemIds.length > 0) {
    const photos: Array<{
      item_id: string;
      storage_bucket: string;
      storage_path: string;
      sort_order: number;
      created_at: string;
    }> = [];

    for (let from = 0; from < itemIds.length; from += PHOTO_QUERY_BATCH_SIZE) {
      const itemIdBatch = itemIds.slice(from, from + PHOTO_QUERY_BATCH_SIZE);
      const { data: photoBatch, error: photosError } = await supabase
        .from("inventory_photos")
        .select("item_id,storage_bucket,storage_path,sort_order,created_at")
        .in("item_id", itemIdBatch)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (photosError) {
        throw new Error(`Failed to load inventory thumbnails: ${photosError.message}`);
      }

      photos.push(...(photoBatch ?? []));
    }

    const firstPhotoByItemId = new Map<string, { bucket: string; path: string }>();
    for (const photo of photos) {
      if (!photo.storage_bucket || !photo.storage_path) {
        continue;
      }

      if (!firstPhotoByItemId.has(photo.item_id)) {
        firstPhotoByItemId.set(photo.item_id, {
          bucket: photo.storage_bucket,
          path: photo.storage_path,
        });
      }
    }

    const pathsByBucket = new Map<string, string[]>();
    firstPhotoByItemId.forEach((photo) => {
      const currentPaths = pathsByBucket.get(photo.bucket) ?? [];
      currentPaths.push(photo.path);
      pathsByBucket.set(photo.bucket, currentPaths);
    });

    const signedUrlByBucketAndPath = new Map<string, string>();
    await Promise.all(
      Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
        if (paths.length === 0) return;
        try {
          for (let from = 0; from < paths.length; from += STORAGE_SIGN_BATCH_SIZE) {
            const pathBatch = paths.slice(from, from + STORAGE_SIGN_BATCH_SIZE);
            const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pathBatch, 60 * 60);
            if (error) {
              throw error;
            }

            (data ?? []).forEach((entry, index) => {
              if (entry.signedUrl) {
                signedUrlByBucketAndPath.set(`${bucket}:${pathBatch[index]}`, entry.signedUrl);
              }
            });
          }
        } catch (error) {
          console.error("Failed to sign inventory thumbnails", {
            bucket,
            count: paths.length,
            error,
          });
        }
      }),
    );

    firstPhotoByItemId.forEach((photo, itemId) => {
      const signedUrl = signedUrlByBucketAndPath.get(`${photo.bucket}:${photo.path}`);
      if (signedUrl) {
        thumbnailByItemId.set(itemId, signedUrl);
      }
    });
  }

  return (
    <section className="space-y-6">
      {message ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>
      ) : null}

      <form className="grid gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm md:grid-cols-5" method="get">
        <datalist id="inventory-category-options">
          {inventoryCategorySuggestionValues.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <input name="q" placeholder="Search name, sku, brand..." defaultValue={q} />
        <select name="status" defaultValue={statusFilter ?? ""}>
          <option value="">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={categoryFilter}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select name="disposition" defaultValue={dispositionFilter ?? ""}>
          <option value="">All disposition</option>
          <option value="keep">Keep in inventory</option>
          <option value="dispose">Marked for disposal</option>
        </select>
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground" type="submit">
          Apply Filters
        </button>
      </form>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Add Item</h2>
        <form action={createItemAction} className="mt-3 grid gap-3 md:grid-cols-5">
          <input name="name" placeholder="Name" required />
          <input name="sku" placeholder="SKU" />
          <input list="inventory-category-options" name="category" placeholder="Tables / Coffee" />
          <select name="status" defaultValue="available">
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select name="condition" defaultValue="good">
            {conditionOptions.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground md:col-span-5" type="submit">
            Add Item
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-4 py-3 text-sm font-medium text-muted">{showingCountLabel}</div>
        <table>
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name</th>
              <th>Category</th>
              <th>Status</th>
              <th>Disposition</th>
              <th>List Price</th>
              <th>Condition</th>
              <th>Current Location</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="text-sm text-muted" colSpan={8}>
                  No inventory items found.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {thumbnailByItemId.get(item.id) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`${item.name} thumbnail`}
                        className="h-12 w-12 rounded-md border border-border object-cover"
                        suppressHydrationWarning
                        src={thumbnailByItemId.get(item.id)}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-md border border-border bg-slate-100" />
                    )}
                  </td>
                  <td>
                    <Link className="font-medium text-accent hover:underline" href={`/inventory/${item.id}`}>
                      {item.name}
                    </Link>
                  </td>
                  <td>{item.category ?? "—"}</td>
                  <td>{item.status}</td>
                  <td>{item.marked_for_disposal ? "Dispose" : "Keep"}</td>
                  <td>{formatCurrency(item.estimated_listing_price_cents)}</td>
                  <td>{item.condition}</td>
                  <td>{item.current_location_name ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
