const inventoryPathPrefix = "/inventory";

export const INVENTORY_RETURN_TO_STORAGE_KEY = "stagekit:inventory-return-to";

export function normalizeInventoryReturnTo(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (!value.startsWith(inventoryPathPrefix)) {
    return null;
  }

  return value;
}
