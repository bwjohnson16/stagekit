import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { inventoryCategorySuggestionValues } from "@/lib/inventory-taxonomy";
import {
  addPhotoRow,
  deleteItem,
  getItem,
  listPhotos,
  updateItem,
  type InventoryItemCondition,
  type InventoryItemStatus,
} from "@/lib/db/inventory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const statusOptions: InventoryItemStatus[] = ["available", "on_job", "packed", "maintenance", "sold", "lost"];
const conditionOptions: InventoryItemCondition[] = ["new", "like_new", "good", "fair", "rough"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

type Params = Promise<{ id: string }>;
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

function readCheckbox(value: FormDataEntryValue | null) {
  return value === "on";
}

function parseStatus(value: string): InventoryItemStatus | undefined {
  return statusOptions.includes(value as InventoryItemStatus) ? (value as InventoryItemStatus) : undefined;
}

function parseCondition(value: string): InventoryItemCondition | undefined {
  return conditionOptions.includes(value as InventoryItemCondition) ? (value as InventoryItemCondition) : undefined;
}

function statusBadgeClass(status: InventoryItemStatus) {
  if (status === "available") return "bg-emerald-100 text-emerald-800";
  if (status === "on_job") return "bg-blue-100 text-blue-800";
  if (status === "maintenance") return "bg-amber-100 text-amber-800";
  if (status === "sold" || status === "lost") return "bg-rose-100 text-rose-800";
  return "bg-slate-100 text-slate-700";
}

function formatCurrencyInput(cents: number | null) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function formatCurrency(cents: number | null) {
  return cents == null ? "—" : currencyFormatter.format(cents / 100);
}

function parseCurrencyToCents(rawValue: string, itemId: string, label: string) {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.replaceAll(",", "").replaceAll("$", "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    redirect(`/inventory/${itemId}?message=${encodeURIComponent(`${label} must be a valid dollar amount.`)}`);
  }

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    redirect(`/inventory/${itemId}?message=${encodeURIComponent(`${label} must be a valid dollar amount.`)}`);
  }

  return Math.round(amount * 100);
}

async function updateItemAction(formData: FormData) {
  "use server";

  const itemId = readString(formData.get("item_id"));
  if (!itemId) {
    redirect(`/inventory?message=${encodeURIComponent("Invalid item id.")}`);
  }

  const purchasePrice = parseCurrencyToCents(readString(formData.get("purchase_price_cents")), itemId, "Cost");
  const estimatedListingPrice = parseCurrencyToCents(
    readString(formData.get("estimated_listing_price_cents")),
    itemId,
    "Estimated list price",
  );
  const replacementCost = parseCurrencyToCents(
    readString(formData.get("replacement_cost_cents")),
    itemId,
    "Replacement cost",
  );

  await updateItem(itemId, {
    sku: toNullableText(readString(formData.get("sku"))),
    name: readString(formData.get("name")),
    brand: toNullableText(readString(formData.get("brand"))),
    category: toNullableText(readString(formData.get("category"))),
    color: toNullableText(readString(formData.get("color"))),
    material: toNullableText(readString(formData.get("material"))),
    dimensions: toNullableText(readString(formData.get("dimensions"))),
    status: parseStatus(readString(formData.get("status"))),
    condition: parseCondition(readString(formData.get("condition"))),
    marked_for_disposal: readCheckbox(formData.get("marked_for_disposal")),
    estimated_listing_price_cents: estimatedListingPrice,
    purchase_price_cents: purchasePrice,
    replacement_cost_cents: replacementCost,
    purchase_date: toNullableText(readString(formData.get("purchase_date"))),
    notes: toNullableText(readString(formData.get("notes"))),
    home_location_id: toNullableText(readString(formData.get("home_location_id"))),
    current_location_id: toNullableText(readString(formData.get("current_location_id"))),
  });

  redirect(`/inventory/${itemId}?message=${encodeURIComponent("Item updated.")}`);
}

async function uploadPhotoAction(formData: FormData) {
  "use server";

  const itemId = readString(formData.get("item_id"));
  if (!itemId) {
    redirect(`/inventory?message=${encodeURIComponent("Invalid item id.")}`);
  }

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/inventory/${itemId}?message=${encodeURIComponent("Select a photo to upload.")}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    redirect(`/inventory/${itemId}?message=${encodeURIComponent("Photo must be 20MB or smaller.")}`);
  }

  const extensionMatch = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = extensionMatch?.[1] ?? "jpg";
  const photoId = crypto.randomUUID();
  const storagePath = `items/${itemId}/${photoId}.${extension}`;

  const supabase = await createServerSupabaseClient();
  const fileBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage.from("inventory").upload(storagePath, fileBuffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    redirect(`/inventory/${itemId}?message=${encodeURIComponent(uploadError.message)}`);
  }

  const { count } = await supabase
    .from("inventory_photos")
    .select("*", { count: "exact", head: true })
    .eq("item_id", itemId);

  await addPhotoRow(itemId, storagePath, count ?? 0);
  redirect(`/inventory/${itemId}?message=${encodeURIComponent("Photo uploaded.")}`);
}

