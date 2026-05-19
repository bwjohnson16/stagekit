"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { INVENTORY_RETURN_TO_STORAGE_KEY } from "@/lib/inventory-navigation";

export function InventoryHistoryMarker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams.toString();
    const currentUrl = search.length > 0 ? `${pathname}?${search}` : pathname;
    sessionStorage.setItem(INVENTORY_RETURN_TO_STORAGE_KEY, currentUrl);
  }, [pathname, searchParams]);

  return null;
}
