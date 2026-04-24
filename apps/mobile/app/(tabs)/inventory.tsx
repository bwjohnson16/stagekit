import { useLocalSearchParams, useRouter } from "expo-router";
import { Image as CachedImage } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { AppScreen, Card, EmptyState, Field, Hero, LoadingState, Message, SectionTitle, SecondaryButton } from "../../src/components/ui";
import { listInventoryItemsPage, listInventoryItemThumbnails, type InventoryListFilters, type InventoryListItem } from "../../src/lib/inventory";
import { createExactItemPackRequest, listJobs, type Job } from "../../src/lib/jobs";
import { colors } from "../../src/lib/theme";

const INITIAL_INVENTORY_ITEM_LIMIT = 120;
const INVENTORY_LOAD_TIMEOUT_MS = 12_000;
const INVENTORY_SEARCH_DEBOUNCE_MS = 350;

function formatCurrencyFromCents(cents: number | null | undefined) {
  if (cents == null) {
    return "—";
  }

  return `$${(cents / 100).toFixed(2)}`;
}

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? colors.accent : colors.panel,
        borderColor: active ? colors.accentDark : colors.border,
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: active ? colors.accentText : colors.text, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function InventoryThumbnail({ item }: { item: InventoryListItem }) {
  if (item.thumbnail_url) {
    return (
      <CachedImage
        alt=""
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: item.thumbnail_url }}
        style={{ width: 84, height: 84, borderRadius: 14, backgroundColor: colors.panelAlt }}
      />
    );
  }

  return (
    <View
      style={{
        width: 84,
        height: 84,
        borderRadius: 14,
        backgroundColor: colors.panelAlt,
        alignItems: "center",
        justifyContent: "center",
        padding: 10,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", textAlign: "center" }}>
        {item.category ?? "Item"}
      </Text>
    </View>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

function hasActiveInventoryFilters(filters: InventoryListFilters) {
  return Boolean(filters.search?.trim() || filters.color || filters.category || filters.room || filters.locationName);
}

export default function InventoryTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ location?: string }>();
  const [items, setItems] = useState<InventoryListItem[]>([]);
  const [totalItemCount, setTotalItemCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingResults, setUpdatingResults] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [recentlyAddedItemId, setRecentlyAddedItemId] = useState<string | null>(null);
  const [recentlyAddedJobNameByItemId, setRecentlyAddedJobNameByItemId] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [packTargetItemId, setPackTargetItemId] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const hasLoadedInventoryRef = useRef(false);

  const loadThumbnails = useCallback(async (itemIds: string[], loadSequence: number) => {
    try {
      const thumbnailUrlByItemId = await listInventoryItemThumbnails(itemIds);

      if (loadSequenceRef.current !== loadSequence) {
        return;
      }

      setItems((currentItems) =>
        currentItems.map((item) => ({
          ...item,
          thumbnail_url: thumbnailUrlByItemId.get(item.id) ?? item.thumbnail_url,
        })),
      );
    } catch (error) {
      console.warn("Failed to load inventory thumbnails.", error);
    }
  }, []);

  const loadJobsForPackList = useCallback(async (loadSequence: number) => {
    try {
      const nextJobs = await listJobs();

      if (loadSequenceRef.current === loadSequence) {
        setJobs(nextJobs);
      }
    } catch (error) {
      console.warn("Failed to load jobs for inventory pack list.", error);
    }
  }, []);

  const loadItems = useCallback(async (showRefresh = false) => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    const filters: InventoryListFilters = {
      search,
      color: selectedColor,
      category: selectedCategory,
      room: selectedRoom,
      locationName: selectedLocation,
    };
    const hasExistingItems = hasLoadedInventoryRef.current;

    if (showRefresh) {
      setRefreshing(true);
    } else if (hasExistingItems) {
      setUpdatingResults(true);
    } else {
      setLoading(true);
    }

    try {
      const nextPage = await withTimeout(
        listInventoryItemsPage({
          filters,
          includeThumbnails: false,
          maxItems: INITIAL_INVENTORY_ITEM_LIMIT,
        }),
        INVENTORY_LOAD_TIMEOUT_MS,
        "Inventory is taking too long to load. Check the Supabase connection and try again.",
      );

      if (loadSequenceRef.current !== loadSequence) {
        return;
      }

      setItems(nextPage.items);
      setTotalItemCount(nextPage.totalCount);
      hasLoadedInventoryRef.current = true;
      setMessage(null);
      setPackTargetItemId(null);
      void loadJobsForPackList(loadSequence);
      void loadThumbnails(
        nextPage.items.map((item) => item.id),
        loadSequence,
      );
    } catch (error) {
      if (loadSequenceRef.current !== loadSequence) {
        return;
      }

      console.error("Failed to load inventory.", error);
      setMessage(error instanceof Error ? error.message : "Failed to load inventory.");
    } finally {
      if (loadSequenceRef.current === loadSequence) {
        setLoading(false);
        setUpdatingResults(false);
        setRefreshing(false);
      }
    }
  }, [loadJobsForPackList, loadThumbnails, search, selectedCategory, selectedColor, selectedLocation, selectedRoom]);

  useEffect(() => {
    const nextLocation = typeof params.location === "string" && params.location.trim() ? params.location.trim() : null;
    setSelectedLocation(nextLocation);
  }, [params.location]);

  useEffect(() => {
    const filters: InventoryListFilters = {
      search,
      color: selectedColor,
      category: selectedCategory,
      room: selectedRoom,
      locationName: selectedLocation,
    };
    const debounceMs = hasActiveInventoryFilters(filters) ? INVENTORY_SEARCH_DEBOUNCE_MS : 0;
    const timeout = setTimeout(() => void loadItems(), debounceMs);

    return () => clearTimeout(timeout);
  }, [loadItems, search, selectedCategory, selectedColor, selectedLocation, selectedRoom]);

  const colorsList = useMemo(
    () => [...new Set(items.map((item) => item.color).filter((value): value is string => Boolean(value && value.trim())))].slice(0, 8),
    [items],
  );
  const categoriesList = useMemo(
    () => [...new Set(items.map((item) => item.category).filter((value): value is string => Boolean(value && value.trim())))].slice(0, 8),
    [items],
  );
  const roomsList = useMemo(
    () => [...new Set(items.map((item) => item.room).filter((value): value is string => Boolean(value && value.trim())))].slice(0, 8),
    [items],
  );
  const locationsList = useMemo(
    () => [...new Set(items.map((item) => item.current_location_name).filter((value): value is string => Boolean(value && value.trim())))].slice(0, 8),
    [items],
  );

  const activeFilters = useMemo(
    () =>
      hasActiveInventoryFilters({
        search,
        color: selectedColor,
        category: selectedCategory,
        room: selectedRoom,
        locationName: selectedLocation,
      }),
    [search, selectedCategory, selectedColor, selectedLocation, selectedRoom],
  );
  const totalMatchingItems = totalItemCount ?? items.length;
  const hasMoreMatchingItems = totalMatchingItems > items.length;

  async function handleAddToPackList(item: InventoryListItem, jobId: string) {
    setSavingItemId(item.id);
    setMessage(null);
    try {
      const targetJob = jobs.find((job) => job.id === jobId) ?? null;
      await createExactItemPackRequest({
        jobId,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        color: item.color,
        room: item.room,
      });
      setPackTargetItemId(null);
      setRecentlyAddedItemId(item.id);
      if (targetJob) {
        setRecentlyAddedJobNameByItemId((current) => ({ ...current, [item.id]: targetJob.name }));
        setMessage(`Added ${item.item_code} to ${targetJob.name}.`);
      } else {
        setMessage(`Added ${item.item_code} to the project pack list.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add item to pack list.");
    } finally {
      setSavingItemId(null);
    }
  }

  function openInventoryItem(itemId: string) {
    router.push({
      pathname: "/inventory/[id]",
      params: {
        id: itemId,
        returnPath: "/inventory",
        returnLabel: "Back to Inventory",
      },
    });
  }

  return (
    <AppScreen scroll={false}>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 20 }}
        refreshControl={<RefreshControl onRefresh={() => void loadItems(true)} refreshing={refreshing} tintColor={colors.panelAlt} />}
      >
        <Hero
          eyebrow="Inventory"
          title="Browse what you own."
          subtitle="Search and filter by color, room, or category while you’re on site."
        />

        <Field label="Search" onChangeText={setSearch} placeholder="Name, SKU, brand..." value={search} />

        {!loading ? (
          <Card>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
              Showing {items.length} of {totalMatchingItems} {activeFilters ? "matching items" : "items"}
            </Text>
            <Text style={{ color: colors.muted }}>
              {updatingResults
                ? "Updating results..."
                : activeFilters
                  ? hasMoreMatchingItems
                    ? `Searching the full inventory. Showing the first ${INITIAL_INVENTORY_ITEM_LIMIT} matches to keep thumbnails fast.`
                    : "Search and filters are running against the full inventory."
                  : hasMoreMatchingItems
                    ? `Loaded the first ${INITIAL_INVENTORY_ITEM_LIMIT} of ${totalMatchingItems} items for a faster startup.`
                    : "Loaded all inventory items."}
            </Text>
          </Card>
        ) : null}

        <View style={{ gap: 10 }}>
          <SectionTitle>Filters</SectionTitle>
          {locationsList.length > 0 ? (
            <Card>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Location</Text>
              <Text style={{ color: colors.muted }}>Physical warehouse and storage placement.</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {locationsList.map((location) => (
                  <FilterPill
                    active={selectedLocation === location}
                    key={location}
                    label={location}
                    onPress={() => setSelectedLocation((current) => (current === location ? null : location))}
                  />
                ))}
              </View>
            </Card>
          ) : null}
          {colorsList.length > 0 ? (
            <Card>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Color</Text>
              <Text style={{ color: colors.muted }}>Useful for styling swaps and visual matching.</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {colorsList.map((color) => (
                  <FilterPill
                    active={selectedColor === color}
                    key={color}
                    label={color}
                    onPress={() => setSelectedColor((current) => (current === color ? null : color))}
                  />
                ))}
              </View>
            </Card>
          ) : null}
          {categoriesList.length > 0 ? (
            <Card>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Category</Text>
              <Text style={{ color: colors.muted }}>Browse by item type.</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {categoriesList.map((category) => (
                  <FilterPill
                    active={selectedCategory === category}
                    key={category}
                    label={category}
                    onPress={() => setSelectedCategory((current) => (current === category ? null : category))}
                  />
                ))}
              </View>
            </Card>
          ) : null}
          {roomsList.length > 0 ? (
            <Card>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Room</Text>
              <Text style={{ color: colors.muted }}>Designer-facing room assignments.</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {roomsList.map((room) => (
                  <FilterPill
                    active={selectedRoom === room}
                    key={room}
                    label={room}
                    onPress={() => setSelectedRoom((current) => (current === room ? null : room))}
                  />
                ))}
              </View>
            </Card>
          ) : null}
          <SecondaryButton
            label="Clear Filters"
            onPress={() => {
              setSelectedColor(null);
              setSelectedCategory(null);
              setSelectedRoom(null);
              setSelectedLocation(null);
              setSearch("");
              router.replace("/inventory");
            }}
          />
        </View>

        {loading ? <LoadingState label="Loading inventory..." /> : null}
        {message ? <Message text={message} /> : null}
        {!loading && items.length === 0 ? <EmptyState body="Try clearing a filter or add your first item." title="No matching items." /> : null}

        {!loading
          ? items.map((item) => (
              <Card key={item.id}>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  <Pressable onPress={() => openInventoryItem(item.id)}>
                    <InventoryThumbnail item={item} />
                  </Pressable>
                  <View style={{ flex: 1, gap: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Pressable onPress={() => openInventoryItem(item.id)}>
                          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700", flex: 1 }}>{item.name}</Text>
                        </Pressable>
                        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>{item.item_code}</Text>
                      </View>
                      <View
                        style={{
                          alignSelf: "flex-start",
                          backgroundColor: item.marked_for_disposal ? "#fff1f2" : colors.successBg,
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                        }}
                      >
                        <Text style={{ color: item.marked_for_disposal ? "#b42318" : colors.successText, fontSize: 12, fontWeight: "700" }}>
                          {item.marked_for_disposal ? "dispose" : item.status}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: colors.muted }}>Category: {item.category ?? "Uncategorized"}</Text>
                    <Text style={{ color: colors.muted }}>Color: {item.color ?? "None"}</Text>
                    <Text style={{ color: colors.muted }}>Room: {item.room ?? "Not assigned"}</Text>
                    <Text style={{ color: colors.muted }}>House: {item.source_job_name ?? "Not assigned"}</Text>
                    <Text style={{ color: colors.muted }}>List Price: {formatCurrencyFromCents(item.estimated_listing_price_cents)}</Text>
                    <Text style={{ color: colors.muted }}>Cost: {formatCurrencyFromCents(item.purchase_price_cents)}</Text>
                    <Text style={{ color: colors.muted }}>Replacement: {formatCurrencyFromCents(item.replacement_cost_cents)}</Text>
                    <Text style={{ color: colors.muted }}>Tags: {item.tags.length > 0 ? item.tags.join(", ") : "None"}</Text>
                    <Text style={{ color: colors.muted }}>Dimensions: {item.dimensions ?? "None"}</Text>
                    {recentlyAddedJobNameByItemId[item.id] ? (
                      <Text style={{ color: colors.successText, fontWeight: "700" }}>
                        On pack list: {recentlyAddedJobNameByItemId[item.id]}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      <SecondaryButton label="Open Item" onPress={() => openInventoryItem(item.id)} />
                      <SecondaryButton
                        label={
                          packTargetItemId === item.id
                            ? "Hide Projects"
                            : recentlyAddedItemId === item.id
                              ? "Added to Pack List"
                              : "Add to Pack List"
                        }
                        onPress={() => setPackTargetItemId((current) => (current === item.id ? null : item.id))}
                      />
                    </View>
                    {packTargetItemId === item.id ? (
                      <View style={{ gap: 8 }}>
                        <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Choose Project</Text>
                        {jobs.length === 0 ? <Text style={{ color: colors.muted }}>Create a project first on the Projects tab.</Text> : null}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {jobs.map((job) => (
                            <SecondaryButton
                              key={job.id}
                              disabled={savingItemId === item.id}
                              label={savingItemId === item.id ? "Adding..." : job.name}
                              onPress={() => void handleAddToPackList(item, job.id)}
                            />
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Card>
            ))
          : null}
      </ScrollView>
    </AppScreen>
  );
}