async function deleteItemAction(formData: FormData) {
  "use server";

  const itemId = readString(formData.get("item_id"));
  if (!itemId) {
    redirect(`/inventory?message=${encodeURIComponent("Invalid item id.")}`);
  }

  await deleteItem(itemId);
  redirect(`/inventory?message=${encodeURIComponent("Item deleted.")}`);
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const search = await searchParams;
  const message = firstValue(search.message);

  const item = await getItem(id);
  if (!item) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const [{ data: locations }, photos] = await Promise.all([
    supabase.from("locations").select("id,name").order("name", { ascending: true }),
    listPhotos(id),
  ]);

  const photosWithUrls = await Promise.all(
    photos.map(async (photo) => {
      if (!photo.storage_bucket || !photo.storage_path) {
        return {
          ...photo,
          signedUrl: null,
        };
      }

      const { data, error } = await supabase.storage.from(photo.storage_bucket).createSignedUrl(photo.storage_path, 60 * 60);
      if (error) {
        console.error("Failed to sign inventory photo", {
          itemId: id,
          bucket: photo.storage_bucket,
          path: photo.storage_path,
          error,
        });
      }

      return {
        ...photo,
        signedUrl: error ? null : data?.signedUrl ?? null,
      };
    }),
  );

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div>
          <p className="text-sm text-muted">Inventory Item</p>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(item.status)}`}>{item.status}</span>
          {item.marked_for_disposal ? (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800">marked for disposal</span>
          ) : null}
          <Link className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium" href="/inventory">
            Back to Inventory
          </Link>
        </div>
      </header>

      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Details</h2>
        <datalist id="inventory-category-options">
          {inventoryCategorySuggestionValues.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <div className="mt-3 grid gap-3 rounded-xl border border-border/70 bg-slate-50 p-3 text-sm text-slate-700 md:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Estimated List Price</p>
            <p className="mt-1 font-medium">{formatCurrency(item.estimated_listing_price_cents)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Cost</p>
            <p className="mt-1 font-medium">{formatCurrency(item.purchase_price_cents)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Replacement Cost</p>
            <p className="mt-1 font-medium">{formatCurrency(item.replacement_cost_cents)}</p>
          </div>
        </div>
        <form action={updateItemAction} className="mt-4 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="item_id" value={item.id} />

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="name">
              Name
            </label>
            <input id="name" name="name" defaultValue={item.name} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="sku">
              SKU
            </label>
            <input id="sku" name="sku" defaultValue={item.sku ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="brand">
              Brand
            </label>
            <input id="brand" name="brand" defaultValue={item.brand ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="category">
              Category
            </label>
            <input id="category" list="inventory-category-options" name="category" defaultValue={item.category ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={item.status}>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="condition">
              Condition
            </label>
            <select id="condition" name="condition" defaultValue={item.condition}>
              {conditionOptions.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="color">
              Color
            </label>
            <input id="color" name="color" defaultValue={item.color ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="material">
              Material
            </label>
            <input id="material" name="material" defaultValue={item.material ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="dimensions">
              Dimensions
            </label>
            <input id="dimensions" name="dimensions" defaultValue={item.dimensions ?? ""} />
          </div>
          <label className="flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800">
            <input defaultChecked={item.marked_for_disposal} name="marked_for_disposal" type="checkbox" />
            Mark this item for disposal
          </label>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="estimated_listing_price_cents">
              Estimated List Price (USD)
            </label>
            <input
              id="estimated_listing_price_cents"
              inputMode="decimal"
              name="estimated_listing_price_cents"
              placeholder="0.00"
              type="text"
              defaultValue={formatCurrencyInput(item.estimated_listing_price_cents)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="purchase_price_cents">
              Cost (USD)
            </label>
            <input
              id="purchase_price_cents"
              inputMode="decimal"
              name="purchase_price_cents"
              placeholder="0.00"
              type="text"
              defaultValue={formatCurrencyInput(item.purchase_price_cents)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="replacement_cost_cents">
              Replacement Cost (USD)
            </label>
            <input
              id="replacement_cost_cents"
              inputMode="decimal"
              name="replacement_cost_cents"
              placeholder="0.00"
              type="text"
              defaultValue={formatCurrencyInput(item.replacement_cost_cents)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="purchase_date">
              Purchase Date
            </label>
            <input id="purchase_date" name="purchase_date" type="date" defaultValue={item.purchase_date ?? ""} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="home_location_id">
              Home Location
            </label>
            <select id="home_location_id" name="home_location_id" defaultValue={item.home_location_id ?? ""}>
              <option value="">None</option>
              {(locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="current_location_id">
              Current Location
            </label>
            <select id="current_location_id" name="current_location_id" defaultValue={item.current_location_id ?? ""}>
              <option value="">None</option>
              {(locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium" htmlFor="notes">
              Notes
            </label>
            <textarea id="notes" name="notes" defaultValue={item.notes ?? ""} />
          </div>
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground md:col-span-2" type="submit">
            Save Changes
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Photos</h2>
        <form action={uploadPhotoAction} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="item_id" value={item.id} />
          <input accept="image/*" name="photo" type="file" />
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground" type="submit">
            Upload
          </button>
        </form>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {photosWithUrls.length === 0 ? (
            <p className="text-sm text-muted">No photos uploaded yet.</p>
          ) : (
            photosWithUrls.map((photo) => (
              <figure key={photo.id} className="overflow-hidden rounded-lg border border-border bg-slate-50">
                {photo.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={photo.caption ?? item.name}
                    className="h-48 w-full object-cover"
                    suppressHydrationWarning
                    src={photo.signedUrl}
                  />
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-muted">Unavailable</div>
                )}
                <figcaption className="px-3 py-2 text-xs text-muted">{photo.storage_path}</figcaption>
              </figure>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-rose-900">Delete Item</h2>
        <p className="mt-2 text-sm text-rose-900">This permanently removes the item, its photos, any job assignment rows, and exact-item pack list links.</p>
        <form action={deleteItemAction} className="mt-4">
          <input type="hidden" name="item_id" value={item.id} />
          <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white" type="submit">
            Delete Item
          </button>
        </form>
      </section>
    </section>
  );
}
