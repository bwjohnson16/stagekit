"use client";

import { useRouter } from "next/navigation";

import { INVENTORY_RETURN_TO_STORAGE_KEY, normalizeInventoryReturnTo } from "@/lib/inventory-navigation";

type BackToInventoryButtonProps = {
  fallbackHref: string;
};

export function BackToInventoryButton({ fallbackHref }: BackToInventoryButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    const normalizedFallbackHref = normalizeInventoryReturnTo(fallbackHref) ?? "/inventory";
    const savedHref = normalizeInventoryReturnTo(sessionStorage.getItem(INVENTORY_RETURN_TO_STORAGE_KEY));

    if (savedHref && savedHref === normalizedFallbackHref && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(normalizedFallbackHref);
  };

  return (
    <button className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium" onClick={handleClick} type="button">
      Back to Inventory
    </button>
  );
}
